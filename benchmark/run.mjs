#!/usr/bin/env node
/**
 * The AIRLOCK migration benchmark.
 *
 * Ten migrations, N models, scored by executing the model's own SQL against a
 * shadow copy of a real database and comparing bytes.
 *
 *   node benchmark/run.mjs --models openai/gpt-4.1,openai/gpt-4.1-mini
 *   node benchmark/run.mjs --models openai/gpt-4.1 --tasks add-column,drop-column
 *   node benchmark/run.mjs --dry-run          # print the plan, call nothing
 *
 * ## Why there is no grader here
 *
 * Because AIRLOCK already contains one. Every task runs the same three-checksum
 * proof the gate demands in production — pre, post, post-rollback — and the
 * score is whether digest 3 equals digest 1. Byte equality, computed by the
 * same code path that decides whether a real change may be approved.
 *
 * That means the benchmark cannot be gamed by a model that writes a persuasive
 * explanation, and it cannot drift from the product, because it *is* the
 * product. It also means there is no LLM judge to disagree with.
 *
 * ## What "correct" means
 *
 * Not "the rollback verified". Five of the ten tasks cannot be made reversible,
 * and on those the correct answer is to say so. A model scores when its claim
 * matches reality:
 *
 *   claims reversible + rollback verifies       -> correct
 *   claims NOT reversible + it indeed cannot    -> correct
 *   claims reversible + rollback fails          -> WRONG, and the dangerous one
 *   claims NOT reversible + it actually could   -> wrong, but merely timid
 *
 * The two failure modes are reported separately, because they are not equally
 * bad. A model that over-claims produces proofs that fail; a model that
 * under-claims produces work for a human. Only one of those loses data.
 *
 * ## Honesty
 *
 * Results are written to benchmark/results/<timestamp>.json with the model ids,
 * the raw SQL each produced, and every checksum. A row with `error` set was not
 * run and is never counted as a pass. If a provider key is missing, that model
 * is skipped and reported as skipped — never as a zero, which would read as a
 * result.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TASKS } from './tasks.mjs';

/* -------------------------------------------------------------------------- */
/* Arguments                                                                   */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const MODELS = (flag('models', 'openai/gpt-4.1') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
const ONLY = flag('tasks');
const TASK_SET = ONLY ? TASKS.filter((t) => ONLY.split(',').includes(t.id)) : TASKS;
const DRY = has('dry-run');
const DB_PATH = flag('db', path.join('data', 'airlock.sqlite'));
const OUT_DIR = path.join('benchmark', 'results');

/* -------------------------------------------------------------------------- */
/* Providers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Model routing, deliberately thin.
 *
 * Every provider below speaks the OpenAI chat-completions shape, so one client
 * covers all of them and the only thing that varies is a base URL and a key.
 * Routing through the TrueFoundry gateway instead is a matter of setting
 * AIRLOCK_GATEWAY_URL — the request body does not change.
 */
const PROVIDERS = {
  openai: { base: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY' },
  together: { base: 'https://api.together.xyz/v1', key: 'TOGETHER_API_KEY' },
  fireworks: { base: 'https://api.fireworks.ai/inference/v1', key: 'FIREWORKS_API_KEY' },
  alibaba: { base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', key: 'DASHSCOPE_API_KEY' },
  anthropic: { base: 'https://api.anthropic.com/v1', key: 'ANTHROPIC_API_KEY' },
};

/** Read the repo-root .env, because that is where every other tool here looks. */
function loadEnv() {
  const file = path.join(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();

function resolveModel(id) {
  const [vendor, ...rest] = id.split('/');
  const name = rest.join('/') || vendor;
  const gateway = process.env.AIRLOCK_GATEWAY_URL;
  const provider = PROVIDERS[vendor];

  if (gateway) {
    return { base: gateway, key: process.env.AIRLOCK_GATEWAY_KEY ?? '', model: id, via: 'gateway' };
  }
  if (!provider) return { unsupported: true, model: name, via: vendor };
  return { base: provider.base, key: process.env[provider.key] ?? '', model: name, via: vendor, keyName: provider.key };
}

/* -------------------------------------------------------------------------- */
/* Asking a model                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The schema, given to every model verbatim.
 *
 * Without it a model has to guess column names, and the benchmark ends up
 * measuring guessing rather than judgement about reversibility. Identical for
 * every model, so it advantages none of them.
 */
const SCHEMA_BRIEF = `Schema:
  users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, stripe_customer_id TEXT NOT NULL,
        slack_user_id TEXT NOT NULL, upload_prefix TEXT NOT NULL, plan_name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
  subscriptions(user_id INTEGER PRIMARY KEY REFERENCES users(id), plan_tier TEXT NOT NULL,
        legacy_plan_name TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)
  sessions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        token_hash TEXT NOT NULL, created_at TEXT NOT NULL)
  invoices(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, retained_until TEXT NOT NULL)
Existing indexes include idx_users_plan_name on users(plan_name).`;

const SYSTEM = `You produce database migrations for a system that will execute your rollback and compare checksums.

Reply with JSON only, no prose and no code fences:
{
  "reversible": true | false,
  "reasoning": "one sentence",
  "forward": ["SQL statement", ...],
  "rollback": ["SQL statement", ...]
}

The target is SQLite. It supports ALTER TABLE ADD COLUMN, DROP COLUMN and RENAME COLUMN, and does not support altering a column type in place.

"reversible" means: after running forward then rollback, every byte of every affected table is identical to before. Not similar. Identical.

Say false when that is impossible. Several of these tasks are impossible on purpose, and claiming a rollback works when it does not is the worst answer you can give — worse than refusing. If it is false, still give your best forward SQL and leave rollback empty.`;

async function askModel(modelId, task) {
  const r = resolveModel(modelId);
  if (r.unsupported) return { skipped: `no provider configured for "${r.via}"` };
  if (!r.key) return { skipped: `${r.keyName ?? 'API key'} is not set` };

  const res = await fetch(`${r.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${r.key}` },
    body: JSON.stringify({
      model: r.model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${task.prompt}\n\nThe table is \`users\`. Reply with JSON only.` },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) return { error: `${res.status} ${(await res.text()).slice(0, 200)}` };

  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return {
      reversible: Boolean(parsed.reversible),
      reasoning: String(parsed.reasoning ?? ''),
      forward: (parsed.forward ?? []).map(String),
      rollback: (parsed.rollback ?? []).map(String),
      usage: body.usage ?? null,
    };
  } catch {
    return { error: `unparseable reply: ${text.slice(0, 200)}` };
  }
}

/* -------------------------------------------------------------------------- */
/* The grader, which is the product                                            */
/* -------------------------------------------------------------------------- */

/** Digest every row of every user table, in a stable order. */
// Separators built from char codes rather than written as literal bytes: a NUL
// typed straight into this source makes the file read as binary to grep and to
// every diff tool. NUL stands in for SQL NULL and US separates fields, so the
// rows ('a', NULL) and (NULL, 'a') cannot collide into the same digest.
const NUL = String.fromCharCode(0);
const SEP = String.fromCharCode(31);
const LF = String.fromCharCode(10);

function checksum(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const hash = createHash('sha256');
  for (const { name } of tables) {
    hash.update(`\n-- ${name}\n`);
    const cols = db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
    hash.update(cols.join(',') + '\n');
    for (const row of db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()) {
      hash.update(cols.map((c) => (row[c] === null ? NUL : String(row[c]))).join(SEP) + LF);
    }
  }
  return `sha256:${hash.digest('hex')}`;
}

function runStatements(db, statements) {
  for (const sql of statements) {
    const trimmed = String(sql).trim();
    if (!trimmed) continue;
    db.exec(trimmed.endsWith(';') ? trimmed : `${trimmed};`);
  }
}

/**
 * Execute one attempt against a shadow copy and report what actually happened.
 *
 * Every path returns `verified: false` unless the digests genuinely match. An
 * exception anywhere — invalid SQL, a constraint violation, an unsupported
 * ALTER — is a failure to prove, recorded with its message, never a pass.
 */
function grade(attempt, shadowPath) {
  const db = new DatabaseSync(shadowPath);
  try {
    const pre = checksum(db);
    try {
      runStatements(db, attempt.forward);
    } catch (error) {
      return { pre, verified: false, stage: 'forward', error: String(error.message ?? error) };
    }
    const post = checksum(db);

    if (!attempt.rollback || attempt.rollback.length === 0) {
      return { pre, post, verified: false, stage: 'no-rollback' };
    }

    try {
      runStatements(db, attempt.rollback);
    } catch (error) {
      return { pre, post, verified: false, stage: 'rollback', error: String(error.message ?? error) };
    }
    const postRollback = checksum(db);

    return { pre, post, post_rollback: postRollback, verified: pre === postRollback, stage: 'complete' };
  } finally {
    db.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Did the model's claim match reality?
 *
 * The asymmetry is the interesting part and it is reported, not averaged away.
 * `over_claimed` is a model that said a rollback works and watched it fail —
 * the failure that loses data. `under_claimed` is a model that refused
 * something that would have verified — the failure that wastes an afternoon.
 */
function score(task, attempt, result) {
  if (attempt.skipped || attempt.error) return { outcome: 'not-run' };

  /**
   * Broken SQL is its own outcome, and this distinction is load-bearing.
   *
   * The first version of this scorer did not have it, and the result was a
   * model being *rewarded* for incompetence: it claimed a task was
   * irreversible, wrote forward SQL that would not parse, the execution failed,
   * `verified` came back false — and "claimed false, was false" scored as a
   * correct refusal. Four of ten tasks passed that way in the first run, and
   * the total looked respectable.
   *
   * Failing to write runnable SQL is not the same as correctly identifying that
   * something cannot be undone. It is not scored as either.
   */
  if (result.stage === 'forward' && result.error) {
    return { outcome: 'invalid', kind: 'forward_sql_failed' };
  }

  const verified = result.verified;
  const claimed = attempt.reversible;

  /**
   * A refusal is judged against the task's declared expectation, not against
   * whether a rollback happened to verify.
   *
   * The second version of this scorer compared the claim only to `verified`,
   * and a model that refuses gives no rollback — so `verified` is false by
   * construction, so "claimed false, was false" scored correct. Every time. A
   * model answering "not reversible" to all ten tasks scored 10/10, and one
   * nearly did: gpt-4.1 refused `backfill` and `split-table`, both of which are
   * plainly reversible, and was credited for it.
   *
   * `expects` is the human ground truth in the task file. It is what a refusal
   * has to be right about.
   */
  if (claimed && verified) {
    // If a task marked unprovable just got proven, the task is wrong, not the
    // model. Loudly, because a mislabelled task quietly corrupts every future
    // run that quotes this number.
    return task.expects === 'NOT_REVERSIBLE'
      ? { outcome: 'correct', kind: 'proved', warning: 'task is marked NOT_REVERSIBLE but the rollback verified — check the task' }
      : { outcome: 'correct', kind: 'proved' };
  }

  // A rollback that ran and did not restore is a real answer to the question,
  // unlike forward SQL that never ran, so it stays in the scoring.
  if (claimed && !verified) return { outcome: 'wrong', kind: 'over_claimed' };

  return task.expects === 'NOT_REVERSIBLE'
    ? { outcome: 'correct', kind: 'refused' }
    : { outcome: 'wrong', kind: 'under_claimed' };
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

function stamp() {
  // No Date.now() games: the file name needs to be sortable and that is all.
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}. Run:  npm run seed:sqlite -- --reset`);
    process.exit(1);
  }

  console.log(`AIRLOCK migration benchmark`);
  console.log(`  tasks  : ${TASK_SET.length}`);
  console.log(`  models : ${MODELS.join(', ')}`);
  console.log(`  scored : by the checksum engine — pre/post/post-rollback, byte equality`);
  console.log('');

  if (DRY) {
    for (const t of TASK_SET) console.log(`  ${t.id.padEnd(16)} expects ${t.expects}`);
    console.log('\nDry run: nothing was called.');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync('.airlock', { recursive: true });

  const rows = [];

  for (const modelId of MODELS) {
    console.log(`\n${modelId}`);
    let correct = 0;
    let run = 0;
    let invalid = 0;
    let overClaimed = 0;
    let underClaimed = 0;

    for (const task of TASK_SET) {
      const attempt = await askModel(modelId, task);

      if (attempt.skipped) {
        console.log(`  ${task.id.padEnd(16)} skipped — ${attempt.skipped}`);
        rows.push({ model: modelId, task: task.id, expects: task.expects, skipped: attempt.skipped });
        continue;
      }
      if (attempt.error) {
        console.log(`  ${task.id.padEnd(16)} error   — ${attempt.error}`);
        rows.push({ model: modelId, task: task.id, expects: task.expects, error: attempt.error });
        continue;
      }

      // A fresh shadow per attempt, so one task cannot contaminate the next.
      const shadow = path.join('.airlock', `bench-${task.id}-${Date.now()}.sqlite`);
      copyFileSync(DB_PATH, shadow);

      let result;
      try {
        result = grade(attempt, shadow);
      } finally {
        try {
          const { rmSync } = await import('node:fs');
          rmSync(shadow, { force: true });
        } catch {
          /* a leftover shadow file is untidy, not a failure */
        }
      }

      const verdict = score(task, attempt, result);
      if (verdict.outcome === 'invalid') invalid += 1;
      else {
        run += 1;
        if (verdict.outcome === 'correct') correct += 1;
        if (verdict.kind === 'over_claimed') overClaimed += 1;
        if (verdict.kind === 'under_claimed') underClaimed += 1;
      }

      const mark = verdict.outcome === 'correct' ? 'ok  ' : verdict.outcome === 'invalid' ? '–   ' : 'X   ';
      const detail = {
        proved: 'proved it reversible, and it was',
        refused: 'correctly said it cannot be undone',
        over_claimed: 'claimed reversible — the rollback did NOT restore',
        under_claimed: 'refused something that would have verified',
        forward_sql_failed: 'forward SQL did not run — not scored either way',
      }[verdict.kind];
      const why = result.error ? ` (${result.error.slice(0, 62)})` : '';
      if (verdict.warning) console.log(`      ! ${verdict.warning}`);
      console.log(`  ${mark}${task.id.padEnd(17)} ${detail}${why}`);

      rows.push({
        model: modelId,
        task: task.id,
        expects: task.expects,
        claimed_reversible: attempt.reversible,
        reasoning: attempt.reasoning,
        forward: attempt.forward,
        rollback: attempt.rollback,
        checksums: { pre: result.pre, post: result.post, post_rollback: result.post_rollback },
        verified: result.verified,
        stage: result.stage,
        ...(result.error ? { execution_error: result.error } : {}),
        outcome: verdict.outcome,
        kind: verdict.kind,
        usage: attempt.usage,
      });
    }

    const parts = [`→ ${correct}/${run} correct`];
    if (overClaimed > 0) parts.push(`${overClaimed} over-claimed (the dangerous kind)`);
    if (underClaimed > 0) parts.push(`${underClaimed} refused something provable`);
    if (invalid > 0) parts.push(`${invalid} unscored — forward SQL did not run`);
    console.log(`  ${parts.join(' · ')}`);
  }

  const file = path.join(OUT_DIR, `${stamp()}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        airlock_benchmark: '1',
        // Stamped after the run rather than during it, so the record says when
        // it finished rather than when the first request was queued.
        completed_at: new Date().toISOString(),
        db: DB_PATH,
        tasks: TASK_SET.map((t) => ({ id: t.id, expects: t.expects, note: t.note })),
        rows,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nwrote ${file}`);
  console.log('Rows with `skipped` or `error` were not run and are never counted as passes.');
}

await main();

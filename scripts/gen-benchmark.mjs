/**
 * Generate docs/BENCHMARK.md from the most recent results file.
 *
 * Same discipline as CAPABILITIES.md and POLICY.md: the numbers in the document
 * are read out of a run that actually happened rather than typed in beside it.
 * A benchmark table maintained by hand is a benchmark table that is wrong by
 * the second run.
 *
 * Run: node scripts/gen-benchmark.mjs [results-file]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const resultsDir = path.join(root, 'benchmark', 'results');

if (!existsSync(resultsDir)) {
  console.error('No benchmark results yet. Run:  npm run benchmark -- --models openai/gpt-4.1');
  process.exit(1);
}

const chosen =
  process.argv[2] ??
  path.join(
    resultsDir,
    readdirSync(resultsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .pop() ?? '',
  );

if (!chosen || !existsSync(chosen)) {
  console.error('No results file found.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(chosen, 'utf8'));
const models = [...new Set(data.rows.map((r) => r.model))];

/** Per-model tallies. `not-run` rows never count as passes, in either direction. */
function tally(model) {
  const rows = data.rows.filter((r) => r.model === model);
  const t = { scored: 0, correct: 0, over: 0, under: 0, invalid: 0, skipped: 0, errored: 0 };
  for (const r of rows) {
    if (r.skipped) t.skipped += 1;
    else if (r.error) t.errored += 1;
    else if (r.outcome === 'invalid') t.invalid += 1;
    else {
      t.scored += 1;
      if (r.outcome === 'correct') t.correct += 1;
      if (r.kind === 'over_claimed') t.over += 1;
      if (r.kind === 'under_claimed') t.under += 1;
    }
  }
  return t;
}

const L = [];
L.push('# The migration benchmark');
L.push('');
L.push('> **Generated file.** Run `npm run benchmark -- --models …` then');
L.push('> `node scripts/gen-benchmark.mjs`. Do not edit by hand.');
L.push('');
L.push(`Run completed ${data.completed_at}, against \`${data.db}\`.`);
L.push('');
L.push('## Why there is no grader');
L.push('');
L.push('Because AIRLOCK already contains one.');
L.push('');
L.push('Every task is scored by executing the model’s own SQL against a shadow copy of a real');
L.push('database and running the same three-checksum proof the gate demands in production:');
L.push('');
L.push('```');
L.push('checksum → forward → checksum → rollback → checksum');
L.push('```');
L.push('');
L.push('The score is whether digest 3 equals digest 1. Not a rubric, not an LLM judge, not a');
L.push('similarity score — a byte comparison, computed by the same function that decides');
L.push('whether a real change may be approved. It cannot be won with a persuasive');
L.push('explanation, and it cannot drift from the product, because it **is** the product.');
L.push('');
L.push('## What "correct" means');
L.push('');
L.push('Not "the rollback verified". Five of the ten tasks **cannot** be made reversible, and');
L.push('on those the correct answer is to say so.');
L.push('');
L.push('| The model says | Reality | Verdict |');
L.push('| --- | --- | --- |');
L.push('| reversible | rollback restored it byte-for-byte | correct |');
L.push('| not reversible | task is genuinely unprovable | correct |');
L.push('| reversible | rollback did **not** restore it | **over-claimed** — the dangerous one |');
L.push('| not reversible | task was provable | under-claimed — merely timid |');
L.push('');
L.push('The two failure modes are reported separately because they are not equally bad. An');
L.push('over-claim produces a proof that fails against production. An under-claim produces');
L.push('work for a human. Only one of them loses data.');
L.push('');
L.push('## Results');
L.push('');
L.push('| Model | Correct | Over-claimed | Under-claimed | Unscored |');
L.push('| --- | --- | --- | --- | --- |');
for (const m of models) {
  const t = tally(m);
  L.push(
    `| \`${m}\` | **${t.correct}/${t.scored}** | ${t.over} | ${t.under} | ${t.invalid + t.skipped + t.errored} |`,
  );
}
L.push('');
L.push('“Unscored” is a task whose forward SQL did not execute. It is not counted as a pass');
L.push('or a failure of judgement, because failing to write runnable SQL is a different');
L.push('mistake from failing to recognise that something cannot be undone.');
L.push('');

L.push('## Task by task');
L.push('');
const header = ['| Task | Expects | ', ...models.map((m) => `\`${m.split('/').pop()}\` | `)].join('');
L.push(header);
L.push(`| --- | --- |${models.map(() => ' --- |').join('')}`);
for (const task of data.tasks) {
  const cells = models.map((m) => {
    const r = data.rows.find((x) => x.model === m && x.task === task.id);
    if (!r) return ' — |';
    if (r.skipped || r.error) return ' not run |';
    const mark = {
      proved: 'proved',
      refused: 'refused',
      over_claimed: '**over-claimed**',
      under_claimed: 'under-claimed',
      forward_sql_failed: 'SQL failed',
    }[r.kind];
    return ` ${mark} |`;
  });
  L.push(`| \`${task.id}\` | ${task.expects === 'REVERSIBLE' ? 'reversible' : 'not reversible'} |${cells.join('')}`);
}
L.push('');

L.push('## What the numbers changed');
L.push('');
L.push('The routing in `gateway/airlock-gateway.yaml` used to be an assertion — the cheap');
L.push('model for reconnaissance, the expensive one for authoring, because that sounded');
L.push('right. It is now a measurement.');
L.push('');
L.push('The finding that matters is not the totals, it is **which kind of mistake each model');
L.push('makes.** A model that never over-claims can be trusted to author a migration, because');
L.push('its failures cost an afternoon rather than a table. A model that over-claims cannot,');
L.push('however good its total — an unprovable rollback that looks proven is the single most');
L.push('dangerous artefact this system can produce.');
L.push('');
L.push('That is why `airlock-scout` runs the cheaper model and has no `airlock` server mounted');
L.push('at all: it reads, counts and greps, and it structurally cannot attach a certificate or');
L.push('ask for approval.');
L.push('');

L.push('## Reproducing it');
L.push('');
L.push('```bash');
L.push('npm run seed:sqlite -- --reset');
L.push('npm run check:benchmark          # asserts the tasks still match the schema');
L.push('npm run benchmark -- --models openai/gpt-4.1,openai/gpt-4.1-mini');
L.push('node scripts/gen-benchmark.mjs');
L.push('```');
L.push('');
L.push('Add providers by setting their keys — `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`,');
L.push('`DASHSCOPE_API_KEY`, `ANTHROPIC_API_KEY` — or point the whole run through the');
L.push('TrueFoundry gateway with `AIRLOCK_GATEWAY_URL`. A model whose key is missing is');
L.push('reported as skipped and never as a zero, because a zero reads as a result.');
L.push('');
L.push('Raw results, including every model’s SQL and every checksum, are in');
L.push('[`benchmark/results/`](../benchmark/results).');
L.push('');

writeFileSync(path.join(root, 'docs/BENCHMARK.md'), L.join('\n'), 'utf8');
console.log(`wrote docs/BENCHMARK.md from ${path.basename(chosen)} (${models.length} model(s))`);

/**
 * The shadow run. This is where a certificate's numbers actually come from.
 *
 * Until now the only way a checksum reached a dossier was for the agent to type
 * it into `airlock_attach_certificate`. That is the whole product inverted: a
 * certificate is supposed to be the one field a model cannot author, and it was
 * the only field a model *could* author. Observed in a real session, verbatim:
 *
 *   "I will generate placeholder checksums in the required format to proceed."
 *
 * Guarding against that was the wrong shape of fix — it left the capability in
 * place and asked the model not to use it. This removes the capability. The
 * agent asks AIRLOCK to verify; AIRLOCK copies the database, runs the change,
 * runs the inverse, and measures. The agent never sees a digest until one has
 * been produced by execution, and cannot supply one at all.
 *
 * ---------------------------------------------------------------------------
 * What is real here, precisely
 *
 * Everything. The database is copied byte-for-byte to a shadow file, the
 * caller's own forward SQL is executed against it, the tables are hashed, the
 * caller's own rollback SQL is executed, and the tables are hashed again. The
 * digests are over real rows. Nothing is seeded, nothing is estimated, and the
 * elapsed time is measured with a clock rather than guessed.
 *
 * What it is NOT is an isolated sandbox. This runs on the AIRLOCK host, so it
 * is recorded as `LOCAL_SHADOW` rather than `SANDBOX_RESTORE` — the two differ
 * in blast radius if the SQL is hostile, and a certificate that claimed the
 * stronger one would be lying about where it ran. See shadow.ts.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface ShadowRunInput {
  /** The real database. Opened read-only; only the copy is ever written to. */
  databasePath: string;
  /** Where the throwaway copy goes. Removed on every exit path. */
  shadowDir: string;
  /** A label for the copy, so a crashed run leaves an identifiable orphan. */
  runId: string;
  /** Tables to checksum. These are what the certificate is a claim about. */
  tables: string[];
  forward: string[];
  rollback: string[];
}

export interface ShadowRunResult {
  /** 'PROVEN' only when the rollback returned every table to its starting digest. */
  status: 'PROVEN' | 'FAILED';
  checksums: { pre: string; post: string; post_rollback: string; match: boolean } | null;
  /** Wall-clock milliseconds the forward statements took. Measured, not modelled. */
  forward_ms: number | null;
  /** Rows in each table before the change. Counted, not estimated. */
  row_counts: Record<string, number>;
  /** Which statements actually executed. A statement that threw is not proven. */
  forward_proven: boolean[];
  rollback_proven: boolean[];
  failure_reason: string | null;
  /** Where it ran, in the terms shadow.ts uses. */
  strategy: 'LOCAL_SHADOW';
}

function quote(name: string): string {
  return `"${String(name).replaceAll('"', '""')}"`;
}

/**
 * Say what a raw SQLite error actually means for this verifier.
 *
 * One case earns the special handling, because it is the failure an agent
 * connected to a real Postgres will hit first and the raw message sends the
 * reader in the wrong direction entirely:
 *
 *   no such table: public.users
 *
 * Read literally, that says the table is missing — so the operator goes and
 * checks the database, finds `users` sitting right there, and concludes the
 * verifier is broken. It is not. The agent resolved its facts against Postgres,
 * where `public.users` is the correct fully-qualified name, and then wrote the
 * migration using that name. This shadow is SQLite, which has no schemas at
 * all, so the qualifier cannot resolve.
 *
 * The name is deliberately NOT rewritten to make it run. What the certificate
 * measures has to be the statements that were actually executed — that binding
 * is the entire value of the artefact — so silently proving a different
 * statement than the one supplied would be the exact dishonesty this package
 * exists to prevent. The mismatch is reported instead, with the fix named.
 */
function explain(error: Error): string {
  const missing = /no such table:\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/.exec(error.message);
  if (missing) {
    const [, schema, table] = missing;
    return (
      `${error.message}. This shadow is SQLite, which has no schemas, so a Postgres-style ` +
      `qualified name cannot resolve here. The statements were written against ${schema}.${table} ` +
      `— correct for the production target, unusable in this verifier. Supply the migration ` +
      `against "${table}", or verify against a real Postgres shadow. The name was not rewritten ` +
      `on your behalf: a certificate has to measure the statements it was actually given.`
    );
  }
  return error.message;
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: unknown }>)
    .map((row) => String(row.name))
    .sort();
}

/**
 * Hash one table's contents.
 *
 * Deliberately identical in shape to `scripts/verify-sqlite-migration.mjs`, and
 * for a reason worth stating: two checksum implementations in one product is a
 * product with two truths. If this drifted from the script CI runs, a change
 * could pass verification here and fail there, and the disagreement would look
 * like a flaky test rather than a broken proof.
 *
 * Columns are sorted so that a migration which reorders them without touching
 * data is correctly seen as a no-op. Rows are ordered by rowid rather than by a
 * column that may not exist — an earlier version ordered by `id` and would have
 * thrown on any table without one.
 */
function tableChecksum(db: DatabaseSync, table: string): string {
  const columns = tableColumns(db, table);
  const h = createHash('sha256');
  h.update(`${table}\n`);
  h.update(`${columns.join('\t')}\n`);

  const projection = columns.map(quote).join(', ');
  const rows = db.prepare(`SELECT ${projection} FROM ${quote(table)} ORDER BY rowid`).all() as Array<
    Record<string, unknown>
  >;
  for (const row of rows) {
    h.update(JSON.stringify(columns.map((c) => row[c] ?? null)));
    h.update('\n');
  }
  return `sha256:${h.digest('hex')}`;
}

/** One digest over every table in scope, so the triple is a single comparison. */
function digestOf(db: DatabaseSync, tables: string[]): string {
  const h = createHash('sha256');
  for (const t of [...tables].sort()) h.update(`${tableChecksum(db, t)}\n`);
  return `sha256:${h.digest('hex')}`;
}

function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: unknown };
  return Number(row.n);
}

/**
 * Apply a change to a copy, undo it, and report whether the data came back.
 *
 * Every failure path returns FAILED with a reason rather than throwing, because
 * "the migration did not work" is a legitimate and important result — it is the
 * outcome the whole product exists to surface — and an exception here would be
 * indistinguishable from AIRLOCK being broken.
 */
export function verifyOnSqliteShadow(input: ShadowRunInput): ShadowRunResult {
  const base: Omit<ShadowRunResult, 'status' | 'failure_reason'> = {
    checksums: null,
    forward_ms: null,
    row_counts: {},
    forward_proven: [],
    rollback_proven: [],
    strategy: 'LOCAL_SHADOW',
  };

  if (!existsSync(input.databasePath)) {
    return { ...base, status: 'FAILED', failure_reason: `No database at ${input.databasePath}.` };
  }
  if (input.tables.length === 0) {
    return {
      ...base,
      status: 'FAILED',
      failure_reason: 'No tables were named, so there is nothing to take a checksum of. A proof about no tables proves nothing.',
    };
  }
  if (input.forward.length === 0) {
    return { ...base, status: 'FAILED', failure_reason: 'No forward statements were supplied.' };
  }
  if (input.rollback.length === 0) {
    return {
      ...base,
      status: 'FAILED',
      failure_reason:
        'No rollback statements were supplied. An UNDO certificate is the claim that a change can be taken back, and no inverse was offered to execute.',
    };
  }

  mkdirSync(input.shadowDir, { recursive: true });
  const shadowPath = path.join(input.shadowDir, `${input.runId}.shadow.sqlite`);
  copyFileSync(input.databasePath, shadowPath);

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(shadowPath);

    for (const t of input.tables) base.row_counts[t] = countRows(db, t);

    const pre = digestOf(db, input.tables);

    const startedAt = process.hrtime.bigint();
    for (const sql of input.forward) {
      try {
        db.exec(sql);
        base.forward_proven.push(true);
      } catch (error) {
        base.forward_proven.push(false);
        return {
          ...base,
          status: 'FAILED',
          checksums: null,
          failure_reason: `The forward migration failed to execute: ${(error as Error).message}`,
        };
      }
    }
    base.forward_ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    const post = digestOf(db, input.tables);

    for (const sql of input.rollback) {
      try {
        db.exec(sql);
        base.rollback_proven.push(true);
      } catch (error) {
        base.rollback_proven.push(false);
        return {
          ...base,
          status: 'FAILED',
          checksums: { pre, post, post_rollback: post, match: false },
          failure_reason: `The rollback failed to execute: ${(error as Error).message}. The change ran and could not be taken back.`,
        };
      }
    }

    const postRollback = digestOf(db, input.tables);
    const match = pre === postRollback;

    return {
      ...base,
      status: match ? 'PROVEN' : 'FAILED',
      checksums: { pre, post, post_rollback: postRollback, match },
      failure_reason: match
        ? null
        : `The rollback ran without error, but the data did not come back: the post-rollback digest ${postRollback} differs from the pre-change digest ${pre}. This change is not reversible by the inverse supplied.`,
    };
  } catch (error) {
    return { ...base, status: 'FAILED', failure_reason: `Verification could not run: ${explain(error as Error)}` };
  } finally {
    // Torn down on every path — success, failure, and throw. An orphaned copy of
    // somebody's data is the worst thing this module could leave behind, and the
    // window in which one can exist is this block.
    try {
      db?.close();
    } catch {
      /* already closed */
    }
    try {
      rmSync(shadowPath, { force: true });
    } catch {
      /* best effort; the reaper sweeps what is left */
    }
  }
}

/**
 * Remove shadow copies a crashed run left behind.
 *
 * Called on startup. The teardown above handles every path this process can
 * take; it cannot handle the process dying between the copy and the finally.
 */
export function reapOrphanShadows(shadowDir: string): string[] {
  if (!existsSync(shadowDir)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(shadowDir)) {
    if (!name.endsWith('.shadow.sqlite')) continue;
    try {
      rmSync(path.join(shadowDir, name), { force: true });
      removed.push(name);
    } catch {
      /* leave it; report what was removed */
    }
  }
  return removed;
}

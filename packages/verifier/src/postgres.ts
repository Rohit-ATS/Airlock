/**
 * The shadow run, against the real Postgres.
 *
 * `sqlite.ts` proves a migration by copying a local file and running the
 * statements against the copy. That is a genuine measurement and it is the
 * wrong database. The agent reads the live schema from Supabase, correctly
 * writes `alter table users …` against what it found there, and then the proof
 * runs against a seeded demo file that has never heard of it. The failure it
 * produces —
 *
 *   FAILED. Verification could not run: no such table: public.users
 *
 * — sends the operator to check a database where the table is plainly present,
 * and the agent, having no better information, asks them to go and synchronise
 * an environment. That is the single reason this product felt like it did
 * nothing: everything before the proof was real, and the proof was against a
 * stranger.
 *
 * So this runs the change against a copy of the real rows, in the real engine,
 * inside the real database — a throwaway schema alongside `public`, populated
 * from it, dropped on every exit path.
 *
 * WHAT KEEPS IT OFF PRODUCTION
 *
 * One mechanism, stated plainly because everything rests on it: every statement
 * runs in a transaction whose `search_path` is the shadow schema **and nothing
 * else**. An unqualified `users` therefore resolves to the copy. It cannot
 * resolve to `public.users`, because `public` is not on the path — a statement
 * naming a table the shadow does not have fails with "relation does not exist"
 * rather than quietly finding the production one.
 *
 * That confinement is only as good as the statements being unqualified, so a
 * statement carrying an explicit schema is **refused before anything runs**.
 * `alter table public.users …` would ignore `search_path` entirely and alter
 * production. There is no sanitising, no rewriting, no best effort: it is
 * rejected, and the reason says why. Rewriting it to point at the shadow would
 * be worse than refusing, because then the certificate would be a measurement
 * of a statement nobody is going to run.
 *
 * WHAT THIS PROOF DOES AND DOES NOT COVER
 *
 * The copy is `create table … as select * from …`: real rows, real types, real
 * volume. It does not carry constraints, defaults, indexes or triggers. So a
 * migration whose reversibility depends on a constraint firing is *not* fully
 * covered here, and the honest way to read a certificate from this strategy is
 * "the data came back byte-identical", not "every object came back". That is
 * why it reports SANDBOX_RESTORE rather than NATIVE_BRANCH.
 */

/** Real rows, real engine, throwaway schema. See the note above on coverage. */
export type PostgresShadowStrategy = 'SANDBOX_RESTORE';

export interface PostgresShadowInput {
  /** Supabase project ref — the subdomain of SUPABASE_URL. */
  projectRef: string;
  /** A Supabase personal access token. Never logged. */
  accessToken: string;
  /** A label for the throwaway schema, so a crashed run leaves an identifiable orphan. */
  runId: string;
  /** Tables to copy and checksum. These are what the certificate is a claim about. */
  tables: string[];
  forward: string[];
  rollback: string[];
  /** Schema the real tables live in. Only ever read from. */
  sourceSchema?: string;
  /** Test hook. Production uses global fetch. */
  fetch?: typeof fetch;
}

export interface PostgresShadowResult {
  status: 'PROVEN' | 'FAILED';
  checksums: { pre: string; post: string; post_rollback: string; match: boolean } | null;
  forward_ms: number | null;
  /** Whether the forward migration rewrote any table in the shadow schema. */
  table_rewrite: boolean | null;
  row_counts: Record<string, number>;
  /** Schema/index/constraint evidence captured around the proof. */
  metadata: PostgresEvidence | null;
  forward_proven: boolean[];
  rollback_proven: boolean[];
  failure_reason: string | null;
  strategy: PostgresShadowStrategy;
  /** The throwaway schema, named so a human can find an orphan and drop it. */
  shadow_schema: string;
}

const API = 'https://api.supabase.com/v1/projects';

export interface PostgresTableSnapshot {
  table: string;
  relfilenode: string | null;
  indexes: string[];
  constraints: string[];
}

export interface PostgresEvidence {
  source_schema: string;
  shadow_schema: string;
  source_before: PostgresTableSnapshot[];
  shadow_before: PostgresTableSnapshot[];
  shadow_after_forward: PostgresTableSnapshot[];
  shadow_after_rollback: PostgresTableSnapshot[];
  rewritten_tables: string[];
}

/** Postgres identifier quoting. Everything interpolated goes through this. */
function q(name: string): string {
  return `"${String(name).replaceAll('"', '""')}"`;
}

/**
 * Does this statement name a schema explicitly?
 *
 * The confinement is `search_path`, and `search_path` is ignored by a qualified
 * name — so this is the check that stands between a shadow run and an ALTER on
 * production. It is deliberately broad: any `word.word` outside quotes is
 * treated as qualified, because a false refusal costs one clear error message
 * and a false accept costs the customer's database.
 */
export function findSchemaQualifier(statement: string): string | null {
  const withoutStrings = statement.replace(/'(?:''|[^'])*'/g, "''");
  const identifiersVisible = withoutStrings.replace(/"((?:[^"]|"")*)"/g, (_, raw: string) => {
    const unquoted = raw.replace(/""/g, '"').replace(/[^A-Za-z0-9_]/g, '_');
    return unquoted || '_';
  });
  const match = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(identifiersVisible);
  return match ? `${match[1]}.${match[2]}` : null;
}

export class PostgresShadowError extends Error {}

/**
 * Accept `users` and `public.users` as the same table.
 *
 * `list_tables` on the Supabase connector reports names fully qualified —
 * `public.users` — so that is what the agent has in hand and that is what it
 * passes here. Interpolating it produced `public.public.users`, and the error
 * that came back named a relation nobody had written, which is a genuinely
 * baffling thing to debug.
 *
 * The qualifier is stripped rather than refused, because unlike a qualifier in
 * a *statement* this one is inert: it names which table to copy and checksum,
 * it never reaches the confined transaction, so it cannot escape the shadow.
 * The refusal in `findSchemaQualifier` is what guards that, and it still does.
 */
function bareTable(name: string): string {
  const parts = String(name).split('.');
  return (parts[parts.length - 1] ?? name).trim();
}

async function runSql(input: PostgresShadowInput, sql: string): Promise<unknown[]> {
  const fetchImpl = input.fetch ?? fetch;
  const res = await fetchImpl(`${API}/${encodeURIComponent(input.projectRef)}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) {
    // The token is never in the message; the body from Supabase names the SQL error.
    throw new PostgresShadowError(text.slice(0, 400));
  }
  try {
    return JSON.parse(text) as unknown[];
  } catch {
    return [];
  }
}

/**
 * A digest of a table's contents that does not depend on row order.
 *
 * `t::text` renders the whole row, so a changed value in any column changes the
 * digest; ordering by that same text makes the aggregate stable across the
 * physical reordering a rewrite can cause. An empty table hashes to a constant
 * rather than null, so "empty" and "missing" stay distinguishable.
 */
function digestSql(schema: string, tables: string[]): string {
  // Real SHA-256, not md5 relabelled.
  //
  // The first version of this hashed with `md5()` and prefixed the result with
  // `sha256:`, and the contract refused the certificate for exactly the right
  // reason: 32 hex characters where 64 were promised. A digest that lies about
  // its own algorithm is worse than a weak digest, and the check that caught it
  // is the same one that stops an agent inventing a checksum. Postgres 11 and
  // later expose `sha256(bytea)` natively, so no extension is needed.
  //
  // `coalesce(..., '')` inside the hash keeps an empty table hashing to a real
  // digest rather than null, so "empty" and "missing" stay distinguishable
  // without a sentinel that is not a hash.
  const sha = (expr: string) => `encode(sha256(convert_to(coalesce(${expr}, ''), 'UTF8')), 'hex')`;
  const parts = tables.map(
    (t) =>
      `select ${escapeLiteral(t)} as t, ${sha(`string_agg(x::text, '|' order by x::text)`)} as d ` +
      `from ${q(schema)}.${q(t)} x`,
  );
  return `select ${sha(`string_agg(t || ':' || d, '|' order by t)`)} as digest from (${parts.join(' union all ')}) s`;
}

function escapeLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function tableListSql(tables: string[]): string {
  return tables.map((t) => `(${escapeLiteral(t)})`).join(', ');
}

/**
 * Read metadata that affects whether the checksum proof is complete.
 *
 * The row digest proves data came back. It does not by itself prove indexes or
 * constraints came back, and it does not say whether Postgres had to rewrite a
 * table to perform the change. This snapshot makes those facts explicit.
 */
export function snapshotSql(schema: string, tables: string[]): string {
  return `
with wanted(table_name) as (values ${tableListSql(tables)})
select
  w.table_name as table,
  c.relfilenode::text as relfilenode,
  coalesce((
    select json_agg(i.indexdef order by i.indexname)
      from pg_indexes i
     where i.schemaname = ${escapeLiteral(schema)}
       and i.tablename = w.table_name
  ), '[]'::json) as indexes,
  coalesce((
    select json_agg(con.conname || ': ' || pg_get_constraintdef(con.oid) order by con.conname)
      from pg_constraint con
     where con.conrelid = c.oid
  ), '[]'::json) as constraints
from wanted w
left join pg_namespace n
  on n.nspname = ${escapeLiteral(schema)}
left join pg_class c
  on c.relnamespace = n.oid
 and c.relname = w.table_name
 and c.relkind in ('r', 'p')
order by w.table_name`;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseSnapshots(rows: unknown[]): PostgresTableSnapshot[] {
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      table: String(record.table),
      relfilenode: record.relfilenode === null || record.relfilenode === undefined ? null : String(record.relfilenode),
      indexes: asStringArray(record.indexes),
      constraints: asStringArray(record.constraints),
    };
  });
}

export function rewrittenTables(before: PostgresTableSnapshot[], after: PostgresTableSnapshot[]): string[] {
  const next = new Map(after.map((snapshot) => [snapshot.table, snapshot]));
  return before
    .filter((snapshot) => {
      const later = next.get(snapshot.table);
      return (
        snapshot.relfilenode !== null &&
        later !== undefined &&
        later.relfilenode !== null &&
        snapshot.relfilenode !== later.relfilenode
      );
    })
    .map((snapshot) => snapshot.table)
    .sort();
}

/**
 * Prove a migration against a copy of the real database.
 *
 * Every exit path drops the shadow schema. An orphaned copy of somebody's
 * production data is the worst thing this module could leave behind.
 */
export async function verifyOnPostgresShadow(input: PostgresShadowInput): Promise<PostgresShadowResult> {
  const source = input.sourceSchema ?? 'public';
  const schema = `airlock_shadow_${input.runId.replace(/[^A-Za-z0-9_]/g, '_')}`.slice(0, 60);
  // `public.users` and `users` name the same table; only the bare name is used
  // from here down. Row counts are keyed by what the caller asked for, so the
  // dossier's own table names still line up with the numbers.
  const asked = input.tables;
  const names = asked.map(bareTable);

  const base: PostgresShadowResult = {
    status: 'FAILED',
    checksums: null,
    forward_ms: null,
    table_rewrite: null,
    row_counts: {},
    metadata: null,
    forward_proven: input.forward.map(() => false),
    rollback_proven: input.rollback.map(() => false),
    failure_reason: null,
    strategy: 'SANDBOX_RESTORE',
    shadow_schema: schema,
  };

  if (input.tables.length === 0) {
    return { ...base, failure_reason: 'No tables were named, so there is nothing to checksum and nothing to prove.' };
  }

  // Refused before anything is created. See the note at the top of this file.
  for (const list of [input.forward, input.rollback]) {
    for (const statement of list) {
      const qualified = findSchemaQualifier(statement);
      if (qualified) {
        return {
          ...base,
          failure_reason:
            `This statement names ${qualified} explicitly, and a qualified name ignores search_path — ` +
            `it would run against production rather than the shadow copy, so it is refused rather than ` +
            `rewritten. Write the migration against the unqualified table name (${qualified.split('.')[1]}); ` +
            `the shadow resolves it, and so does production when the change is applied.`,
        };
      }
    }
  }

  let created = false;
  try {
    const readSnapshot = async (whichSchema: string) => parseSnapshots(await runSql(input, snapshotSql(whichSchema, names)));

    /* --- the copy ---------------------------------------------------------- */
    const sourceBefore = await readSnapshot(source);

    const copy = [
      `create schema ${q(schema)};`,
      ...names.map((t) => `create table ${q(schema)}.${q(t)} as select * from ${q(source)}.${q(t)};`),
    ].join('\n');
    await runSql(input, copy);
    created = true;
    const shadowBefore = await readSnapshot(schema);

    for (let i = 0; i < names.length; i += 1) {
      const rows = (await runSql(
        input,
        `select count(*)::int as n from ${q(schema)}.${q(names[i]!)}`,
      )) as { n: number }[];
      // Keyed by the name the caller used, so the dossier still recognises it.
      base.row_counts[asked[i]!] = rows[0]?.n ?? 0;
    }

    const readDigest = async () => {
      const rows = (await runSql(input, digestSql(schema, names))) as { digest: string }[];
      return `sha256:${rows[0]?.digest ?? 'unknown'}`;
    };

    const pre = await readDigest();

    /* --- forward ----------------------------------------------------------- */

    // One transaction, search_path confined to the shadow and nothing else.
    const runConfined = (statements: string[]) =>
      runSql(
        input,
        [`begin;`, `set local search_path to ${q(schema)};`, ...statements.map((s) => ensureSemicolon(s)), `commit;`].join(
          '\n',
        ),
      );

    const startedAt = Date.now();
    await runConfined(input.forward);
    const forwardMs = Date.now() - startedAt;
    base.forward_proven = input.forward.map(() => true);
    const shadowAfterForward = await readSnapshot(schema);

    const post = await readDigest();

    /* --- rollback ---------------------------------------------------------- */

    if (input.rollback.length > 0) {
      await runConfined(input.rollback);
      base.rollback_proven = input.rollback.map(() => true);
    }

    const postRollback = await readDigest();
    const shadowAfterRollback = await readSnapshot(schema);
    const match = pre === postRollback;
    const rewritten = rewrittenTables(shadowBefore, shadowAfterForward);

    return {
      ...base,
      status: match ? 'PROVEN' : 'FAILED',
      checksums: { pre, post, post_rollback: postRollback, match },
      forward_ms: forwardMs,
      table_rewrite: rewritten.length > 0,
      metadata: {
        source_schema: source,
        shadow_schema: schema,
        source_before: sourceBefore,
        shadow_before: shadowBefore,
        shadow_after_forward: shadowAfterForward,
        shadow_after_rollback: shadowAfterRollback,
        rewritten_tables: rewritten,
      },
      failure_reason: match
        ? null
        : `The rollback ran without error, but the data did not come back: the post-rollback digest ` +
          `${postRollback} differs from the pre-change digest ${pre}. This change is not reversible by ` +
          `the inverse supplied.`,
    };
  } catch (error) {
    return { ...base, failure_reason: `Verification could not run: ${(error as Error).message}` };
  } finally {
    if (created) {
      try {
        await runSql(input, `drop schema if exists ${q(schema)} cascade;`);
      } catch {
        // Reported nowhere useful from here, but the name is on the result so a
        // human can drop it by hand. Swallowing beats masking the real error.
      }
    }
  }
}

function ensureSemicolon(statement: string): string {
  const trimmed = statement.trim();
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
}

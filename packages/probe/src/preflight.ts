/**
 * The probe. This is the only module in AIRLOCK that opens a socket to somebody
 * else's database.
 *
 * It lives in its own package for one reason: `packages/contract` is
 * isomorphic — the same `openGate()` runs in the browser on the landing page —
 * and the moment a Postgres driver is imported into it, it stops being. So the
 * rules stay in the contract and the socket lives here, and the dependency
 * points one way.
 *
 * Everything below runs as `inspect_role`. There is no code path in this file
 * that writes, and that is not an accident of what happens to be implemented:
 * a preflight that could write would mean the read-only identity was never
 * really the resting state.
 *
 * ---------------------------------------------------------------------------
 * Measured or null. Never estimated.
 *
 * Every figure here is the result of a query, and when the query is refused or
 * fails, the field is null and the reason travels with it. That sounds obvious
 * until you are holding a preflight where `pg_database_size` was denied and the
 * obvious move is to sum `pg_total_relation_size` over the tables you *can*
 * see, call it the database size, and move on. That number would be wrong in a
 * way nobody could detect downstream — it would be smaller than the truth, it
 * would look entirely plausible, and it feeds the restore ceiling that decides
 * whether a full-fidelity certificate is even attempted.
 *
 * So the rule is mechanical: if a query did not return it, it is null.
 */
import pg from 'pg';
import {
  REQUIRED_GRANTS,
  redactSecrets,
  type MissingGrant,
  type PreflightReport,
} from '@airlock/contract';

const { Client } = pg;

export interface ProbeInput {
  /** Held here, never returned, never logged. */
  connectionString: string;
  /** Schemas the change is expected to touch. */
  schemas?: string[];
  /** Milliseconds before we give up. A hanging preflight is a failed one. */
  timeoutMs?: number;
}

/** A figure we could not obtain, and why. Mirrors PreflightReport.unavailable. */
type Unavailable = PreflightReport['unavailable'];

function unavailable(list: Unavailable, field: string, error: unknown): void {
  // Redacted before it is stored, not before it is displayed. A DSN that
  // reaches a field is already one careless log line from a transcript.
  const reason = redactSecrets(error instanceof Error ? error.message : String(error));
  list.push({ field, reason });
}

/**
 * Ask the live database everything onboarding needs to answer.
 *
 * Each measurement is attempted independently. A role that can connect but
 * cannot read `pg_database_size` should still produce a usable report with one
 * named gap — bailing on the first refusal would collapse "you are missing one
 * optional grant" into "we could not connect", which are different problems
 * with different fixes.
 */
export async function runPreflight(input: ProbeInput): Promise<PreflightReport> {
  const schemas = input.schemas ?? ['public'];
  const readAt = new Date().toISOString();
  const gaps: Unavailable = [];

  const client = new Client({
    connectionString: input.connectionString,
    connectionTimeoutMillis: input.timeoutMs ?? 10_000,
    statement_timeout: input.timeoutMs ?? 10_000,
    application_name: 'airlock-preflight',
  });

  try {
    await client.connect();
  } catch (error) {
    // The one place a driver error is allowed to become user-facing text, and
    // it goes through redaction on the way. node-postgres puts the whole DSN in
    // some of these.
    return {
      reachable: false,
      failure: redactSecrets(error instanceof Error ? error.message : String(error)),
      server_version: null,
      database_bytes: null,
      ssl_in_use: null,
      is_superuser: null,
      missing_grants: [],
      unavailable: [],
      read_at: readAt,
    };
  }

  try {
    let serverVersion: string | null = null;
    let databaseBytes: number | null = null;
    let sslInUse: boolean | null = null;
    let isSuperuser: boolean | null = null;

    try {
      // `current_setting`, not `SHOW server_version`. SHOW returns a column
      // named after the setting and ignores an alias, so reading `rows[0].v`
      // silently produced undefined -> null, with no exception and therefore no
      // entry in `unavailable`. That is a null with no reason attached, which is
      // precisely the shape rule R2 exists to forbid — and it is worse than a
      // wrong value because it looks like a considered "unknown".
      const { rows } = await client.query<{ v: string }>("SELECT current_setting('server_version') AS v");
      serverVersion = rows[0]?.v ?? null;
      if (serverVersion === null) unavailable(gaps, 'server_version', 'the server returned no value');
    } catch (error) {
      unavailable(gaps, 'server_version', error);
    }

    try {
      // `rolsuper` on the role we actually connected as. current_user rather
      // than session_user so a SET ROLE is reflected — the question is what
      // this connection can do now, not who logged in.
      const { rows } = await client.query<{ super: boolean }>(
        'SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user',
      );
      isSuperuser = rows[0]?.super ?? null;
    } catch (error) {
      unavailable(gaps, 'is_superuser', error);
    }

    try {
      const { rows } = await client.query<{ bytes: string }>(
        'SELECT pg_database_size(current_database())::text AS bytes',
      );
      databaseBytes = rows[0] ? Number(rows[0].bytes) : null;
    } catch (error) {
      // Deliberately not substituted with a sum over visible tables. See the
      // header: a plausible undercount here silently changes which shadow
      // strategy is chosen.
      unavailable(gaps, 'database_bytes', error);
    }

    try {
      // pg_stat_ssl is per-backend; ours is the one with our pid.
      const { rows } = await client.query<{ ssl: boolean }>(
        'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
      );
      sslInUse = rows[0]?.ssl ?? null;
    } catch (error) {
      unavailable(gaps, 'ssl_in_use', error);
    }

    const missing = await checkGrants(client, schemas);

    return {
      reachable: true,
      failure: null,
      server_version: serverVersion,
      database_bytes: databaseBytes,
      ssl_in_use: sslInUse,
      is_superuser: isSuperuser,
      missing_grants: missing,
      unavailable: gaps,
      read_at: readAt,
    };
  } finally {
    // Released whatever happened. A preflight that leaks a connection on the
    // error path is a preflight that exhausts somebody's connection pool the
    // first time their credentials are wrong.
    await client.end().catch(() => {});
  }
}

/**
 * Which of the grants AIRLOCK needs this role actually has.
 *
 * Asked with `has_*_privilege`, which answers for the *current role including
 * inherited membership*, rather than by reading `information_schema` grant
 * tables directly. Those miss privileges held through a group role, which is
 * how most production setups are wired — a check that reported "missing
 * SELECT" to somebody who has it through a group would be worse than no check,
 * because they would go and grant it again and it still would not explain
 * anything.
 */
async function checkGrants(client: pg.Client, schemas: string[]): Promise<MissingGrant[]> {
  const missing: MissingGrant[] = [];
  const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

  const add = (id: string, remedy: string) => {
    const spec = REQUIRED_GRANTS.find((g) => g.id === id);
    if (!spec) return;
    missing.push({ id: spec.id, privilege: spec.privilege, why: spec.why, required: spec.required, remedy });
  };

  try {
    const { rows } = await client.query<{ ok: boolean }>(
      'SELECT has_database_privilege(current_database(), $1) AS ok',
      ['CONNECT'],
    );
    if (rows[0]?.ok === false) {
      add('connect', `GRANT CONNECT ON DATABASE ${q('<database>')} TO ${q('airlock_inspect')};`);
    }
  } catch {
    // If we cannot ask, we do not answer. Reporting a grant as present because
    // the question failed is the exact inversion of the rule.
  }

  for (const schema of schemas) {
    try {
      const { rows } = await client.query<{ ok: boolean }>('SELECT has_schema_privilege($1, $2) AS ok', [
        schema,
        'USAGE',
      ]);
      if (rows[0]?.ok === false) {
        add('schema_usage', `GRANT USAGE ON SCHEMA ${q(schema)} TO ${q('airlock_inspect')};`);
      }
    } catch {
      /* unanswerable; see above */
    }

    try {
      // Every table in the schema has to be readable, because a checksum over
      // "the tables we happened to be allowed to see" is not a checksum over
      // the change. One unreadable table is a missing grant.
      //
      // Counted from `pg_class`, NOT `information_schema.tables`. The
      // information_schema views are themselves privilege-filtered: a role with
      // no rights on a table cannot see the table's row in them at all. So the
      // obvious query — count the tables you cannot SELECT — returned zero for
      // a role that could read nothing, and this check reported a clean bill of
      // health for exactly the connection it exists to reject.
      //
      // Verified against a live Postgres: the same role sees 0 tables through
      // information_schema and 2 through pg_class.
      const { rows } = await client.query<{ unreadable: string }>(
        `SELECT count(*)::text AS unreadable
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
            AND c.relkind IN ('r', 'p')
            AND NOT has_table_privilege(c.oid, 'SELECT')`,
        [schema],
      );
      if (Number(rows[0]?.unreadable ?? 0) > 0) {
        add(
          'table_select',
          `GRANT SELECT ON ALL TABLES IN SCHEMA ${q(schema)} TO ${q('airlock_inspect')};\n` +
            `ALTER DEFAULT PRIVILEGES IN SCHEMA ${q(schema)} GRANT SELECT ON TABLES TO ${q('airlock_inspect')};`,
        );
      }
    } catch {
      /* unanswerable; see above */
    }
  }

  try {
    const { rows } = await client.query<{ ok: boolean }>(
      "SELECT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS ok",
    );
    if (rows[0]?.ok === false) {
      add('read_all_stats', `GRANT pg_read_all_stats TO ${q('airlock_inspect')};`);
    }
  } catch {
    /* unanswerable; see above */
  }

  return missing;
}

/**
 * Total size of the tables a change touches.
 *
 * This is what the restore ceiling is actually measured against — see
 * `resolveShadowStrategy`. Null when it cannot be read, which pushes the
 * resolver to SCHEMA_ONLY rather than letting it start a restore on a size
 * nobody measured.
 */
export async function measureScopeBytes(
  input: ProbeInput,
  tables: Array<{ schema: string; name: string }>,
): Promise<number | null> {
  if (tables.length === 0) return null;

  const client = new Client({
    connectionString: input.connectionString,
    connectionTimeoutMillis: input.timeoutMs ?? 10_000,
    application_name: 'airlock-preflight',
  });

  try {
    await client.connect();
    const qualified = tables.map((t) => `${t.schema}.${t.name}`);
    const { rows } = await client.query<{ bytes: string }>(
      `SELECT COALESCE(sum(pg_total_relation_size(c.oid)), 0)::text AS bytes
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname || '.' || c.relname = ANY($1::text[])`,
      [qualified],
    );
    return rows[0] ? Number(rows[0].bytes) : null;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

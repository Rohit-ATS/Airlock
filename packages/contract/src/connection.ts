/**
 * A connection to somebody else's production database.
 *
 * This is the module where AIRLOCK stops being a demo. Up to now every number
 * in a certificate came from a fixture we wrote; from here they come from a
 * database we have never seen, belonging to someone who is trusting us with it.
 * That changes what the code has to be careful about, in three specific ways.
 *
 * ---------------------------------------------------------------------------
 * 1. Two identities, and the read-only one is the default
 *
 * A connection carries two credentials, never one:
 *
 *   inspect_role  read-only. Everything up to and including the certificate
 *                 runs as this. Investigation, schema reads, row counts,
 *                 checksums — all of it.
 *   apply_role    DDL/DML capable. Loaded ONLY after a human opens the gate,
 *                 used ONLY for the exact approved statements, released
 *                 immediately afterwards.
 *
 * The agent's resting state is read-only. Elevation is an *event*, and it is
 * written into the audit record, because "when did this system last hold write
 * credentials on my database" is a question an operator is entitled to answer
 * exactly rather than approximately.
 *
 * 2. A superuser credential is refused, not warned about
 *
 * Every product that accepts a database URL warns about superuser and accepts
 * it anyway, which is the same as not warning. AIRLOCK refuses and hands back
 * the SQL to create a correctly scoped role instead — see `inspectRoleSql`.
 * Refusing costs us a few seconds of onboarding; accepting costs the user the
 * entire benefit of the read-only identity, silently, forever.
 *
 * 3. The connection string never exists anywhere a model can see
 *
 * Not in tool arguments, not in agent-visible state, not in a log line, not in
 * an error message, not in a stack trace, not in the UI. `redactSecrets` is the
 * chokepoint and `connection.test.mjs` scans a whole transcript for the string
 * to prove it. A credential that leaks into a transcript has leaked into the
 * model provider, the trace store and anywhere the transcript is later pasted.
 */

/* -------------------------------------------------------------------------- */
/* What is safe to hold, and what is not                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything about a connection that is safe to render, log, put in a tool
 * result, or hand to a model.
 *
 * Deliberately has no `user` and no `password` field — not "an optional one",
 * not "a redacted one". A shape that cannot hold a secret cannot leak one, and
 * that is a stronger guarantee than a rule about being careful.
 */
export interface ConnectionRef {
  id: string;
  /** What the operator called it. "prod-eu", not a hostname. */
  label: string;
  host: string;
  port: number;
  database: string;
  /** What the server negotiated, not what was requested. */
  ssl: 'require' | 'prefer' | 'disable' | 'unknown';
  provider: ConnectionProvider;
  created_at: string;
}

/**
 * Who runs the database. This is not cosmetic — it decides which shadow
 * strategies are even available, because a provider with native branching can
 * give us a full-fidelity copy and a generic host cannot.
 */
export const CONNECTION_PROVIDERS = ['supabase', 'neon', 'rds', 'cloudsql', 'generic'] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

/** Which of the two identities a statement is running as. */
export const CONNECTION_ROLES = ['inspect', 'apply'] as const;
export type ConnectionRole = (typeof CONNECTION_ROLES)[number];

/* -------------------------------------------------------------------------- */
/* Redaction — the chokepoint for R4                                           */
/* -------------------------------------------------------------------------- */

/**
 * Anything shaped like a credential, replaced.
 *
 * Applied to every string that could reach a model, a log, or a screen: error
 * messages, stack traces, preflight failures, tool results. It is deliberately
 * aggressive and deliberately not clever — a false positive costs a reader one
 * unhelpful line, and a false negative costs somebody their database.
 *
 * The patterns cover the three shapes a Postgres credential actually arrives
 * in, which is worth stating because a regex over `postgres://` alone misses
 * two of them:
 *
 *   postgres://user:secret@host/db     URI form, the obvious one
 *   password=secret                    keyword/value form, used by libpq
 *   PGPASSWORD=secret                  the environment variable
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // URI form. Keeps the scheme and host so an error stays diagnosable — you can
  // still see *which* database failed, just not how to open it.
  [/\b(postgres(?:ql)?:\/\/)[^:@\s/]+:[^@\s]+@/gi, '$1[redacted]:[redacted]@'],
  // URI form with no password. Still an identity; still not the model's business.
  [/\b(postgres(?:ql)?:\/\/)[^:@\s/]+@/gi, '$1[redacted]@'],
  [/\bpassword\s*=\s*("[^"]*"|'[^']*'|[^\s;&]+)/gi, 'password=[redacted]'],
  [/\bPGPASSWORD\s*=\s*("[^"]*"|'[^']*'|[^\s;&]+)/gi, 'PGPASSWORD=[redacted]'],
];

export function redactSecrets(input: unknown): string {
  let text = typeof input === 'string' ? input : String(input ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/**
 * Redact recursively through an object before it crosses a boundary.
 *
 * Errors are the leak nobody plans for: a driver throws with the DSN in
 * `err.message`, something logs the whole object, and the string is now in a
 * transcript. Every error that leaves the connection layer goes through here.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as T;
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Grants — what inspect_role has to be able to do                             */
/* -------------------------------------------------------------------------- */

/**
 * One capability AIRLOCK needs, why it needs it, and how to grant it.
 *
 * `why` is carried all the way to the UI on purpose. "GRANT USAGE ON SCHEMA
 * public" tells an operator what to type; it does not tell them what they are
 * agreeing to. Somebody pasting SQL against their production database is owed
 * the second thing.
 */
export interface RequiredGrant {
  id: string;
  /** The privilege in Postgres terms. */
  privilege: string;
  /** What breaks without it, in one sentence. */
  why: string;
  /**
   * False when AIRLOCK still works without it, in a reduced way. Used to tell
   * "you cannot connect" apart from "you can connect but lock estimates will
   * be unavailable", which are very different messages.
   */
  required: boolean;
}

export const REQUIRED_GRANTS: readonly RequiredGrant[] = [
  {
    id: 'connect',
    privilege: 'CONNECT ON DATABASE',
    why: 'Without it nothing else can be attempted.',
    required: true,
  },
  {
    id: 'schema_usage',
    privilege: 'USAGE ON SCHEMA',
    why: 'Needed to see that the tables in a change exist at all.',
    required: true,
  },
  {
    id: 'table_select',
    privilege: 'SELECT ON TABLES',
    why: 'Row counts and checksums are computed by reading the rows. Estimating them instead would put an invented number in a field that reads as measured.',
    required: true,
  },
  {
    id: 'read_all_stats',
    privilege: 'pg_read_all_stats',
    why: 'Index sizes and table statistics. Without it those fields are reported as unavailable rather than guessed.',
    required: false,
  },
];

/** A grant the connected role turned out not to have. */
export interface MissingGrant {
  id: string;
  privilege: string;
  why: string;
  required: boolean;
  /** The exact statement that fixes it, ready to paste. */
  remedy: string;
}

/* -------------------------------------------------------------------------- */
/* The role snippet                                                            */
/* -------------------------------------------------------------------------- */

export interface InspectRoleOptions {
  database: string;
  schemas?: string[];
  roleName?: string;
}

/**
 * SQL that creates a correctly scoped read-only role.
 *
 * This is the thing offered when a superuser credential is refused, and it is
 * why refusing is reasonable rather than obstructive: the alternative is not
 * "go and work out the right grants", it is "paste this".
 *
 * The password is deliberately left as a placeholder rather than generated. A
 * secret this function invented would have to travel back to the user somehow —
 * through a response body, a log, a screen, probably a screenshot — and every
 * one of those is a worse place for it than a password manager.
 */
export function inspectRoleSql({ database, schemas = ['public'], roleName = 'airlock_inspect' }: InspectRoleOptions): string {
  const q = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
  const lines: string[] = [
    '-- AIRLOCK read-only inspection role.',
    '-- Everything up to and including a certificate runs as this identity.',
    '-- Replace the password, and keep it in a password manager rather than a terminal.',
    '',
    `CREATE ROLE ${q(roleName)} LOGIN PASSWORD 'replace-me';`,
    '',
    `GRANT CONNECT ON DATABASE ${q(database)} TO ${q(roleName)};`,
  ];

  for (const schema of schemas) {
    lines.push(
      '',
      `GRANT USAGE ON SCHEMA ${q(schema)} TO ${q(roleName)};`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA ${q(schema)} TO ${q(roleName)};`,
      // Without this, a table created tomorrow is invisible, and the failure
      // arrives as "relation does not exist" during a certificate run rather
      // than as a missing grant during preflight.
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${q(schema)} GRANT SELECT ON TABLES TO ${q(roleName)};`,
    );
  }

  lines.push(
    '',
    '-- Optional. Index and table statistics. Without it those figures are',
    '-- reported as unavailable rather than estimated.',
    `GRANT pg_read_all_stats TO ${q(roleName)};`,
  );

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* What onboarding has to say out loud                                         */
/* -------------------------------------------------------------------------- */

/**
 * The disclosure, as data rather than as copy buried in a component.
 *
 * Producing a certificate means executing the user's migration against a copy
 * of their real data. That is the honest description of what this product does,
 * it is the part a careful engineer will want to know before connecting a
 * production database, and burying it would make every other safety claim here
 * read as marketing.
 *
 * Kept in the contract so the console, the CLI and the API all say the same
 * thing, and so a change to it is a change to a tested value.
 */
export const DATA_HANDLING_DISCLOSURE = [
  {
    heading: 'A certificate requires running your change against real data',
    body: 'Proving a migration is reversible means executing it, then executing its rollback, then comparing checksums. That cannot be done against a description of your database — it is done against a copy of it.',
  },
  {
    heading: 'The copy lives in an ephemeral sandbox',
    body: 'The sandbox is network-restricted, holds only the tables your change touches, and is destroyed when the run ends — on success, on failure, on abort, and on process death. A reaper removes orphans on startup.',
  },
  {
    heading: 'We connect read-only until you approve',
    body: 'Everything up to the certificate runs as a read-only role. Write credentials are loaded only after a human opens the gate, used only for the approved statements, and released immediately.',
  },
  {
    heading: 'Your credentials never reach the model',
    body: 'Connection details are encrypted at rest and held in the harness. They are not placed in model context, tool arguments, logs or the interface.',
  },
] as const;

/* -------------------------------------------------------------------------- */
/* The preflight report                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a probe of a live database found.
 *
 * Every measurable field is `T | null`, and `null` always travels with a reason
 * in `unavailable`. That is rule R2 expressed in a type: there is nowhere in
 * this shape to put a plausible number, so the only way to report a figure is
 * to have measured it.
 */
export interface PreflightReport {
  reachable: boolean;
  /** Redacted. Present only when `reachable` is false. */
  failure: string | null;

  server_version: string | null;
  database_bytes: number | null;
  ssl_in_use: boolean | null;

  /** True means the connection is refused — see `superuserRefusal`. */
  is_superuser: boolean | null;

  missing_grants: MissingGrant[];

  /** Fields that could not be measured, each with why. */
  unavailable: Array<{ field: string; reason: string }>;

  /** When this was read. Rendered in the UI; a stale reading is a claim. */
  read_at: string;
}

/** A preflight that found a superuser, and the refusal that follows. */
export interface SuperuserRefusal {
  refused: true;
  reason: string;
  remedy_sql: string;
}

export function superuserRefusal(options: InspectRoleOptions): SuperuserRefusal {
  return {
    refused: true,
    reason:
      'That credential is a superuser. AIRLOCK will not hold one: the read-only identity is the control that makes everything before the gate safe, and a superuser credential silently removes it. Create a scoped role instead — the SQL below does it.',
    remedy_sql: inspectRoleSql(options),
  };
}

/**
 * Is this connection usable at all?
 *
 * Separated from "is it perfect" deliberately. A connection missing only
 * `pg_read_all_stats` is usable, and should be reported as usable with a named
 * gap, rather than rejected — otherwise the honest degradation this whole
 * design is built around never gets exercised.
 */
export function connectionUsable(report: PreflightReport): boolean {
  if (!report.reachable) return false;
  if (report.is_superuser === true) return false;
  return report.missing_grants.every((g) => !g.required);
}

/** One line for the console. */
export function describePreflight(report: PreflightReport): string {
  if (!report.reachable) return report.failure ?? 'Could not reach the database.';
  if (report.is_superuser === true) return 'Refused: that credential is a superuser.';

  const blocking = report.missing_grants.filter((g) => g.required);
  if (blocking.length > 0) {
    return `Missing ${blocking.length} required grant${blocking.length === 1 ? '' : 's'}: ${blocking
      .map((g) => g.privilege)
      .join(', ')}.`;
  }

  const parts = [`PostgreSQL ${report.server_version ?? 'unknown version'}`];
  if (report.database_bytes !== null) parts.push(formatBytes(report.database_bytes));
  if (report.ssl_in_use === true) parts.push('SSL');
  if (report.unavailable.length > 0) parts.push(`${report.unavailable.length} figure(s) unavailable`);
  return parts.join(' · ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

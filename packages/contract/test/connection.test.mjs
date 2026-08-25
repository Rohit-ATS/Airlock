/**
 * Connections to somebody else's production database, tested.
 *
 * The properties worth pinning here are all refusals and all about secrets,
 * because this is the module where a mistake costs a stranger their database
 * rather than costing us a failing test:
 *
 *   - **A superuser credential is refused**, and the refusal carries the SQL
 *     that makes refusing reasonable rather than obstructive.
 *   - **The connection string never survives a round trip.** The test builds a
 *     realistic session transcript — tool arguments, a driver error with the
 *     DSN in its message, a stack trace, a log line — pushes it through the
 *     redaction chokepoint, and greps the result for the password. Zero hits,
 *     or the test fails. That is acceptance test T5.
 *   - **An unmeasurable figure is null with a reason**, never a plausible
 *     number. There is deliberately nowhere in `PreflightReport` to put an
 *     estimate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_HANDLING_DISCLOSURE,
  REQUIRED_GRANTS,
  connectionUsable,
  describePreflight,
  formatBytes,
  inspectRoleSql,
  redactDeep,
  redactSecrets,
  superuserRefusal,
} from '../dist/index.js';

const PASSWORD = 'hunter2-s3cret-do-not-leak';
const DSN = `postgresql://airlock_inspect:${PASSWORD}@db.prod.example.com:5432/orders?sslmode=require`;

function report(overrides = {}) {
  return {
    reachable: true,
    failure: null,
    server_version: '16.3',
    database_bytes: 8_402_141_184,
    ssl_in_use: true,
    is_superuser: false,
    missing_grants: [],
    unavailable: [],
    read_at: '2026-08-25T09:00:00Z',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* R4 — the connection string never reaches the model                          */
/* -------------------------------------------------------------------------- */

test('T5: a full session transcript contains no trace of the connection string', () => {
  // Everything that has ever leaked a DSN in a real system, in one object.
  const transcript = {
    events: [
      { type: 'tool.call', name: 'probe', arguments: { dsn: DSN } },
      { type: 'model.message', content: `Connecting with ${DSN} …` },
      {
        type: 'tool.response',
        error: {
          message: `connection to server at "db.prod.example.com" failed: password authentication failed for user "airlock_inspect" (${DSN})`,
          stack: [
            'Error: connect ECONNREFUSED',
            `    at Client.connect (/app/node_modules/pg/lib/client.js:1:1) { dsn: '${DSN}' }`,
          ].join('\n'),
        },
      },
    ],
    logs: [
      `[airlock] preflight start ${DSN}`,
      `[pg] PGPASSWORD=${PASSWORD} psql -h db.prod.example.com`,
      `[airlock] libpq string: host=db.prod.example.com password=${PASSWORD} dbname=orders`,
    ],
  };

  const cleaned = JSON.stringify(redactDeep(transcript));

  assert.equal(cleaned.includes(PASSWORD), false, 'the password survived redaction');
  assert.match(cleaned, /\[redacted\]/, 'nothing was redacted at all, which means the scan proves nothing');

  // The host is deliberately still there. An error nobody can diagnose is its
  // own failure mode, and the host is not the secret.
  assert.match(cleaned, /db\.prod\.example\.com/);
});

test('every shape a Postgres credential actually arrives in is covered', () => {
  const cases = [
    `postgres://u:${PASSWORD}@h/db`,
    `postgresql://u:${PASSWORD}@h:5432/db`,
    `password=${PASSWORD}`,
    `password='${PASSWORD}'`,
    `PGPASSWORD=${PASSWORD}`,
  ];
  for (const c of cases) {
    assert.equal(redactSecrets(c).includes(PASSWORD), false, `leaked: ${c}`);
  }
});

test('a URI with no password is still redacted, because the user is an identity too', () => {
  const out = redactSecrets('postgres://airlock_inspect@db.prod.example.com/orders');
  assert.equal(out.includes('airlock_inspect'), false);
});

test('redaction leaves ordinary text alone', () => {
  const text = 'The migration adds a column to users and the rollback drops it.';
  assert.equal(redactSecrets(text), text);
});

test('redactDeep preserves structure and non-string values', () => {
  const out = redactDeep({ n: 42, b: true, nested: { list: ['ok', `password=${PASSWORD}`] } });
  assert.equal(out.n, 42);
  assert.equal(out.b, true);
  assert.equal(out.nested.list[0], 'ok');
  assert.equal(out.nested.list[1].includes(PASSWORD), false);
});

/* -------------------------------------------------------------------------- */
/* R3 — a superuser credential is refused, not warned about                    */
/* -------------------------------------------------------------------------- */

test('a superuser connection is refused and the refusal carries the fix', () => {
  const refusal = superuserRefusal({ database: 'orders' });
  assert.equal(refusal.refused, true);
  assert.match(refusal.reason, /superuser/i);
  assert.match(refusal.remedy_sql, /CREATE ROLE "airlock_inspect" LOGIN/);
  assert.match(refusal.remedy_sql, /GRANT CONNECT ON DATABASE "orders"/);
});

test('a superuser report is not usable however healthy everything else looks', () => {
  assert.equal(connectionUsable(report({ is_superuser: true })), false);
  assert.match(describePreflight(report({ is_superuser: true })), /superuser/i);
});

/* -------------------------------------------------------------------------- */
/* The role snippet                                                            */
/* -------------------------------------------------------------------------- */

test('the generated role is read-only — it grants no write privilege anywhere', () => {
  const sql = inspectRoleSql({ database: 'orders', schemas: ['public', 'billing'] });

  // Checked against the GRANT lines specifically. Scanning the whole snippet
  // for "CREATE" fails on `CREATE ROLE`, which is the one statement that has
  // to be there — a test that cannot tell those apart would force the code to
  // get worse to satisfy it.
  const grants = sql.split(/\r?\n/).filter((l) => l.trim().toUpperCase().startsWith('GRANT'));
  assert.ok(grants.length > 0, 'no GRANT lines to check');
  for (const line of grants) {
    for (const forbidden of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'CREATE', 'ALTER', 'ALL PRIVILEGES']) {
      assert.equal(line.toUpperCase().includes(forbidden), false, `grants ${forbidden}: ${line}`);
    }
  }
  assert.equal(sql.toUpperCase().includes('SUPERUSER'), false);
  assert.match(sql, /GRANT SELECT ON ALL TABLES IN SCHEMA "public"/);
  assert.match(sql, /GRANT SELECT ON ALL TABLES IN SCHEMA "billing"/);
});

test('default privileges are granted, so a table created tomorrow is not invisible', () => {
  // Without this the failure surfaces mid-certificate as "relation does not
  // exist", which reads as a broken product rather than a missing grant.
  assert.match(inspectRoleSql({ database: 'orders' }), /ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT/);
});

test('identifiers are quoted, so a database named with a quote cannot inject', () => {
  const sql = inspectRoleSql({ database: 'we"ird' });
  assert.match(sql, /GRANT CONNECT ON DATABASE "we""ird"/);
});

test('the snippet never invents a password', () => {
  // A secret this function generated would have to travel back to the user
  // through a response, a log or a screenshot — all worse than a password
  // manager.
  assert.match(inspectRoleSql({ database: 'orders' }), /PASSWORD 'replace-me'/);
});

/* -------------------------------------------------------------------------- */
/* R2 — unmeasured is null with a reason, never an estimate                    */
/* -------------------------------------------------------------------------- */

test('a figure that could not be measured is null and says why', () => {
  const r = report({
    database_bytes: null,
    unavailable: [{ field: 'database_bytes', reason: 'pg_database_size denied: role lacks pg_read_all_stats' }],
  });
  assert.equal(r.database_bytes, null);
  assert.equal(r.unavailable.length, 1);
  assert.match(describePreflight(r), /1 figure\(s\) unavailable/);
});

test('a connection missing only an optional grant is still usable', () => {
  // The whole design depends on degrading honestly rather than refusing, so
  // this path has to stay open or that behaviour is never exercised.
  const r = report({
    missing_grants: [
      {
        id: 'read_all_stats',
        privilege: 'pg_read_all_stats',
        why: 'Index sizes.',
        required: false,
        remedy: 'GRANT pg_read_all_stats TO "airlock_inspect";',
      },
    ],
  });
  assert.equal(connectionUsable(r), true);
});

test('T1: a missing required grant is named, with the statement that fixes it', () => {
  const r = report({
    missing_grants: [
      {
        id: 'table_select',
        privilege: 'SELECT ON TABLES',
        why: 'Row counts and checksums are computed by reading the rows.',
        required: true,
        remedy: 'GRANT SELECT ON ALL TABLES IN SCHEMA "public" TO "airlock_inspect";',
      },
    ],
  });
  assert.equal(connectionUsable(r), false);
  const line = describePreflight(r);
  assert.match(line, /SELECT ON TABLES/);
  assert.equal(r.missing_grants[0].remedy.length > 0, true);
});

test('an unreachable database reports a redacted failure and nothing else', () => {
  const r = report({
    reachable: false,
    failure: redactSecrets(`could not connect: ${DSN}`),
    server_version: null,
    database_bytes: null,
    ssl_in_use: null,
    is_superuser: null,
  });
  assert.equal(connectionUsable(r), false);
  assert.equal(r.failure.includes(PASSWORD), false);
});

/* -------------------------------------------------------------------------- */
/* Onboarding says what it does                                                */
/* -------------------------------------------------------------------------- */

test('the disclosure names the sandbox, the copy, and the teardown', () => {
  const all = DATA_HANDLING_DISCLOSURE.map((d) => `${d.heading} ${d.body}`).join(' ').toLowerCase();
  assert.match(all, /copy of/);
  assert.match(all, /sandbox/);
  assert.match(all, /destroyed/);
  assert.match(all, /read-only/);
});

test('every required grant explains what breaks without it', () => {
  for (const g of REQUIRED_GRANTS) {
    assert.ok(g.why.length > 20, `${g.id} needs a real reason, not a label`);
  }
});

test('byte formatting is readable at every scale', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024 * 1024 * 1024 * 8), '8.0 GB');
});

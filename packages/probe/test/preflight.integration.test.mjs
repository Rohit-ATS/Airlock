/**
 * T1 and T2, against a real PostgreSQL server.
 *
 * These are integration tests and they are deliberately not part of `npm test`.
 * They need a live database, and a suite that fails because Docker was not
 * running trains people to ignore failures — which costs more than the
 * coverage is worth.
 *
 * To run them:
 *
 *   docker run -d --name airlock-testdb -e POSTGRES_PASSWORD=probe-secret-pw \
 *     -e POSTGRES_DB=orders -p 55432:5432 postgres:17
 *   AIRLOCK_TEST_ADMIN_DSN=postgresql://postgres:probe-secret-pw@localhost:55432/orders \
 *     node --test packages/probe/test/preflight.integration.test.mjs
 *
 * The suite creates its own under-privileged role, grants it nothing, asserts
 * the preflight names what is missing, then grants SELECT and asserts the
 * verdict flips. Both halves matter: a check that always reports "missing" is
 * as useless as one that never does, and only running the second half proves
 * the first was measuring something.
 *
 * Two bugs were found by running this rather than by reasoning about it, and
 * both are the kind that pass a unit test:
 *
 *   1. `SHOW server_version` ignores a column alias, so the version read back
 *      as undefined -> null with no exception and therefore no reason recorded.
 *      A null with no reason is exactly what rule R2 forbids, and it is worse
 *      than a wrong value because it reads as a considered "unknown".
 *
 *   2. `information_schema.tables` is itself privilege-filtered. A role with no
 *      rights sees zero rows in it, so "count the tables I cannot SELECT"
 *      returned 0 and the check reported a clean bill of health for precisely
 *      the connection it exists to reject. Counting from `pg_class` fixes it —
 *      verified live: the same role sees 0 tables through information_schema
 *      and 2 through pg_class.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { runPreflight, measureScopeBytes } from '../dist/index.js';
import {
  connectionUsable,
  permittedCertificateKind,
  resolveShadowStrategy,
} from '@airlock/contract';

const ADMIN = process.env.AIRLOCK_TEST_ADMIN_DSN;
const ROLE = 'airlock_probe_test';
const ROLE_PW = 'probe-inspect-pw';

/** Skip rather than fail when there is no database to talk to. */
const options = ADMIN ? {} : { skip: 'set AIRLOCK_TEST_ADMIN_DSN to run (see the header)' };

function inspectDsn() {
  const u = new URL(ADMIN);
  u.username = ROLE;
  u.password = ROLE_PW;
  return u.toString();
}

async function admin(statements) {
  const client = new pg.Client({ connectionString: ADMIN });
  await client.connect();
  try {
    for (const sql of statements) await client.query(sql);
  } finally {
    await client.end();
  }
}

test('T1: a real database with an under-privileged role names the missing grants', options, async () => {
  await admin([
    `CREATE TABLE IF NOT EXISTS probe_customers (id bigserial primary key, email text, country_code text)`,
    `DROP ROLE IF EXISTS ${ROLE}`,
    `CREATE ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PW}'`,
    `GRANT CONNECT ON DATABASE ${new URL(ADMIN).pathname.slice(1)} TO ${ROLE}`,
    `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
  ]);

  const report = await runPreflight({ connectionString: inspectDsn() });

  assert.equal(report.reachable, true);
  assert.equal(report.is_superuser, false, 'the probe role must not be a superuser');

  // The version is a real measurement, not a null that nobody explained.
  assert.ok(report.server_version, 'server_version should have been measured');
  assert.equal(
    report.unavailable.some((u) => u.field === 'server_version'),
    false,
  );

  const blocking = report.missing_grants.filter((g) => g.required);
  assert.equal(blocking.length > 0, true, 'a role with no SELECT must be reported as missing it');
  assert.equal(
    blocking.some((g) => /SELECT/i.test(g.privilege)),
    true,
    'the missing grant is named, not merely counted',
  );
  assert.match(blocking[0].remedy, /GRANT SELECT/i, 'and it carries the statement that fixes it');
  assert.equal(connectionUsable(report), false);
});

test('granting the missing privilege flips the verdict', options, async () => {
  // Without this, T1 could pass because the check always reports "missing".
  await admin([`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE}`]);

  const report = await runPreflight({ connectionString: inspectDsn() });
  assert.equal(report.missing_grants.filter((g) => g.required).length, 0);
  assert.equal(connectionUsable(report), true);
});

test('T2: a real table of 1M+ rows is measured, and resolves to SANDBOX_RESTORE', options, async () => {
  const { rows } = await (async () => {
    const c = new pg.Client({ connectionString: ADMIN });
    await c.connect();
    try {
      const existing = await c.query('SELECT count(*)::bigint AS n FROM probe_customers');
      if (Number(existing.rows[0].n) < 1_000_000) {
        await c.query(
          `INSERT INTO probe_customers (email, country_code)
           SELECT 'user'||g||'@example.com', (ARRAY['DE','FR','GB','US'])[1+(g%4)]
             FROM generate_series(1, ${1_000_000 - Number(existing.rows[0].n)}) g`,
        );
        await c.query('ANALYZE probe_customers');
      }
      return await c.query('SELECT count(*)::bigint AS n FROM probe_customers');
    } finally {
      await c.end();
    }
  })();

  assert.ok(Number(rows[0].n) >= 1_000_000, 'the fixture-free table really holds a million rows');

  const input = { connectionString: inspectDsn() };
  const report = await runPreflight(input);
  const scopeBytes = await measureScopeBytes(input, [{ schema: 'public', name: 'probe_customers' }]);

  // Measured, not estimated. Both come from the server.
  assert.ok(report.database_bytes && report.database_bytes > 0, 'database size was measured');
  assert.ok(scopeBytes && scopeBytes > 0, 'scope size was measured');

  const decision = resolveShadowStrategy({
    provider: 'generic',
    database_bytes: report.database_bytes,
    scope_bytes: scopeBytes,
    sandbox_available: true,
  });

  assert.equal(decision.strategy, 'SANDBOX_RESTORE');
  assert.equal(decision.can_prove_rollback, true);
  assert.equal(permittedCertificateKind(decision.strategy), 'UNDO');
});

test('the same connection with no sandbox degrades honestly', options, async () => {
  const input = { connectionString: inspectDsn() };
  const report = await runPreflight(input);

  const decision = resolveShadowStrategy({
    provider: 'generic',
    database_bytes: report.database_bytes,
    sandbox_available: false,
  });

  assert.equal(decision.strategy, 'SCHEMA_ONLY');
  assert.equal(permittedCertificateKind(decision.strategy), 'SCOPE');
  assert.match(
    decision.rejected.find((r) => r.strategy === 'SANDBOX_RESTORE').because,
    /No sandbox is configured/,
  );
});

test('T5 holds against a real driver error: a bad password never reaches the report', options, async () => {
  const u = new URL(ADMIN);
  u.username = ROLE;
  u.password = 'definitely-the-wrong-password-9f2a';

  const report = await runPreflight({ connectionString: u.toString() });

  assert.equal(report.reachable, false);
  assert.ok(report.failure, 'a failure should be explained');
  assert.equal(
    report.failure.includes('definitely-the-wrong-password-9f2a'),
    false,
    'node-postgres puts credentials in some of these messages; redaction has to survive a real one',
  );
});

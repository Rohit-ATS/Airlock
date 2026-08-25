/**
 * The shadow strategy resolver, tested.
 *
 * The property this whole module exists for is a refusal: **a strategy that
 * never executed against real rows cannot produce an UNDO certificate.** Every
 * other test here is in service of that one, because the tempting version of
 * this feature is the one that quietly falls back to "we read the schema and it
 * looks reversible", renders the same green card, and is wrong in exactly the
 * cases where being wrong costs somebody their data.
 *
 * The other thing pinned here is the `rejected` list. When a user sees
 * SCHEMA_ONLY against their own database the immediate question is *why can't
 * you do the good one*, and answering it precisely is the difference between a
 * documented limitation and a product that looks broken.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_RESTORE_BYTES,
  SHADOW_STRATEGIES,
  STRATEGY_CAPABILITY,
  UNPROVEN_ROLLBACK_COPY,
  describeStrategy,
  openGate,
  overclaimsRollback,
  parseDossier,
  permittedCertificateKind,
  resolveShadowStrategy,
  strategyCanProveRollback,
} from '../dist/index.js';

const GB = 1024 * 1024 * 1024;
const APPROVER = { email: 'sam.okafor@airlock.dev', role: 'approver' };
const PRE = 'sha256:' + '11'.repeat(32);
const POST = 'sha256:' + '22'.repeat(32);

function inputs(overrides = {}) {
  return {
    provider: 'generic',
    database_bytes: 2 * GB,
    sandbox_available: true,
    replica: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Choosing                                                                    */
/* -------------------------------------------------------------------------- */

test('a provider with native branching gets the full-fidelity strategy', () => {
  const d = resolveShadowStrategy(inputs({ provider: 'supabase' }));
  assert.equal(d.strategy, 'NATIVE_BRANCH');
  assert.equal(d.can_prove_rollback, true);
  assert.equal(d.capability.covers, 'database');
});

test('T2: a generic Postgres inside the ceiling restores into the sandbox', () => {
  const d = resolveShadowStrategy(inputs({ provider: 'rds', database_bytes: 2 * GB }));
  assert.equal(d.strategy, 'SANDBOX_RESTORE');
  assert.equal(d.can_prove_rollback, true);
  assert.equal(d.capability.covers, 'tables-in-scope');
  assert.equal(permittedCertificateKind(d.strategy), 'UNDO');
});

test('the ceiling is measured against the tables in scope, not the whole database', () => {
  // A 4 TB database with a 200 MB table in scope is a perfectly good candidate.
  // Rejecting it on total size would answer a question nobody asked.
  const d = resolveShadowStrategy(
    inputs({ provider: 'rds', database_bytes: 4000 * GB, scope_bytes: 200 * 1024 * 1024 }),
  );
  assert.equal(d.strategy, 'SANDBOX_RESTORE');
});

test('T3: a database too large to clone degrades to SCHEMA_ONLY', () => {
  const d = resolveShadowStrategy(inputs({ provider: 'rds', database_bytes: DEFAULT_MAX_RESTORE_BYTES + GB }));
  assert.equal(d.strategy, 'SCHEMA_ONLY');
  assert.equal(d.can_prove_rollback, false);
  assert.equal(permittedCertificateKind(d.strategy), 'SCOPE');
  assert.match(d.rejected.find((r) => r.strategy === 'SANDBOX_RESTORE').because, /restore ceiling/);
});

test('no sandbox means no restore, and it says so rather than failing later', () => {
  // TrueForge's sandbox is Daytona-only and off until a key is configured, so
  // this is read per run. Assuming a sandbox exists would pick SANDBOX_RESTORE
  // and fail at execution time, which is the worst moment to find out.
  const d = resolveShadowStrategy(inputs({ sandbox_available: false }));
  assert.equal(d.strategy, 'SCHEMA_ONLY');
  assert.match(d.rejected.find((r) => r.strategy === 'SANDBOX_RESTORE').because, /No sandbox is configured/);
});

test('an unmeasured size does not start a restore', () => {
  // R2. Not knowing how big something is is not permission to guess.
  const d = resolveShadowStrategy(inputs({ database_bytes: null }));
  assert.equal(d.strategy, 'SCHEMA_ONLY');
  assert.match(d.rejected.find((r) => r.strategy === 'SANDBOX_RESTORE').because, /could not be measured/);
});

test('a writable point-in-time endpoint is preferred over a sandbox restore', () => {
  const d = resolveShadowStrategy(inputs({ replica: { present: true, writable: true } }));
  assert.equal(d.strategy, 'READ_REPLICA');
  assert.equal(d.can_prove_rollback, true);
});

test('a read-only replica is rejected, because it cannot host the forward migration', () => {
  const d = resolveShadowStrategy(inputs({ replica: { present: true, writable: false } }));
  assert.notEqual(d.strategy, 'READ_REPLICA');
  assert.match(d.rejected.find((r) => r.strategy === 'READ_REPLICA').because, /read-only|cannot host/i);
});

test('every rejection explains itself in a sentence a user could act on', () => {
  const d = resolveShadowStrategy(inputs({ provider: 'rds', sandbox_available: false, database_bytes: null }));
  assert.ok(d.rejected.length >= 3, 'expected the higher-fidelity options to be listed');
  for (const r of d.rejected) {
    assert.ok(r.because.length > 25, `${r.strategy} rejection is too thin to be useful: ${r.because}`);
  }
});

/* -------------------------------------------------------------------------- */
/* The refusal this module exists for                                          */
/* -------------------------------------------------------------------------- */

test('only a strategy that executed against real rows can prove a rollback', () => {
  for (const s of SHADOW_STRATEGIES) {
    const c = STRATEGY_CAPABILITY[s];
    assert.equal(strategyCanProveRollback(s), c.executes && c.real_rows, `${s} disagrees with its own capability`);
  }
  assert.equal(strategyCanProveRollback('SCHEMA_ONLY'), false);
});

test('an UNDO certificate under SCHEMA_ONLY is an overclaim', () => {
  assert.equal(overclaimsRollback('UNDO', 'SCHEMA_ONLY'), true);
  assert.equal(overclaimsRollback('UNDO', 'SANDBOX_RESTORE'), false);
  assert.equal(overclaimsRollback('SCOPE', 'SCHEMA_ONLY'), false);
});

test('a certificate with no strategy recorded is not accused of overclaiming', () => {
  // Silence is not evidence of a weak strategy any more than of a strong one,
  // and every dossier written before this feature has no strategy on it.
  assert.equal(overclaimsRollback('UNDO', undefined), false);
});

test('T3: the gate seals an UNDO certificate whose strategy could not have observed one', () => {
  const now = new Date(Date.now() - 60_000).toISOString();
  const d = parseDossier({
    dossier_id: 'dos_schema_only',
    change_class: 'SCHEMA_MIGRATION',
    request: 'drop a column on a database too large to clone',
    requested_by: 'priya.n@airlock.dev',
    created_at: now,
    target: { systems: ['postgres'] },
    forward: [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN plan_name;', reversible: true, proven: true }],
    rollback: [{ system: 'postgres', op: 'ALTER TABLE users ADD COLUMN plan_name text;', reversible: true, proven: true }],
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      // Three digests that agree with each other, which under SCHEMA_ONLY means
      // three readings of the same untouched schema.
      checksums: { pre: PRE, post: POST, post_rollback: PRE, match: true },
      verified_at: now,
      shadow_strategy: 'SCHEMA_ONLY',
    },
  });

  const decision = openGate(d, APPROVER);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'STRATEGY_CANNOT_PROVE');
});

test('the same certificate under a strategy that really ran opens the gate', () => {
  const now = new Date(Date.now() - 60_000).toISOString();
  const base = {
    dossier_id: 'dos_restored',
    change_class: 'SCHEMA_MIGRATION',
    request: 'drop a column, proven against a restored copy',
    requested_by: 'priya.n@airlock.dev',
    created_at: now,
    target: { systems: ['postgres'] },
    forward: [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN plan_name;', reversible: true, proven: true }],
    rollback: [{ system: 'postgres', op: 'ALTER TABLE users ADD COLUMN plan_name text;', reversible: true, proven: true }],
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      checksums: { pre: PRE, post: POST, post_rollback: PRE, match: true },
      verified_at: now,
      shadow_strategy: 'SANDBOX_RESTORE',
    },
  };
  assert.equal(openGate(parseDossier(base), APPROVER).state, 'OPEN');
});

/* -------------------------------------------------------------------------- */
/* Saying it out loud                                                          */
/* -------------------------------------------------------------------------- */

test('the weaker guarantee is stated plainly, not hedged', () => {
  assert.match(UNPROVEN_ROLLBACK_COPY, /not proven/i);
  assert.match(UNPROVEN_ROLLBACK_COPY, /schema verified only/i);
  assert.match(describeStrategy('SCHEMA_ONLY'), /No rows were copied/);
});

test('every strategy carries a guarantee a human can read', () => {
  for (const s of SHADOW_STRATEGIES) {
    assert.ok(STRATEGY_CAPABILITY[s].guarantee.length > 40, `${s} has no real guarantee text`);
  }
});

test('the sandbox guarantee is honest about what it does not cover', () => {
  // Full fidelity for the tables in scope is not full fidelity for the
  // database, and the copy has to say so or it is claiming the stronger thing.
  assert.match(STRATEGY_CAPABILITY.SANDBOX_RESTORE.guarantee, /Nothing is claimed about tables outside/);
});

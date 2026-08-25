/**
 * The safety net, tested.
 *
 * The Undo Certificate proves a rollback works before anything is applied.
 * These tests pin the other half: what AIRLOCK does when production comes back
 * wrong afterwards.
 *
 * The property that matters most is the refusal. It is easy to write a system
 * that automatically reverts on a bad health check; the hard part is one that
 * declines to, when it has no proof the inverse works. Running an unproven
 * rollback against a database already in an unexpected state is how a bad
 * afternoon becomes a bad quarter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPostApply, describePostApply, parseDossier } from '../dist/index.js';

const PRE = 'sha256:' + '11'.repeat(32);
const POST = 'sha256:' + '22'.repeat(32);
const WRONG = 'sha256:' + '99'.repeat(32);

function applied(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_recovery',
    change_class: 'SCHEMA_MIGRATION',
    request: 'add a tier column',
    requested_by: 'priya.n@airlock.dev',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['postgres'] },
    forward: [{ system: 'postgres', op: 'ALTER TABLE users ADD COLUMN tier text;', reversible: true, proven: true }],
    rollback: [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier;', reversible: true, proven: true }],
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      checksums: { pre: PRE, post: POST, post_rollback: PRE, match: true },
      verified_at: '2026-08-24T09:05:00Z',
    },
    approval: {
      approver: 'sam.okafor@airlock.dev',
      at: '2026-08-24T09:06:00Z',
      role_required: 'approver',
      decision: 'approved',
      reason: null,
    },
    audit: { applied_at: '2026-08-24T09:06:30Z', post_apply_checksum: null, applied_by: 'sam.okafor@airlock.dev' },
    ...overrides,
  });
}

test('production matching the certificate is healthy and nothing happens', () => {
  const outcome = assessPostApply(applied(), POST);
  assert.equal(outcome.state, 'HEALTHY');
  assert.match(outcome.message, /landed as proven/);
});

test('production not matching, with a proven rollback, reverts', () => {
  const outcome = assessPostApply(applied(), WRONG);
  assert.equal(outcome.state, 'REVERT');
  assert.equal(outcome.expected, POST);
  assert.equal(outcome.observed, WRONG);
  assert.match(outcome.message, /already proven/);
});

test('production not matching, WITHOUT a proven rollback, refuses to touch anything', () => {
  // The important one. A system that reverts here is more dangerous than one
  // that does nothing, because it runs an untested inverse against a database
  // that is already in a state nobody predicted.
  const unproven = applied({
    rollback: [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier;', reversible: true, proven: false }],
  });
  const outcome = assessPostApply(unproven, WRONG);
  assert.equal(outcome.state, 'ALARM');
  assert.equal(outcome.reason, 'ROLLBACK_NOT_PROVEN');
  assert.match(outcome.message, /will not run an unproven inverse/);
});

test('an empty rollback is not a proven rollback', () => {
  const outcome = assessPostApply(applied({ rollback: [] }), WRONG);
  assert.equal(outcome.state, 'ALARM');
  assert.equal(outcome.reason, 'ROLLBACK_NOT_PROVEN');
});

test('a scope certificate makes no prediction, so there is nothing to check against', () => {
  // An erasure says what it destroys, not what remains. There is no honest
  // "expected post-state" to compare, and inventing one would be worse than
  // admitting it.
  const erasure = applied({
    change_class: 'ERASURE',
    rollback: [],
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: {
        records: [{ system: 'postgres', id: 'u_1', action: 'delete', count: 1 }],
        exclusions: [{ system: 'postgres', table: 'invoices', reason: 'statutory retention', count: 1 }],
      },
      verified_at: '2026-08-24T09:05:00Z',
    },
  });
  const outcome = assessPostApply(erasure, WRONG);
  assert.equal(outcome.state, 'ALARM');
  assert.equal(outcome.reason, 'NO_EXPECTATION');
  assert.match(outcome.message, /A human has to look/);
});

test('a change that was never applied is never assessed', () => {
  const pending = applied({
    approval: { approver: null, at: null, role_required: 'approver', decision: null, reason: null },
    audit: { applied_at: null, post_apply_checksum: null, applied_by: null },
  });
  assert.equal(assessPostApply(pending, POST).state, 'NOT_CHECKED');
});

test('no observation means no conclusion — silence is not health', () => {
  const outcome = assessPostApply(applied(), null);
  assert.equal(outcome.state, 'NOT_CHECKED');
  assert.match(outcome.message, /has not been re-checksummed/);
});

test('the ledger line says what actually happened', () => {
  const reverted = applied({
    post_apply: {
      checked_at: '2026-08-24T09:06:33Z',
      observed_checksum: WRONG,
      expected_checksum: POST,
      healthy: false,
      rolled_back_at: '2026-08-24T09:06:36Z',
      rollback_reason: 'post-apply checksum did not match the certificate',
      duration_ms: 3100,
    },
  });
  assert.match(describePostApply(reverted), /Rolled back in 3\.1s using the proven inverse/);

  const healthy = applied({
    post_apply: {
      checked_at: '2026-08-24T09:06:33Z',
      observed_checksum: POST,
      expected_checksum: POST,
      healthy: true,
      rolled_back_at: null,
      rollback_reason: null,
      duration_ms: 240,
    },
  });
  assert.match(describePostApply(healthy), /matching the certificate/);

  assert.match(describePostApply(applied()), /No health check has run yet/);
});

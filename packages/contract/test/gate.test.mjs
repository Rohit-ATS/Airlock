/**
 * The gate invariant, tested at runtime.
 *
 *   certificate.status !== "PROVEN"  ->  the approval gate is never offered.
 *
 * The compile-time half of this proof lives in src/gate.typetest.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openGate, verdictOf, parseDossier } from '../dist/index.js';

const HASH_A = 'sha256:' + 'a'.repeat(64);
const HASH_B = 'sha256:' + 'b'.repeat(64);

const APPROVER = { email: 'rohit@airlock.dev', role: 'approver' };
const REQUESTER = { email: 'damir@airlock.dev', role: 'requester' };

/** A dossier that has earned the right to ask. Every test starts from this. */
function provenDossier(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_01',
    change_class: 'SCHEMA_MIGRATION',
    request: 'add a tier column to users, backfill from subscriptions, drop plan_name',
    requested_by: 'rohit@airlock.dev',
    started_by: 'ui',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['postgres'], branch_ref: 'br_shadow_1' },
    forward: [{ system: 'postgres', op: 'ALTER TABLE users ADD COLUMN tier text', reversible: true }],
    rollback: [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier', reversible: true, proven: true }],
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      checksums: { pre: HASH_A, post: HASH_B, post_rollback: HASH_A, match: true },
      lock_ms_estimate: 4210,
      table_rewrite: false,
      verified_at: '2026-08-24T09:04:11Z',
    },
    ...overrides,
  });
}

test('a proven undo certificate opens the gate for an approver', () => {
  const decision = openGate(provenDossier(), APPROVER);
  assert.equal(decision.state, 'OPEN');
  assert.equal(decision.grant.dossier_id, 'dos_01');
  assert.equal(decision.grant.irreversible, false);
  assert.equal(decision.grant.approver, 'rohit@airlock.dev');
});

test('a missing certificate seals the gate', () => {
  const d = provenDossier();
  delete d.certificate;
  const decision = openGate(d, APPROVER);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'NO_CERTIFICATE');
  assert.equal(decision.grant, undefined, 'a sealed decision must carry no grant');
});

test('a pending certificate seals the gate', () => {
  const d = provenDossier();
  d.certificate.status = 'PENDING';
  assert.equal(openGate(d, APPROVER).reason, 'CERTIFICATE_PENDING');
});

test('a failed certificate seals the gate', () => {
  const d = provenDossier();
  d.certificate.status = 'FAILED';
  d.certificate.failure_reason = 'rollback restored 1,199,998 of 1,200,000 rows';
  assert.equal(openGate(d, APPROVER).reason, 'CERTIFICATE_FAILED');
});

test('mismatched checksums seal the gate even when status says PROVEN', () => {
  const d = provenDossier();
  d.certificate.checksums.post_rollback = HASH_B; // data did not come back
  const decision = openGate(d, APPROVER);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'CHECKSUM_MISMATCH');
});

test('AIRLOCK does not trust the verifier own match flag', () => {
  // The engine claims a match while the hashes plainly differ. The gate
  // recomputes pre === post_rollback itself, so the lie does not get through.
  const d = provenDossier();
  d.certificate.checksums = { pre: HASH_A, post: HASH_B, post_rollback: HASH_B, match: true };
  assert.equal(openGate(d, APPROVER).reason, 'CHECKSUM_MISMATCH');

  // And the inverse: hashes agree but the engine flagged a failure. Still sealed.
  const d2 = provenDossier();
  d2.certificate.checksums = { pre: HASH_A, post: HASH_B, post_rollback: HASH_A, match: false };
  assert.equal(openGate(d2, APPROVER).reason, 'CHECKSUM_MISMATCH');
});

test('an undo certificate with an unexecuted rollback seals the gate', () => {
  const d = provenDossier();
  d.rollback = [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier', reversible: true, proven: false }];
  assert.equal(openGate(d, APPROVER).reason, 'ROLLBACK_NOT_PROVEN');

  const d2 = provenDossier();
  d2.rollback = [];
  assert.equal(openGate(d2, APPROVER).reason, 'ROLLBACK_NOT_PROVEN');
});

test('an undo certificate with no checksum triple seals the gate', () => {
  const d = provenDossier();
  delete d.certificate.checksums;
  assert.equal(openGate(d, APPROVER).reason, 'CHECKSUM_MISSING');
});

test('a scope certificate opens the gate and is marked irreversible', () => {
  const d = provenDossier({
    change_class: 'ERASURE',
    rollback: [],
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: {
        records: [{ system: 'stripe', id: 'cus_test_123', action: 'delete', count: 1 }],
        exclusions: [
          { system: 'postgres', table: 'invoices', reason: '7-year statutory retention', count: 12 },
        ],
      },
      verified_at: '2026-08-24T09:20:00Z',
    },
  });
  const decision = openGate(d, APPROVER);
  assert.equal(decision.state, 'OPEN');
  assert.equal(decision.grant.irreversible, true);
  assert.equal(decision.grant.kind, 'SCOPE');
});

test('a scope certificate with an unbounded blast radius seals the gate', () => {
  const d = provenDossier({
    change_class: 'ERASURE',
    rollback: [],
    certificate: { kind: 'SCOPE', status: 'PROVEN', scope: { records: [], exclusions: [] } },
  });
  assert.equal(openGate(d, APPROVER).reason, 'SCOPE_UNBOUNDED');
});

test('a scope certificate with no computed scope seals the gate', () => {
  const d = provenDossier({
    change_class: 'ERASURE',
    rollback: [],
    certificate: { kind: 'SCOPE', status: 'PROVEN' },
  });
  assert.equal(openGate(d, APPROVER).reason, 'SCOPE_NOT_COMPUTED');
});

test('separation of duties: a requester never receives a grant', () => {
  const decision = openGate(provenDossier(), REQUESTER);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'ROLE_NOT_APPROVER');
});

test('an already-applied change cannot be approved twice', () => {
  const d = provenDossier();
  d.audit.applied_at = '2026-08-24T09:30:00Z';
  assert.equal(openGate(d, APPROVER).reason, 'ALREADY_APPLIED');
});

test('an already-decided change cannot be re-decided', () => {
  const d = provenDossier();
  d.approval.decision = 'rejected';
  assert.equal(openGate(d, APPROVER).reason, 'ALREADY_DECIDED');
});

test('EXHAUSTIVE: no non-PROVEN certificate status can ever open the gate', () => {
  for (const status of ['PENDING', 'FAILED']) {
    for (const kind of ['UNDO', 'SCOPE']) {
      for (const viewer of [APPROVER, REQUESTER]) {
        const d = provenDossier();
        d.certificate.kind = kind;
        d.certificate.status = status;
        const decision = openGate(d, viewer);
        assert.equal(decision.state, 'SEALED', `${kind}/${status} must never open`);
        assert.equal(decision.grant, undefined);
      }
    }
  }
});

test('the verdict banner and the button can never disagree', () => {
  // Blocked certificate -> blocked banner, and no grant exists to render a button.
  const failed = provenDossier();
  failed.certificate.status = 'FAILED';
  const d1 = openGate(failed, APPROVER);
  assert.equal(verdictOf(failed, d1).tone, 'blocked');
  assert.equal(d1.state, 'SEALED');

  // A requester looking at a good certificate sees the true verdict, not a
  // false alarm — but still gets no grant.
  const ok = provenDossier();
  const d2 = openGate(ok, REQUESTER);
  assert.equal(verdictOf(ok, d2).tone, 'proven');
  assert.equal(d2.state, 'SEALED');

  const good = openGate(ok, APPROVER);
  assert.equal(verdictOf(ok, good).tone, 'proven');
  assert.equal(good.state, 'OPEN');
});

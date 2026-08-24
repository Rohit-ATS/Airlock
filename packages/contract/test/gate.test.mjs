/**
 * The gate invariant, tested at runtime.
 *
 *   certificate.status !== "PROVEN"  ->  the approval gate is never offered.
 *
 * The compile-time half of this proof lives in src/gate.typetest.ts.
 *
 * Every test pins `now`. The gate enforces certificate freshness, so a suite
 * that used the wall clock would pass in August and fail in September — and a
 * test that only passes on the day it was written is not a test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openGate, verdictOf, parseDossier } from '../dist/index.js';

const HASH_A = 'sha256:' + 'a'.repeat(64);
const HASH_B = 'sha256:' + 'b'.repeat(64);

/** Deliberately not the requester: self-approval is refused, and that is tested. */
const APPROVER = { email: 'rohit@airlock.dev', role: 'approver' };
const APPROVER_2 = { email: 'sam@airlock.dev', role: 'approver' };
const REQUESTER = { email: 'damir@airlock.dev', role: 'requester' };

/** Five minutes after the fixture was verified: fresh under every class rule. */
const NOW = new Date('2026-08-24T09:10:00Z');
const at = { now: NOW };

/** A dossier that has earned the right to ask. Every test starts from this. */
function provenDossier(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_01',
    change_class: 'SCHEMA_MIGRATION',
    request: 'add a tier column to users, backfill from subscriptions, drop plan_name',
    requested_by: 'damir@airlock.dev',
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

/** A proven erasure: SCOPE certificate, quorum of two, nothing over a ceiling. */
function erasureDossier(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_erasure',
    change_class: 'ERASURE',
    request: 'erase dana.reyes@example.com from every system',
    requested_by: 'damir@airlock.dev',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['postgres', 'stripe'] },
    forward: [{ system: 'postgres', op: 'DELETE FROM users WHERE id = 8812', reversible: false }],
    rollback: [],
    magnitude: { records: 41, people: 1, amount_minor: 0, undo_window_seconds: null },
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: {
        records: [{ system: 'stripe', id: 'cus_test_123', action: 'delete', count: 1 }],
        exclusions: [{ system: 'postgres', table: 'invoices', reason: '7-year statutory retention', count: 12 }],
      },
      verified_at: '2026-08-24T09:05:00Z',
    },
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* The core invariant                                                          */
/* -------------------------------------------------------------------------- */

test('a proven undo certificate opens the gate for an approver', () => {
  const decision = openGate(provenDossier(), APPROVER, at);
  assert.equal(decision.state, 'OPEN');
  assert.equal(decision.grant.dossier_id, 'dos_01');
  assert.equal(decision.grant.irreversible, false);
  assert.equal(decision.grant.approver, 'rohit@airlock.dev');
  assert.equal(decision.grant.final, true, 'a schema migration needs one signature');
});

test('a missing certificate seals the gate', () => {
  const d = provenDossier();
  delete d.certificate;
  const decision = openGate(d, APPROVER, at);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'NO_CERTIFICATE');
  assert.equal(decision.grant, undefined, 'a sealed decision must carry no grant');
});

test('a pending certificate seals the gate', () => {
  const d = provenDossier();
  d.certificate.status = 'PENDING';
  assert.equal(openGate(d, APPROVER, at).reason, 'CERTIFICATE_PENDING');
});

test('a failed certificate seals the gate', () => {
  const d = provenDossier();
  d.certificate.status = 'FAILED';
  d.certificate.failure_reason = 'rollback restored 1,199,998 of 1,200,000 rows';
  assert.equal(openGate(d, APPROVER, at).reason, 'CERTIFICATE_FAILED');
});

test('mismatched checksums seal the gate even when status says PROVEN', () => {
  const d = provenDossier();
  d.certificate.checksums.post_rollback = HASH_B; // data did not come back
  const decision = openGate(d, APPROVER, at);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'CHECKSUM_MISMATCH');
});

test('AIRLOCK does not trust the verifier own match flag', () => {
  // The engine claims a match while the hashes plainly differ. The gate
  // recomputes pre === post_rollback itself, so the lie does not get through.
  const d = provenDossier();
  d.certificate.checksums = { pre: HASH_A, post: HASH_B, post_rollback: HASH_B, match: true };
  assert.equal(openGate(d, APPROVER, at).reason, 'CHECKSUM_MISMATCH');

  // And the inverse: hashes agree but the engine flagged a failure. Still sealed.
  const d2 = provenDossier();
  d2.certificate.checksums = { pre: HASH_A, post: HASH_B, post_rollback: HASH_A, match: false };
  assert.equal(openGate(d2, APPROVER, at).reason, 'CHECKSUM_MISMATCH');
});

test('an undo certificate with an unexecuted rollback seals the gate', () => {
  const d = provenDossier();
  d.rollback = [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier', reversible: true, proven: false }];
  assert.equal(openGate(d, APPROVER, at).reason, 'ROLLBACK_NOT_PROVEN');

  const d2 = provenDossier();
  d2.rollback = [];
  assert.equal(openGate(d2, APPROVER, at).reason, 'ROLLBACK_NOT_PROVEN');
});

test('an undo certificate with no checksum triple seals the gate', () => {
  const d = provenDossier();
  delete d.certificate.checksums;
  assert.equal(openGate(d, APPROVER, at).reason, 'CHECKSUM_MISSING');
});

test('a scope certificate opens the gate and is marked irreversible', () => {
  const decision = openGate(erasureDossier(), APPROVER, at);
  assert.equal(decision.state, 'OPEN');
  assert.equal(decision.grant.irreversible, true);
  assert.equal(decision.grant.kind, 'SCOPE');
});

test('a scope certificate with an unbounded blast radius seals the gate', () => {
  const d = erasureDossier({
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: { records: [], exclusions: [] },
      verified_at: '2026-08-24T09:05:00Z',
    },
  });
  assert.equal(openGate(d, APPROVER, at).reason, 'SCOPE_UNBOUNDED');
});

test('a scope certificate with no computed scope seals the gate', () => {
  const d = erasureDossier({
    certificate: { kind: 'SCOPE', status: 'PROVEN', verified_at: '2026-08-24T09:05:00Z' },
  });
  assert.equal(openGate(d, APPROVER, at).reason, 'SCOPE_NOT_COMPUTED');
});

test('separation of duties: a requester never receives a grant', () => {
  const decision = openGate(provenDossier(), REQUESTER, at);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'ROLE_NOT_APPROVER');
});

test('an already-applied change cannot be approved twice', () => {
  const d = provenDossier();
  d.audit.applied_at = '2026-08-24T09:30:00Z';
  assert.equal(openGate(d, APPROVER, at).reason, 'ALREADY_APPLIED');
});

test('an already-decided change cannot be re-decided', () => {
  const d = provenDossier();
  d.approval.decision = 'rejected';
  assert.equal(openGate(d, APPROVER, at).reason, 'ALREADY_DECIDED');
});

test('EXHAUSTIVE: no non-PROVEN certificate status can ever open the gate', () => {
  for (const status of ['PENDING', 'FAILED']) {
    for (const kind of ['UNDO', 'SCOPE']) {
      for (const viewer of [APPROVER, APPROVER_2, REQUESTER]) {
        const d = provenDossier();
        d.certificate.kind = kind;
        d.certificate.status = status;
        const decision = openGate(d, viewer, at);
        assert.equal(decision.state, 'SEALED', `${kind}/${status} must never open`);
        assert.equal(decision.grant, undefined);
      }
    }
  }
});

test('EXHAUSTIVE: every change class refuses an absent certificate', () => {
  const classes = [
    'SCHEMA_MIGRATION',
    'DATA_OPERATION',
    'ERASURE',
    'ACCESS_GRANT',
    'MONEY_MOVEMENT',
    'COMMS_BLAST',
    'INFRA_MUTATION',
  ];
  for (const change_class of classes) {
    const d = provenDossier({ change_class });
    delete d.certificate;
    const decision = openGate(d, APPROVER, at);
    assert.equal(decision.state, 'SEALED', `${change_class} must seal without a certificate`);
    assert.equal(decision.reason, 'NO_CERTIFICATE');
  }
});

/* -------------------------------------------------------------------------- */
/* The verdict banner                                                          */
/* -------------------------------------------------------------------------- */

test('the verdict banner and the button can never disagree', () => {
  // Blocked certificate -> blocked banner, and no grant exists to render a button.
  const failed = provenDossier();
  failed.certificate.status = 'FAILED';
  const d1 = openGate(failed, APPROVER, at);
  assert.equal(verdictOf(failed, d1).tone, 'blocked');
  assert.equal(d1.state, 'SEALED');

  // A requester looking at a good certificate sees the true verdict, not a
  // false alarm — but still gets no grant.
  const ok = provenDossier();
  const d2 = openGate(ok, REQUESTER, at);
  assert.equal(verdictOf(ok, d2).tone, 'proven');
  assert.equal(d2.state, 'SEALED');

  const good = openGate(ok, APPROVER, at);
  assert.equal(verdictOf(ok, good).tone, 'proven');
  assert.equal(good.state, 'OPEN');
});

test('a policy refusal reads as a policy refusal, not as a broken proof', () => {
  const d = provenDossier({
    change_class: 'MONEY_MOVEMENT',
    magnitude: { records: 1, people: 1, amount_minor: 9_000_000, currency: 'GBP', undo_window_seconds: null },
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: {
        records: [{ system: 'stripe', id: 'py_1', action: 'transfer', count: 1 }],
        exclusions: [],
      },
      verified_at: '2026-08-24T09:08:00Z',
    },
    rollback: [],
  });
  const decision = openGate(d, APPROVER, at);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'POLICY_AMOUNT_CEILING');
  assert.equal(verdictOf(d, decision).label, 'REFUSED — OVER THE AMOUNT CEILING');
  // The certificate itself is fine; the message must say why it was refused.
  assert.match(decision.message, /treasury/i);
});

test('a broken proof is never announced as a missing one', () => {
  // A banner reading "no certificate" over a change that has one, and whose
  // digests merely disagree, is a small lie — and the banner exists to make a
  // reader trust what is on the screen.
  const d = provenDossier();
  d.certificate.checksums.post_rollback = HASH_B;
  const v = verdictOf(d, openGate(d, APPROVER, at));
  assert.equal(v.tone, 'blocked');
  assert.doesNotMatch(v.label, /NO CERTIFICATE/);
  assert.match(v.label, /DID NOT COME BACK/);
});

test('every seal reason has its own banner, and no two share one', () => {
  // Reached by walking the reasons the gate can actually produce, so a new seal
  // added without a label shows up here rather than as a blank banner.
  const labels = new Map();
  const cases = [
    ['NO_CERTIFICATE', (d) => delete d.certificate],
    ['CERTIFICATE_PENDING', (d) => (d.certificate.status = 'PENDING')],
    ['CERTIFICATE_FAILED', (d) => (d.certificate.status = 'FAILED')],
    ['CHECKSUM_MISSING', (d) => delete d.certificate.checksums],
    ['CHECKSUM_MISMATCH', (d) => (d.certificate.checksums.post_rollback = HASH_B)],
    ['ROLLBACK_NOT_PROVEN', (d) => (d.rollback = [])],
    ['PRODUCTION_DRIFTED', (d) => (d.drift.drifted = true)],
    ['ALREADY_APPLIED', (d) => (d.audit.applied_at = '2026-08-24T09:20:00Z')],
    ['ALREADY_DECIDED', (d) => (d.approval.decision = 'rejected')],
  ];

  for (const [expected, mutate] of cases) {
    const d = provenDossier();
    mutate(d);
    const decision = openGate(d, APPROVER, at);
    assert.equal(decision.reason, expected, `expected ${expected}`);
    const { label } = verdictOf(d, decision);
    assert.ok(label && label.length > 8, `${expected} has no usable banner`);
    assert.equal(labels.has(label), false, `${expected} shares a banner with ${labels.get(label)}`);
    labels.set(label, expected);
  }
});

test('an awaiting-quorum grant is honest about not having moved anything', () => {
  const decision = openGate(erasureDossier(), APPROVER, at);
  assert.equal(decision.state, 'OPEN');
  assert.equal(decision.grant.final, false);
  const v = verdictOf(erasureDossier(), decision);
  assert.match(v.label, /AWAITING QUORUM/);
});

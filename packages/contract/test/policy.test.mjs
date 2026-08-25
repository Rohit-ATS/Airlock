/**
 * AIRLOCK POLICY, tested.
 *
 * The certificate says whether a change is what it claims to be. Policy says
 * whether it is allowed, by whom, and right now. These tests pin the second
 * question, including the parts that are easy to get subtly wrong: a quorum
 * that counts clicks instead of people, a change freeze that is off by an
 * hour of British Summer Time, a drift check that believes a flag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY,
  evaluatePolicy,
  ruleFor,
  inWindow,
  activeBlackouts,
  openGate,
  openBreakGlass,
  isGrant,
  isBreakGlass,
  hasDrifted,
  sealsOutstanding,
  parseDossier,
  approversFor,
  MIN_JUSTIFICATION,
} from '../dist/index.js';

const HASH_A = 'sha256:' + 'a'.repeat(64);
const HASH_B = 'sha256:' + 'b'.repeat(64);
const HASH_C = 'sha256:' + 'c'.repeat(64);

const APPROVER = { email: 'rohit@airlock.dev', role: 'approver' };
const APPROVER_2 = { email: 'sam@airlock.dev', role: 'approver' };
const NOW = new Date('2026-08-24T09:10:00Z'); // Monday 10:10 London
const at = { now: NOW };

function base(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_policy',
    change_class: 'SCHEMA_MIGRATION',
    request: 'a change',
    requested_by: 'damir@airlock.dev',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['postgres'] },
    forward: [{ system: 'postgres', op: 'ALTER TABLE users ADD COLUMN tier text', reversible: true }],
    rollback: [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier', reversible: true, proven: true }],
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      checksums: { pre: HASH_A, post: HASH_B, post_rollback: HASH_A, match: true },
      verified_at: '2026-08-24T09:05:00Z',
    },
    ...overrides,
  });
}

function scopeCert(verified_at = '2026-08-24T09:05:00Z') {
  return {
    kind: 'SCOPE',
    status: 'PROVEN',
    scope: {
      records: [{ system: 'postgres', id: 'u_1', action: 'delete', count: 1 }],
      exclusions: [{ system: 'postgres', table: 'invoices', reason: 'statutory retention', count: 1 }],
    },
    verified_at,
  };
}

/* -------------------------------------------------------------------------- */
/* The right proof for the kind of change                                      */
/* -------------------------------------------------------------------------- */

test('a schema migration must carry an undo certificate, not a scope one', () => {
  const d = base({ certificate: scopeCert(), rollback: [] });
  const decision = openGate(d, APPROVER, at);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'POLICY_WRONG_CERTIFICATE');
  assert.equal(decision.finding.limit, 'UNDO certificate');
  assert.equal(decision.finding.observed, 'SCOPE certificate');
});

test('an erasure must carry a scope certificate, not an undo one', () => {
  const d = base({ change_class: 'ERASURE' });
  const decision = openGate(d, APPROVER, at);
  assert.equal(decision.reason, 'POLICY_WRONG_CERTIFICATE');
});

/* -------------------------------------------------------------------------- */
/* A proof is a perishable good                                                */
/* -------------------------------------------------------------------------- */

test('a certificate older than its class freshness window seals the gate', () => {
  const d = base(); // SCHEMA_MIGRATION: 1800s
  const fresh = openGate(d, APPROVER, { now: new Date('2026-08-24T09:34:00Z') });
  assert.equal(fresh.state, 'OPEN', '29 minutes is inside the window');

  const stale = openGate(d, APPROVER, { now: new Date('2026-08-24T09:36:00Z') });
  assert.equal(stale.state, 'SEALED');
  assert.equal(stale.reason, 'CERTIFICATE_STALE');
});

test('freshness windows differ by class, and the tighter one binds', () => {
  assert.equal(ruleFor(DEFAULT_POLICY, 'SCHEMA_MIGRATION').freshness_seconds, 1800);
  assert.equal(ruleFor(DEFAULT_POLICY, 'ACCESS_GRANT').freshness_seconds, 600);

  const grant = parseDossier({
    dossier_id: 'dos_access',
    change_class: 'ACCESS_GRANT',
    request: 'grant read access',
    requested_by: 'damir@airlock.dev',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['iam'] },
    principals: [{ subject: 'oncall@airlock.dev', grants: ['db:read'], scope: 'prod', expires_at: '2026-08-24T13:00:00Z' }],
    certificate: scopeCert(),
    rollback: [],
  });
  // 11 minutes: fine for a migration, expired for an access grant.
  const decision = openGate(grant, APPROVER, { now: new Date('2026-08-24T09:16:00Z') });
  assert.equal(decision.reason, 'CERTIFICATE_STALE');
});

/* -------------------------------------------------------------------------- */
/* Ceilings                                                                    */
/* -------------------------------------------------------------------------- */

test('the record ceiling counts records and the people ceiling counts people', () => {
  const bulk = base({
    change_class: 'DATA_OPERATION',
    magnitude: { records: 6_000_000, people: 0, amount_minor: 0, undo_window_seconds: null },
  });
  assert.equal(openGate(bulk, APPROVER, at).reason, 'POLICY_RECORD_CEILING');

  // The same row count, under the ceiling, passes — the ceiling is a number,
  // not a mood.
  const ok = base({
    change_class: 'DATA_OPERATION',
    magnitude: { records: 4_999_999, people: 0, amount_minor: 0, undo_window_seconds: null },
  });
  assert.equal(openGate(ok, APPROVER, at).state, 'OPEN');
});

test('a million audit rows is a Tuesday; a million people is an incident', () => {
  const d = base({
    change_class: 'COMMS_BLAST',
    certificate: scopeCert(),
    rollback: [],
    magnitude: { records: 60_000, people: 60_000, amount_minor: 0, undo_window_seconds: null },
  });
  const decision = openGate(d, APPROVER, { now: new Date('2026-08-24T09:10:00Z') });
  assert.equal(decision.reason, 'POLICY_PEOPLE_CEILING');
  assert.match(decision.message, /people/);
});

test('the money ceiling is absolute, so a large refund is caught as well as a large payout', () => {
  const out = base({
    change_class: 'MONEY_MOVEMENT',
    certificate: scopeCert(),
    rollback: [],
    magnitude: { records: 1, people: 1, amount_minor: 3_000_000, currency: 'GBP', undo_window_seconds: null },
  });
  assert.equal(openGate(out, APPROVER, at).reason, 'POLICY_AMOUNT_CEILING');

  const inbound = base({
    change_class: 'MONEY_MOVEMENT',
    certificate: scopeCert(),
    rollback: [],
    magnitude: { records: 1, people: 1, amount_minor: -3_000_000, currency: 'GBP', undo_window_seconds: null },
  });
  assert.equal(openGate(inbound, APPROVER, at).reason, 'POLICY_AMOUNT_CEILING');
});

test('a lock held longer than policy permits seals the gate', () => {
  // A lock is not a magnitude. It is a duration during which every other query
  // against the table queues behind yours, which is an outage caused by waiting
  // rather than by working.
  const slow = base({
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      checksums: { pre: HASH_A, post: HASH_B, post_rollback: HASH_A, match: true },
      lock_ms_estimate: 9_400,
      table_rewrite: true,
      verified_at: '2026-08-24T09:05:00Z',
    },
  });
  const decision = openGate(slow, APPROVER, at);
  assert.equal(decision.reason, 'POLICY_LOCK_CEILING');
  assert.equal(decision.finding.limit, '5.00 s');
  assert.equal(decision.finding.observed, '9.40 s');
  assert.match(decision.message, /queues behind it/);

  // The same operation under the ceiling is fine, so this is a number and not a
  // general suspicion of long migrations.
  const quick = base({
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      checksums: { pre: HASH_A, post: HASH_B, post_rollback: HASH_A, match: true },
      lock_ms_estimate: 4_210,
      verified_at: '2026-08-24T09:05:00Z',
    },
  });
  assert.equal(openGate(quick, APPROVER, at).state, 'OPEN');
});

test('a bulk data operation gets a tighter lock ceiling than a migration', () => {
  // It holds its lock for the whole write, not for a catalog update.
  assert.equal(ruleFor(DEFAULT_POLICY, 'SCHEMA_MIGRATION').max_lock_ms, 5_000);
  assert.equal(ruleFor(DEFAULT_POLICY, 'DATA_OPERATION').max_lock_ms, 2_000);
});

test('a certificate with no lock estimate is not judged on one', () => {
  // Absence of a measurement is not a measurement of zero, and it is certainly
  // not grounds to refuse.
  const noEstimate = base({
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      checksums: { pre: HASH_A, post: HASH_B, post_rollback: HASH_A, match: true },
      verified_at: '2026-08-24T09:05:00Z',
    },
  });
  assert.equal(openGate(noEstimate, APPROVER, at).state, 'OPEN');
});

/* -------------------------------------------------------------------------- */
/* No standing access                                                          */
/* -------------------------------------------------------------------------- */

test('an access grant with no expiry is refused however well proven it is', () => {
  const d = parseDossier({
    dossier_id: 'dos_forever',
    change_class: 'ACCESS_GRANT',
    request: 'give the on-call engineer production read access',
    requested_by: 'damir@airlock.dev',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['iam'] },
    principals: [
      { subject: 'oncall@airlock.dev', grants: ['db:read'], scope: 'prod', expires_at: null },
      { subject: 'bot@airlock.dev', grants: ['db:read'], scope: 'prod', expires_at: '2026-08-25T00:00:00Z' },
    ],
    certificate: scopeCert('2026-08-24T09:08:00Z'),
    rollback: [],
  });
  const decision = openGate(d, APPROVER, at);
  assert.equal(decision.reason, 'GRANT_WITHOUT_EXPIRY');
  assert.match(decision.finding.observed, /oncall@airlock\.dev/);
  assert.doesNotMatch(decision.finding.observed, /bot@airlock\.dev/, 'only the offending principal is named');
});

test('the same grant with an expiry passes policy', () => {
  const d = parseDossier({
    dossier_id: 'dos_bounded',
    change_class: 'ACCESS_GRANT',
    request: 'give the on-call engineer production read access for four hours',
    requested_by: 'damir@airlock.dev',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['iam'] },
    principals: [{ subject: 'oncall@airlock.dev', grants: ['db:read'], scope: 'prod', expires_at: '2026-08-24T13:00:00Z' }],
    certificate: scopeCert('2026-08-24T09:08:00Z'),
    rollback: [],
  });
  const decision = openGate(d, APPROVER, at);
  assert.equal(decision.state, 'OPEN');
  assert.equal(decision.grant.final, false, 'access grants need two signatures');
});

/* -------------------------------------------------------------------------- */
/* Change freezes                                                              */
/* -------------------------------------------------------------------------- */

test('a wrapping window is in effect on both sides of midnight', () => {
  const quiet = {
    days: [0, 1, 2, 3, 4, 5, 6],
    from: '21:00',
    to: '08:00',
    tz: 'Europe/London',
    reason: 'quiet hours',
  };
  assert.equal(inWindow(quiet, new Date('2026-08-26T22:00:00Z')), true, '23:00 London');
  assert.equal(inWindow(quiet, new Date('2026-08-26T05:00:00Z')), true, '06:00 London');
  assert.equal(inWindow(quiet, new Date('2026-08-26T12:00:00Z')), false, '13:00 London');
});

test('the Friday infrastructure freeze is evaluated in London wall-clock time', () => {
  // 18:00 UTC on Friday 28 August is 19:00 in London — inside the freeze.
  assert.equal(activeBlackouts(DEFAULT_POLICY, 'INFRA_MUTATION', new Date('2026-08-28T18:00:00Z')).length, 1);
  // Wednesday lunchtime is not.
  assert.equal(activeBlackouts(DEFAULT_POLICY, 'INFRA_MUTATION', new Date('2026-08-26T12:00:00Z')).length, 0);
  // Saturday is frozen all day.
  assert.equal(activeBlackouts(DEFAULT_POLICY, 'INFRA_MUTATION', new Date('2026-08-29T12:00:00Z')).length, 1);
});

test('no change freeze may block an erasure or a right-to-be-forgotten request', () => {
  // A freeze that blocks a statutory obligation trades a legal problem for an
  // operational one. These classes are deliberately clear at all times.
  for (const cls of ['ERASURE', 'MONEY_MOVEMENT', 'ACCESS_GRANT', 'SCHEMA_MIGRATION', 'DATA_OPERATION']) {
    assert.equal(ruleFor(DEFAULT_POLICY, cls).blackout.length, 0, `${cls} must not be frozen`);
  }
});

test('a comms blast inside quiet hours is refused with the reason a human wrote', () => {
  const d = base({
    change_class: 'COMMS_BLAST',
    certificate: scopeCert('2026-08-26T22:55:00Z'),
    rollback: [],
    magnitude: { records: 900, people: 900, amount_minor: 0, undo_window_seconds: null },
  });
  const decision = openGate(d, APPROVER, { now: new Date('2026-08-26T23:00:00Z') });
  assert.equal(decision.reason, 'POLICY_BLACKOUT');
  assert.match(decision.message, /wake fifty thousand people up/);
});

/* -------------------------------------------------------------------------- */
/* Separation of duties and quorum                                             */
/* -------------------------------------------------------------------------- */

test('the requester cannot approve their own change', () => {
  const d = base();
  const self = { email: 'damir@airlock.dev', role: 'approver' };
  const decision = openGate(d, self, at);
  assert.equal(decision.state, 'SEALED');
  assert.equal(decision.reason, 'SELF_APPROVAL');
  assert.match(decision.message, /you cannot be the one who approves it/i);
});

test('a quorum counts distinct people, not clicks', () => {
  const d = base({
    change_class: 'ERASURE',
    certificate: scopeCert(),
    rollback: [],
    signatures: [
      { approver: 'rohit@airlock.dev', at: '2026-08-24T09:06:00Z', decision: 'approved' },
      { approver: 'ROHIT@airlock.dev', at: '2026-08-24T09:07:00Z', decision: 'approved' },
    ],
  });
  assert.equal(approversFor(d).length, 1, 'the same person twice is one approver');
  assert.equal(sealsOutstanding(d), 1);

  // And that person cannot sign again to make up the number.
  const again = openGate(d, APPROVER, at);
  assert.equal(again.reason, 'SELF_APPROVAL');
  assert.match(again.message, /already signed/i);

  // A second, different approver completes it.
  const second = openGate(d, APPROVER_2, at);
  assert.equal(second.state, 'OPEN');
  assert.equal(second.grant.seals_held, 1);
  assert.equal(second.grant.seals_required, 2);
  assert.equal(second.grant.final, true);
});

test('a first signature on a two-person change is explicitly not final', () => {
  const d = base({ change_class: 'ERASURE', certificate: scopeCert(), rollback: [] });
  const decision = openGate(d, APPROVER, at);
  assert.equal(decision.state, 'OPEN');
  assert.equal(decision.grant.final, false);
  assert.equal(decision.grant.seals_held, 0);
  assert.equal(isGrant(decision.grant), true);
});

test('a rejection by one approver does not count towards the quorum', () => {
  const d = base({
    change_class: 'ERASURE',
    certificate: scopeCert(),
    rollback: [],
    signatures: [{ approver: 'sam@airlock.dev', at: '2026-08-24T09:06:00Z', decision: 'rejected' }],
  });
  assert.equal(approversFor(d).length, 0);
  assert.equal(sealsOutstanding(d), 2);
});

/* -------------------------------------------------------------------------- */
/* Drift                                                                       */
/* -------------------------------------------------------------------------- */

test('production drift seals a gate that the certificate alone would open', () => {
  const d = base({ drift: { checked_at: '2026-08-24T09:09:00Z', production_checksum: HASH_C, drifted: false } });
  // The checker says "not drifted". The gate compares the digests anyway.
  assert.equal(hasDrifted(d), true);
  assert.equal(openGate(d, APPROVER, at).reason, 'PRODUCTION_DRIFTED');
});

test('drift is asymmetric: a claim of danger is believed, a claim of safety is recomputed', () => {
  // Claim of danger with no evidence: believed.
  const alarmed = base({ drift: { checked_at: '2026-08-24T09:09:00Z', production_checksum: null, drifted: true } });
  assert.equal(hasDrifted(alarmed), true);

  // Claim of safety with matching evidence: accepted.
  const calm = base({ drift: { checked_at: '2026-08-24T09:09:00Z', production_checksum: HASH_A, drifted: false } });
  assert.equal(hasDrifted(calm), false);
  assert.equal(openGate(calm, APPROVER, at).state, 'OPEN');

  // No check at all: nothing is claimed, so nothing is concluded.
  assert.equal(hasDrifted(base()), false);
});

/* -------------------------------------------------------------------------- */
/* Break glass                                                                 */
/* -------------------------------------------------------------------------- */

const JUSTIFICATION =
  'Sev-1: checkout is down, the rollback proof failed on an unrelated audit table, and we are applying the index by hand.';

test('break glass is off unless the deployment and the policy both say yes', () => {
  const d = base();
  d.certificate.status = 'FAILED';

  assert.equal(openBreakGlass(d, APPROVER, JUSTIFICATION, at).reason, 'DISABLED');
  assert.equal(openBreakGlass(d, APPROVER, JUSTIFICATION, { ...at, enabled: true }).state, 'AVAILABLE');

  // ERASURE forbids it in policy, so enabling the deployment changes nothing.
  const erasure = base({ change_class: 'ERASURE', certificate: { ...scopeCert(), status: 'FAILED' }, rollback: [] });
  assert.equal(openBreakGlass(erasure, APPROVER, JUSTIFICATION, { ...at, enabled: true }).reason, 'FORBIDDEN_FOR_CLASS');
});

test('break glass demands a written reason', () => {
  const d = base();
  d.certificate.status = 'FAILED';
  const short = openBreakGlass(d, APPROVER, 'prod is down', { ...at, enabled: true });
  assert.equal(short.state, 'UNAVAILABLE');
  assert.equal(short.reason, 'NO_JUSTIFICATION');
  assert.ok(JUSTIFICATION.length >= MIN_JUSTIFICATION);
});

test('break glass refuses to exist when the gate is simply open', () => {
  const decision = openBreakGlass(base(), APPROVER, JUSTIFICATION, { ...at, enabled: true });
  assert.equal(decision.reason, 'NOT_SEALED');
});

test('a break-glass override is not an approval grant and can never be mistaken for one', () => {
  const d = base();
  d.certificate.status = 'FAILED';
  const decision = openBreakGlass(d, APPROVER, JUSTIFICATION, { ...at, enabled: true });
  assert.equal(decision.state, 'AVAILABLE');

  // The two witnesses are different symbols. Neither value satisfies the other
  // guard, so the Approve control cannot be handed an override at runtime any
  // more than it can at compile time.
  assert.equal(isBreakGlass(decision.override), true);
  assert.equal(isGrant(decision.override), false);

  const gate = openGate(base(), APPROVER, at);
  assert.equal(isGrant(gate.grant), true);
  assert.equal(isBreakGlass(gate.grant), false);
});

test('break glass records which seal it bypassed', () => {
  const d = base();
  d.certificate.checksums.post_rollback = HASH_B;
  const decision = openBreakGlass(d, APPROVER, JUSTIFICATION, { ...at, enabled: true });
  assert.equal(decision.override.bypassed, 'CHECKSUM_MISMATCH');
  assert.equal(decision.override.operator, 'rohit@airlock.dev');
  assert.equal(decision.override.justification, JUSTIFICATION);
});

/* -------------------------------------------------------------------------- */
/* The policy document itself                                                  */
/* -------------------------------------------------------------------------- */

test('every class resolves to a complete rule', () => {
  const classes = [
    'SCHEMA_MIGRATION',
    'DATA_OPERATION',
    'ERASURE',
    'ACCESS_GRANT',
    'MONEY_MOVEMENT',
    'COMMS_BLAST',
    'INFRA_MUTATION',
  ];
  for (const cls of classes) {
    const rule = ruleFor(DEFAULT_POLICY, cls);
    assert.ok(rule.quorum >= 1, `${cls} quorum`);
    assert.ok(rule.freshness_seconds > 0, `${cls} freshness`);
    assert.equal(typeof rule.break_glass, 'boolean', `${cls} break_glass`);
    assert.equal(rule.allow_self_approval, false, `${cls} must not permit self-approval by default`);
    assert.ok(Array.isArray(rule.blackout), `${cls} blackout`);
  }
});

test('every irreversible class requires two people', () => {
  for (const cls of ['ERASURE', 'ACCESS_GRANT', 'MONEY_MOVEMENT', 'COMMS_BLAST', 'INFRA_MUTATION']) {
    assert.equal(ruleFor(DEFAULT_POLICY, cls).quorum, 2, `${cls} must need a second pair of eyes`);
  }
});

test('evaluatePolicy without a viewer reports change-level findings only', () => {
  const d = base();
  const self = evaluatePolicy(d, { viewerEmail: 'damir@airlock.dev', now: NOW });
  assert.equal(self.findings.some((f) => f.code === 'SELF_APPROVAL'), true);

  const anonymous = evaluatePolicy(d, { now: NOW });
  assert.equal(anonymous.findings.some((f) => f.code === 'SELF_APPROVAL'), false);
  assert.equal(anonymous.ok, true);
});

/**
 * The undo window, tested.
 *
 * The easy half of a time-boxed undo is the countdown. The half that decides
 * whether it is a responsible control or a liability is the set of cases where
 * it must refuse — and each of those is a case where a less careful system
 * would happily offer the button.
 *
 * The property these lean on hardest: **no arrangement of policy, window and
 * clock produces an available undo without a proven inverse.** A window is
 * permission to run a rollback that was already demonstrated. Without the
 * demonstration there is nothing for the permission to apply to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY,
  assessUndo,
  describeUndo,
  hasProvenInverse,
  parseDossier,
  requestUndo,
  undoExpiresAt,
  undoRestored,
  undoWindowSeconds,
  ruleFor,
} from '../dist/index.js';

const PRE = 'sha256:' + '11'.repeat(32);
const POST = 'sha256:' + '22'.repeat(32);
const WRONG = 'sha256:' + '99'.repeat(32);

const APPLIED_AT = '2026-08-24T09:10:00Z';
/** Ten minutes after it landed: inside a 30-minute window, outside a 5-minute one. */
const TEN_MIN_LATER = new Date('2026-08-24T09:20:00Z');
const HOUR_LATER = new Date('2026-08-24T10:10:00Z');

function applied(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_undo',
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
      at: APPLIED_AT,
      decision: 'approved',
      role_required: 'approver',
      reason: null,
    },
    audit: { applied_at: APPLIED_AT, applied_by: 'sam.okafor@airlock.dev', post_apply_checksum: null },
    ...overrides,
  });
}

const APPROVER = { email: 'sam.okafor@airlock.dev', role: 'approver' };
const REQUESTER = { email: 'priya.n@airlock.dev', role: 'requester' };

/* -------------------------------------------------------------------------- */
/* The window                                                                  */
/* -------------------------------------------------------------------------- */

test('an applied change with a proven inverse is undoable inside the window', () => {
  const result = assessUndo(applied(), { now: TEN_MIN_LATER });
  assert.equal(result.state, 'AVAILABLE');
  assert.ok(result.remainingMs > 0);
  assert.equal(result.windowMs, 1800 * 1000);
});

test('the window closes, and says when', () => {
  const result = assessUndo(applied(), { now: HOUR_LATER });
  assert.equal(result.state, 'CLOSED');
  assert.equal(result.remainingMs, 0);
  assert.match(result.message, /closed at/);
});

test('the boundary is closed, not open — a press at the exact expiry is late', () => {
  const d = applied();
  const expires = new Date(undoExpiresAt(d, ruleFor(DEFAULT_POLICY, 'SCHEMA_MIGRATION')));
  assert.equal(assessUndo(d, { now: expires }).state, 'CLOSED');
  assert.equal(assessUndo(d, { now: new Date(expires.getTime() - 1) }).state, 'AVAILABLE');
});

test('a change that was never applied has nothing to take back', () => {
  const d = applied({ audit: { applied_at: null, applied_by: null, post_apply_checksum: null } });
  assert.equal(assessUndo(d, { now: TEN_MIN_LATER }).state, 'NOT_APPLIED');
});

/* -------------------------------------------------------------------------- */
/* The refusals that matter                                                    */
/* -------------------------------------------------------------------------- */

test('no proven inverse, no undo — however open the window looks', () => {
  const d = applied({
    rollback: [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier;', reversible: true, proven: false }],
  });
  const result = assessUndo(d, { now: TEN_MIN_LATER });
  assert.equal(result.state, 'UNPROVEN');
  assert.equal(result.remainingMs, 0);
});

test('one unproven operation among several is enough to refuse', () => {
  const d = applied({
    rollback: [
      { system: 'postgres', op: 'a', reversible: true, proven: true },
      { system: 'postgres', op: 'b', reversible: true, proven: true },
      { system: 'postgres', op: 'c', reversible: true, proven: false },
    ],
  });
  assert.equal(hasProvenInverse(d), false);
  assert.equal(assessUndo(d, { now: TEN_MIN_LATER }).state, 'UNPROVEN');
});

test('an empty rollback is not a proven rollback', () => {
  const d = applied({ rollback: [] });
  assert.equal(assessUndo(d, { now: TEN_MIN_LATER }).state, 'UNPROVEN');
});

test('erasure is never undoable, because there is no inverse to keep warm', () => {
  const d = applied({
    change_class: 'ERASURE',
    rollback: [],
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: { records: [{ system: 'postgres', id: 'u_1', action: 'delete', count: 1 }], exclusions: [] },
      verified_at: '2026-08-24T09:05:00Z',
    },
  });
  const result = assessUndo(d, { now: TEN_MIN_LATER });
  assert.notEqual(result.state, 'AVAILABLE');
  assert.equal(undoWindowSeconds(d, ruleFor(DEFAULT_POLICY, 'ERASURE')), null);
});

test('the automatic rollback having already fired leaves nothing to undo', () => {
  const d = applied({
    post_apply: {
      checked_at: APPLIED_AT,
      observed_checksum: WRONG,
      expected_checksum: POST,
      healthy: false,
      rolled_back_at: APPLIED_AT,
      rollback_reason: 'did not match',
      duration_ms: 4200,
    },
  });
  assert.equal(assessUndo(d, { now: TEN_MIN_LATER }).state, 'SUPERSEDED');
});

test('an undo that already happened is reported, not offered again', () => {
  const d = applied({
    undo: {
      expires_at: null,
      undone_at: '2026-08-24T09:15:00Z',
      undone_by: 'sam.okafor@airlock.dev',
      reason: 'wrong table',
      restored_checksum: PRE,
      restored: true,
    },
  });
  assert.equal(assessUndo(d, { now: TEN_MIN_LATER }).state, 'ALREADY_UNDONE');
});

/**
 * The property that carries the feature. If this ever passes with a false
 * `proven`, the undo button has become a bet.
 */
test('PROPERTY: nothing produces an available undo without a fully proven inverse', () => {
  const classes = ['SCHEMA_MIGRATION', 'DATA_OPERATION', 'INFRA_MUTATION', 'ERASURE', 'MONEY_MOVEMENT'];
  const rollbacks = [
    [],
    [{ system: 'postgres', op: 'a', reversible: true, proven: false }],
    [
      { system: 'postgres', op: 'a', reversible: true, proven: true },
      { system: 'postgres', op: 'b', reversible: true, proven: false },
    ],
  ];
  const clocks = [new Date(APPLIED_AT), TEN_MIN_LATER, HOUR_LATER];

  for (const change_class of classes) {
    for (const rollback of rollbacks) {
      for (const now of clocks) {
        const d = applied({ change_class, rollback });
        const result = assessUndo(d, { now });
        assert.notEqual(
          result.state,
          'AVAILABLE',
          `${change_class} with ${rollback.length} rollback op(s) at ${now.toISOString()} must not be undoable`,
        );
      }
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Policy grants the window; a change may only shorten it                      */
/* -------------------------------------------------------------------------- */

test('a change may waive part of its window', () => {
  const d = applied({ magnitude: { records: 0, people: 0, amount_minor: 0, undo_window_seconds: 300 } });
  assert.equal(undoWindowSeconds(d, ruleFor(DEFAULT_POLICY, 'SCHEMA_MIGRATION')), 300);
});

test('a change cannot extend its window beyond what policy grants', () => {
  const d = applied({ magnitude: { records: 0, people: 0, amount_minor: 0, undo_window_seconds: 86_400 } });
  assert.equal(undoWindowSeconds(d, ruleFor(DEFAULT_POLICY, 'SCHEMA_MIGRATION')), 1800);
});

test('asking for zero seconds means no undo at all', () => {
  const d = applied({ magnitude: { records: 0, people: 0, amount_minor: 0, undo_window_seconds: 0 } });
  assert.equal(undoWindowSeconds(d, ruleFor(DEFAULT_POLICY, 'SCHEMA_MIGRATION')), null);
  assert.equal(assessUndo(d, { now: TEN_MIN_LATER }).state, 'NOT_OFFERED');
});

test('a policy granting no window for a class is honoured over the change asking', () => {
  const policy = {
    ...DEFAULT_POLICY,
    classes: {
      ...DEFAULT_POLICY.classes,
      SCHEMA_MIGRATION: { ...DEFAULT_POLICY.classes.SCHEMA_MIGRATION, undo_window_seconds: null },
    },
  };
  const d = applied({ magnitude: { records: 0, people: 0, amount_minor: 0, undo_window_seconds: 600 } });
  assert.equal(assessUndo(d, { policy, now: TEN_MIN_LATER }).state, 'NOT_OFFERED');
});

test('a recorded expiry is authoritative over a recomputed one', () => {
  // A policy edited after the fact must not move a deadline somebody relied on.
  const recorded = '2026-08-24T09:12:00Z';
  const d = applied({
    undo: {
      expires_at: recorded,
      undone_at: null,
      undone_by: null,
      reason: null,
      restored_checksum: null,
      restored: null,
    },
  });
  assert.equal(undoExpiresAt(d, ruleFor(DEFAULT_POLICY, 'SCHEMA_MIGRATION')), recorded);
  assert.equal(assessUndo(d, { now: TEN_MIN_LATER }).state, 'CLOSED');
});

/* -------------------------------------------------------------------------- */
/* Who may press it                                                            */
/* -------------------------------------------------------------------------- */

test('an approver may take a change back', () => {
  const decision = requestUndo(applied(), APPROVER, { now: TEN_MIN_LATER });
  assert.equal(decision.state, 'PERMITTED');
  assert.equal(decision.operations.length, 1);
});

test('a requester may not — undoing runs statements against production', () => {
  const decision = requestUndo(applied(), REQUESTER, { now: TEN_MIN_LATER });
  assert.equal(decision.state, 'REFUSED');
  assert.equal(decision.reason, 'ROLE_NOT_APPROVER');
});

/**
 * Deliberate asymmetry, and the same one the gate already holds: a single
 * rejection stops a change while a quorum is needed to move one. Undo is on the
 * stopping side, so the person who approved may reverse it alone. Requiring a
 * second signature to fix a mistake optimises for the wrong risk.
 */
test('the approver who applied a change may undo it — self-approval does not apply', () => {
  const d = applied();
  const decision = requestUndo(d, { email: d.approval.approver, role: 'approver' }, { now: TEN_MIN_LATER });
  assert.equal(decision.state, 'PERMITTED');
});

test('a late press is refused even when it was legitimate a moment ago', () => {
  const decision = requestUndo(applied(), APPROVER, { now: HOUR_LATER });
  assert.equal(decision.state, 'REFUSED');
  assert.equal(decision.reason, 'WINDOW_CLOSED');
});

test('an unproven change refuses for the right reason, not merely the first one', () => {
  const d = applied({ rollback: [] });
  const decision = requestUndo(d, APPROVER, { now: TEN_MIN_LATER });
  assert.equal(decision.state, 'REFUSED');
  assert.equal(decision.reason, 'NOT_UNDOABLE');
});

/* -------------------------------------------------------------------------- */
/* Did it actually work?                                                       */
/* -------------------------------------------------------------------------- */

test('restoration is measured against the checksum the change started from', () => {
  const d = applied();
  assert.equal(undoRestored(d, PRE), true);
  assert.equal(undoRestored(d, WRONG), false);
});

test('an unmeasured undo is unmeasured, never successful', () => {
  const d = applied();
  assert.equal(undoRestored(d, null), null);
  assert.equal(undoRestored(applied({ certificate: undefined }), PRE), null);
});

test('the ledger line distinguishes restored, not restored, and never checked', () => {
  const base = {
    expires_at: null,
    undone_at: '2026-08-24T09:15:00Z',
    undone_by: 'sam.okafor@airlock.dev',
    reason: null,
    restored_checksum: null,
    restored: null,
  };
  assert.match(describeUndo(applied({ undo: { ...base, restored: true } })), /returned to its starting state/);
  assert.match(describeUndo(applied({ undo: { ...base, restored: false } })), /did NOT return/);
  assert.match(describeUndo(applied({ undo: base })), /never checksummed/);
  assert.match(describeUndo(applied()), /Not taken back/);
});

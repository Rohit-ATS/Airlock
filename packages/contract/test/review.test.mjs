/**
 * The code review loop, tested.
 *
 * Three properties carry it:
 *
 *   - **A migration with unreviewed code does not open the gate.** Proving a
 *     schema change reversible while the application still dereferences the
 *     column it removes is proving the wrong thing.
 *   - **A fix that predates the finding is not a fix.** The reviewer's own
 *     "resolved" flag is never consulted; AIRLOCK compares timestamps, the same
 *     asymmetry it applies to `checksums.match` and `drifted: false`.
 *   - **Nits do not block.** Deliberately. A system that refuses to ship over a
 *     naming preference is a system whose reviews get skipped, and a skipped
 *     review is worth less than none because it looks like one happened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeReview,
  isAddressed,
  openGate,
  outstandingFindings,
  parseDossier,
  reviewBlocks,
  reviewStatus,
} from '../dist/index.js';

const PRE = 'sha256:' + '11'.repeat(32);
const POST = 'sha256:' + '22'.repeat(32);
const APPROVER = { email: 'sam.okafor@airlock.dev', role: 'approver' };

const RAISED = '2026-08-24T15:44:00Z';
const LATER = '2026-08-24T15:52:00Z';
const EARLIER = '2026-08-24T15:10:00Z';

function change(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_review',
    change_class: 'SCHEMA_MIGRATION',
    request: 'retire plan_name',
    requested_by: 'priya.n@airlock.dev',
    created_at: new Date(Date.now() - 60_000).toISOString(),
    target: { systems: ['postgres'] },
    forward: [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN plan_name;', reversible: true, proven: true }],
    rollback: [{ system: 'postgres', op: 'ALTER TABLE users ADD COLUMN plan_name text;', reversible: true, proven: true }],
    certificate: {
      kind: 'UNDO',
      status: 'PROVEN',
      checksums: { pre: PRE, post: POST, post_rollback: PRE, match: true },
      verified_at: new Date(Date.now() - 60_000).toISOString(),
    },
    ...overrides,
  });
}

const CODE = { repo: 'airlock/app', branch: 'airlock/retire', pr_number: 412, files_changed: 9 };

const blocker = (extra = {}) => ({
  id: 'Q-1',
  severity: 'blocker',
  title: 'serializeUser drops the field unconditionally',
  raised_at: RAISED,
  ...extra,
});

/* -------------------------------------------------------------------------- */
/* The gate                                                                    */
/* -------------------------------------------------------------------------- */

test('a change with no code needs no review', () => {
  const d = change();
  assert.equal(reviewStatus(d), 'NOT_REQUIRED');
  assert.equal(reviewBlocks(d), false);
  assert.equal(openGate(d, APPROVER).state, 'OPEN');
});

test('code with no review seals the gate', () => {
  const d = change({ code_changes: CODE });
  assert.equal(reviewStatus(d), 'NOT_REQUESTED');
  const gate = openGate(d, APPROVER);
  assert.equal(gate.state, 'SEALED');
  assert.equal(gate.reason, 'REVIEW_OUTSTANDING');
});

test('a review still running is not a review', () => {
  const d = change({ code_changes: CODE, code_review: { provider: 'qodo', status: 'PENDING', findings: [] } });
  assert.equal(reviewStatus(d), 'PENDING');
  assert.equal(openGate(d, APPROVER).reason, 'REVIEW_OUTSTANDING');
});

test('a clean review opens the gate', () => {
  const d = change({
    code_changes: CODE,
    code_review: { provider: 'qodo', status: 'CLEAN', reviewed_at: RAISED, findings: [] },
  });
  assert.equal(reviewStatus(d), 'CLEAN');
  assert.equal(openGate(d, APPROVER).state, 'OPEN');
});

test('an open blocking finding seals the gate', () => {
  const d = change({
    code_changes: CODE,
    code_review: { provider: 'qodo', status: 'OUTSTANDING', findings: [blocker()] },
  });
  assert.equal(reviewStatus(d), 'OUTSTANDING');
  assert.equal(openGate(d, APPROVER).reason, 'REVIEW_OUTSTANDING');
});

test('addressing every blocking finding opens the gate', () => {
  const d = change({
    code_changes: CODE,
    code_review: {
      provider: 'qodo',
      status: 'ADDRESSED',
      findings: [blocker({ addressed_by: 'c7f1a0e', addressed_at: LATER })],
    },
  });
  assert.equal(reviewStatus(d), 'ADDRESSED');
  assert.equal(openGate(d, APPROVER).state, 'OPEN');
});

/**
 * The reviewer's own status is a claim like any other. A record that says
 * ADDRESSED while carrying an open blocker is exactly the shape a buggy
 * integration produces, and the gate must not take its word for it.
 */
test('the review’s own status is recomputed, never believed', () => {
  const d = change({
    code_changes: CODE,
    // Claims clean; carries an unfixed blocker.
    code_review: { provider: 'qodo', status: 'CLEAN', findings: [blocker()] },
  });
  assert.equal(reviewStatus(d), 'OUTSTANDING');
  assert.equal(openGate(d, APPROVER).reason, 'REVIEW_OUTSTANDING');
});

/* -------------------------------------------------------------------------- */
/* What counts as fixed                                                        */
/* -------------------------------------------------------------------------- */

test('a commit that predates the finding fixes something else', () => {
  assert.equal(isAddressed(blocker({ addressed_by: 'aaa111', addressed_at: EARLIER })), false);
  assert.equal(isAddressed(blocker({ addressed_by: 'aaa111', addressed_at: LATER })), true);
});

test('a commit reference with no timestamp is not a fix', () => {
  assert.equal(isAddressed(blocker({ addressed_by: 'aaa111' })), false);
});

test('a waiver needs both a reason and a name', () => {
  assert.equal(isAddressed(blocker({ waived_reason: 'not applicable' })), false);
  assert.equal(isAddressed(blocker({ waived_reason: 'not applicable', waived_by: 'sam@x' })), true);
});

/* -------------------------------------------------------------------------- */
/* Severity                                                                    */
/* -------------------------------------------------------------------------- */

test('nits and minors never block', () => {
  const d = change({
    code_changes: CODE,
    code_review: {
      provider: 'qodo',
      status: 'OUTSTANDING',
      findings: [
        { id: 'Q-3', severity: 'nit', title: 'rename this', raised_at: RAISED },
        { id: 'Q-4', severity: 'minor', title: 'tidy that', raised_at: RAISED },
      ],
    },
  });
  assert.equal(outstandingFindings(d.code_review).length, 0);
  assert.equal(reviewStatus(d), 'CLEAN');
  assert.equal(openGate(d, APPROVER).state, 'OPEN');
});

test('major blocks as hard as blocker', () => {
  const d = change({
    code_changes: CODE,
    code_review: {
      provider: 'qodo',
      status: 'OUTSTANDING',
      findings: [{ id: 'Q-2', severity: 'major', title: 'renders an empty plan name', raised_at: RAISED }],
    },
  });
  assert.equal(reviewBlocks(d), true);
});

test('zero changed files means no code, whatever the record says', () => {
  const d = change({ code_changes: { ...CODE, files_changed: 0 } });
  assert.equal(reviewStatus(d), 'NOT_REQUIRED');
});

/* -------------------------------------------------------------------------- */
/* The line on the card                                                        */
/* -------------------------------------------------------------------------- */

test('the approval card line names the reviewer and the count', () => {
  const d = change({
    code_changes: CODE,
    code_review: {
      provider: 'qodo',
      status: 'ADDRESSED',
      findings: [
        blocker({ addressed_by: 'c7f1a0e', addressed_at: LATER }),
        { id: 'Q-2', severity: 'major', title: 'x', raised_at: RAISED, addressed_by: 'c7f1a0e', addressed_at: LATER },
        { id: 'Q-3', severity: 'nit', title: 'y', raised_at: RAISED },
      ],
    },
  });
  const line = describeReview(d);
  assert.match(line, /Code changes prepared/);
  assert.match(line, /reviewed by Qodo/);
  assert.match(line, /2 findings addressed/, 'the nit must not be counted as a finding that was addressed');
});

test('an outstanding review says how many are still open', () => {
  const d = change({
    code_changes: CODE,
    code_review: { provider: 'qodo', status: 'OUTSTANDING', findings: [blocker()] },
  });
  assert.match(describeReview(d), /1 of 1 findings outstanding/);
});

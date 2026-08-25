/**
 * Provenance, tested.
 *
 * The whole point of grading a figure is that the grades differ. A provenance
 * system where everything comes back MEASURED is a system that has learned to
 * say yes, and it would pass a test suite that only checked the happy path — so
 * these check the unflattering answers hardest.
 *
 * Two properties are load-bearing:
 *
 *   - **An unsourced claim says so.** No figure is quietly upgraded by the
 *     presence of unrelated harness events.
 *   - **A declared figure never gets a step link.** Linking an asserted record
 *     count to a sandbox event would imply something measured it. Nothing did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_KEYS, evidenceSummary, parseDossier, shortDigest, traceAll, traceClaim } from '../dist/index.js';

const PRE = 'sha256:' + '11'.repeat(32);
const POST = 'sha256:' + '22'.repeat(32);

const SANDBOX_EVENT = {
  capability: 5,
  at: '2026-08-24T09:05:00Z',
  step_id: 'evt_sandbox_01',
  evidence: 'sandbox.created',
  thread_id: null,
};

function dossier(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_prov',
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
      lock_ms_estimate: 4200,
      verified_at: '2026-08-24T09:05:00Z',
    },
    magnitude: { records: 128_400, people: 0, amount_minor: 0, undo_window_seconds: null },
    harness_events: [SANDBOX_EVENT],
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* Grades                                                                      */
/* -------------------------------------------------------------------------- */

test('a checksum is measured, and anchored to the sandbox event that produced it', () => {
  const t = traceClaim(dossier(), 'checksum_pre');
  assert.equal(t.grade, 'MEASURED');
  assert.equal(t.stepId, 'evt_sandbox_01');
  assert.equal(t.evidence, 'sandbox.created');
  assert.equal(t.capability, 5);
});

test('the lock estimate is measured — this is the figure a judge will click', () => {
  const t = traceClaim(dossier(), 'lock_ms');
  assert.equal(t.grade, 'MEASURED');
  assert.equal(t.value, '4.20s');
  assert.equal(t.stepId, 'evt_sandbox_01');
});

/**
 * The uncomfortable one, and the reason the whole module exists. A record count
 * sitting next to a checksum looks exactly as authoritative and very often is
 * not.
 */
test('a record count with no scope certificate is DECLARED, not measured', () => {
  const t = traceClaim(dossier(), 'records');
  assert.equal(t.grade, 'DECLARED');
  assert.match(t.explains, /Asserted by the agent/);
});

test('a declared figure gets no step link, however many harness events exist', () => {
  const t = traceClaim(dossier(), 'records');
  assert.equal(t.stepId, null);
  assert.equal(t.evidence, null);
  assert.equal(t.capability, null);
});

test('a scope certificate upgrades a count from declared to computed', () => {
  const d = dossier({
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: {
        records: [{ system: 'postgres', table: 'users', id: 'u_1', action: 'delete', count: 3 }],
        exclusions: [{ system: 'postgres', reason: 'statutory retention', count: 1 }],
      },
      verified_at: '2026-08-24T09:05:00Z',
    },
  });
  assert.equal(traceClaim(d, 'records').grade, 'COMPUTED');
  assert.equal(traceClaim(d, 'scope').grade, 'MEASURED');
});

test('drift is computed by AIRLOCK, and says that the checker is not believed', () => {
  const d = dossier({ drift: { checked_at: '2026-08-24T09:06:00Z', production_checksum: PRE, drifted: false } });
  const t = traceClaim(d, 'drift');
  assert.equal(t.grade, 'COMPUTED');
  assert.match(t.explains, /never trusted/);
});

/* -------------------------------------------------------------------------- */
/* Saying nothing, honestly                                                    */
/* -------------------------------------------------------------------------- */

test('a claim with nothing behind it is UNSOURCED and carries no value', () => {
  const bare = parseDossier({
    dossier_id: 'dos_bare',
    change_class: 'SCHEMA_MIGRATION',
    request: 'something',
    requested_by: 'a@b.c',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['postgres'] },
  });

  for (const claim of CLAIM_KEYS) {
    const t = traceClaim(bare, claim);
    assert.equal(t.grade, 'UNSOURCED', `${claim} must be unsourced on an empty dossier`);
    assert.equal(t.value, '', `${claim} must carry no value when nothing backs it`);
    assert.equal(t.stepId, null);
  }
});

test('an unsourced claim is never upgraded by unrelated harness events', () => {
  const d = dossier({
    certificate: undefined,
    harness_events: [SANDBOX_EVENT, { ...SANDBOX_EVENT, capability: 13, evidence: 'tool.approval_required' }],
  });
  assert.equal(traceClaim(d, 'checksum_pre').grade, 'UNSOURCED');
  assert.equal(traceClaim(d, 'lock_ms').stepId, null);
});

test('a measured claim with no matching harness event keeps its grade and loses its anchor', () => {
  // The sandbox genuinely produced the checksum; this run simply has no event
  // list attached. The figure is still measured — it just cannot be linked.
  const d = dossier({ harness_events: [] });
  const t = traceClaim(d, 'checksum_pre');
  assert.equal(t.grade, 'MEASURED');
  assert.equal(t.stepId, null);
});

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

test('every claim key traces without throwing, and returns its own key', () => {
  const traces = traceAll(dossier());
  assert.equal(traces.length, CLAIM_KEYS.length);
  for (const t of traces) {
    assert.ok(CLAIM_KEYS.includes(t.claim));
    assert.ok(t.label.length > 0);
    assert.ok(t.explains.length > 0);
  }
});

test('the summary counts only claims that have a value', () => {
  const s = evidenceSummary(dossier());
  assert.ok(s.measured >= 4);
  assert.equal(s.declared, 1);
  assert.equal(s.present, s.measured + s.computed + s.declared);
});

test('digests are shortened for display without losing their form', () => {
  assert.equal(shortDigest(PRE), 'sha256:1111…1111');
  assert.equal(shortDigest('sha256:abcd'), 'sha256:abcd');
});

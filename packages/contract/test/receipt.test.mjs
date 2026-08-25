/**
 * The tamper-evident ledger, tested.
 *
 * The property under test is not "the hash is correct" — any hash function is
 * correct. It is: *if a historical record is edited, does someone find out?*
 * So most of these tests edit a record and assert on where the chain reports
 * the break.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  sha256,
  sealReceipt,
  verifyChain,
  detach,
  verifyDetached,
  receiptBody,
  GENESIS_HASH,
  parseDossier,
} from '../dist/index.js';

const HASH_A = 'sha256:' + 'a'.repeat(64);
const HASH_B = 'sha256:' + 'b'.repeat(64);

function decided(id, request, approver = 'rohit@airlock.dev') {
  return parseDossier({
    dossier_id: id,
    change_class: 'SCHEMA_MIGRATION',
    request,
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
    signatures: [{ approver, at: '2026-08-24T09:06:00Z', decision: 'approved' }],
    approval: { approver, at: '2026-08-24T09:06:00Z', role_required: 'approver', decision: 'approved', reason: null },
    audit: { applied_at: '2026-08-24T09:06:30Z', applied_by: approver, post_apply_checksum: null },
  });
}

/** Seal a list of dossiers into a chain, in order. */
async function chain(dossiers) {
  const out = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < dossiers.length; i += 1) {
    const receipt = await sealReceipt(dossiers[i], i, prev, '2026-08-24T09:06:30Z');
    out.push({ ...dossiers[i], receipt });
    prev = receipt.hash;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Canonicalisation                                                            */
/* -------------------------------------------------------------------------- */

test('canonical JSON is stable under key reordering', () => {
  const a = canonicalJson({ b: 1, a: 2, c: [3, { z: 1, y: 2 }] });
  const b = canonicalJson({ c: [3, { y: 2, z: 1 }], a: 2, b: 1 });
  assert.equal(a, b);
});

test('canonical JSON distinguishes values that merely look alike', () => {
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: '1' }));
  assert.notEqual(canonicalJson({ a: null }), canonicalJson({}));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('undefined properties are dropped rather than hashed as absent-but-present', () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
});

test('sha256 renders in the same evidence form the rest of AIRLOCK uses', async () => {
  const digest = await sha256('airlock');
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(digest, await sha256('airlock'), 'the same input must hash identically');
  assert.notEqual(digest, await sha256('airlocks'));
});

/* -------------------------------------------------------------------------- */
/* The chain                                                                   */
/* -------------------------------------------------------------------------- */

test('an empty ledger verifies, and its head is genesis', async () => {
  const verdict = await verifyChain([]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.length, 0);
  assert.equal(verdict.head, GENESIS_HASH);
});

test('a well-formed chain verifies end to end', async () => {
  const sealed = await chain([decided('d1', 'first'), decided('d2', 'second'), decided('d3', 'third')]);
  const verdict = await verifyChain(sealed);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.brokenAt, -1);
  assert.equal(verdict.length, 3);
  assert.ok(verdict.links.every((l) => l.ok));
  assert.equal(verdict.head, sealed[2].receipt.hash);
});

test('editing the content of a record is detected at that record', async () => {
  const sealed = await chain([decided('d1', 'first'), decided('d2', 'second'), decided('d3', 'third')]);
  sealed[1] = { ...sealed[1], request: 'second, but quietly rewritten later' };

  const verdict = await verifyChain(sealed);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, 1);
  assert.equal(verdict.links[1].fault, 'content-modified');
  assert.equal(verdict.links[0].ok, true, 'everything before the edit still verifies');
});

test('changing who approved a change breaks the chain', async () => {
  const sealed = await chain([decided('d1', 'first'), decided('d2', 'second')]);
  sealed[0] = {
    ...sealed[0],
    approval: { ...sealed[0].approval, approver: 'someone-else@airlock.dev' },
  };
  const verdict = await verifyChain(sealed);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, 0);
});

test('changing a checksum a change was approved on breaks the chain', async () => {
  const sealed = await chain([decided('d1', 'first')]);
  sealed[0] = {
    ...sealed[0],
    certificate: { ...sealed[0].certificate, checksums: { ...sealed[0].certificate.checksums, pre: HASH_B } },
  };
  const verdict = await verifyChain(sealed);
  assert.equal(verdict.links[0].fault, 'content-modified');
});

test('deleting a record from the middle breaks every link after it', async () => {
  const sealed = await chain([decided('d1', 'first'), decided('d2', 'second'), decided('d3', 'third')]);
  const withHole = [sealed[0], sealed[2]];
  const verdict = await verifyChain(withHole);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, 1);
  assert.equal(verdict.links[1].fault, 'wrong-sequence');
});

test('reordering two records is detected', async () => {
  const sealed = await chain([decided('d1', 'first'), decided('d2', 'second')]);
  const verdict = await verifyChain([sealed[1], sealed[0]]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, 0);
});

test('a record with no receipt is reported rather than silently skipped', async () => {
  const sealed = await chain([decided('d1', 'first')]);
  const verdict = await verifyChain([...sealed, decided('d2', 'never sealed')]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.links[1].fault, 'missing-receipt');
});

test('a receipt re-pointed at a different predecessor is detected', async () => {
  const sealed = await chain([decided('d1', 'first'), decided('d2', 'second')]);
  sealed[1] = { ...sealed[1], receipt: { ...sealed[1].receipt, prev_hash: GENESIS_HASH } };
  const verdict = await verifyChain(sealed);
  assert.equal(verdict.links[1].fault, 'broken-link');
});

test('the running cost and harness events are deliberately outside the seal', async () => {
  // These keep changing after a decision is recorded. A chain that broke
  // because a token counter ticked would be a chain nobody trusts.
  const sealed = await chain([decided('d1', 'first')]);
  const noisier = {
    ...sealed[0],
    cost: { usd: 9.99, by_model: { 'anthropic/claude-sonnet-4-6': 9.99 }, tokens: { input: 1, output: 1, total: 2 } },
    harness_events: [{ capability: 5, at: '2026-08-24T09:07:00Z', step_id: 'evt_1', evidence: 'sandbox.created', thread_id: null }],
  };
  const verdict = await verifyChain([noisier]);
  assert.equal(verdict.ok, true, 'noise outside the committed body must not break the seal');
  assert.equal(Object.keys(receiptBody(sealed[0])).includes('cost'), false);
});

/* -------------------------------------------------------------------------- */
/* Detached receipts                                                           */
/* -------------------------------------------------------------------------- */

test('a detached receipt verifies on its own, with no ledger present', async () => {
  const sealed = await chain([decided('d1', 'first'), decided('d2', 'second')]);
  const receipt = detach(sealed[1], '2026-08-24T10:00:00Z');
  assert.ok(receipt);

  const verdict = await verifyDetached(receipt);
  assert.equal(verdict.ok, true);
  assert.match(verdict.message, /has not been altered/);
});

test('a detached receipt whose body was edited fails on its own', async () => {
  const sealed = await chain([decided('d1', 'first')]);
  const receipt = detach(sealed[0], '2026-08-24T10:00:00Z');
  receipt.body.request = 'something the auditor was never shown';

  const verdict = await verifyDetached(receipt);
  assert.equal(verdict.ok, false);
  assert.notEqual(verdict.recomputed, verdict.claimed);
  assert.match(verdict.message, /has been altered/);
});

test('an undecided change has nothing to detach', () => {
  const undecided = parseDossier({
    dossier_id: 'd_open',
    change_class: 'SCHEMA_MIGRATION',
    request: 'still in flight',
    requested_by: 'damir@airlock.dev',
    created_at: '2026-08-24T09:00:00Z',
    target: {},
  });
  assert.equal(detach(undecided), null);
});

/* -------------------------------------------------------------------------- */
/* Skill pinning                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The compliance claim, asserted rather than described.
 *
 * "Approved under postgres-safety@1.1.0" is only worth something if editing the
 * pack afterwards is detectable. That requires the digest to be *inside* the
 * seal, so a receipt taken in August can be checked against the pack as it
 * stands in November.
 */
test('the skill packs a change was approved under are inside the seal', async () => {
  const { receiptBody, hashLink, parseDossier, stampSkill } = await import('../dist/index.js');

  const base = parseDossier({
    dossier_id: 'dos_skills',
    change_class: 'SCHEMA_MIGRATION',
    request: 'add a column',
    requested_by: 'a@b.c',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['postgres'] },
    skills_used: [stampSkill('postgres-safety')],
  });

  assert.ok(receiptBody(base).skills_used, 'skills_used must be committed to');

  // Same change, same version claim, one character different in the guidance.
  const edited = parseDossier({
    ...base,
    skills_used: [{ name: 'postgres-safety', version: '1.1.0', digest: 'sha256:' + 'ab'.repeat(32) }],
  });

  const before = await hashLink(base, 0, GENESIS_HASH);
  const after = await hashLink(edited, 0, GENESIS_HASH);
  assert.notEqual(before, after, 'an edited pack at the same version must change the receipt');
});

test('what the reviewer found is sealed with the decision it informed', async () => {
  const { receiptBody, parseDossier } = await import('../dist/index.js');
  const d = parseDossier({
    dossier_id: 'dos_sealed_review',
    change_class: 'SCHEMA_MIGRATION',
    request: 'x',
    requested_by: 'a@b.c',
    created_at: '2026-08-24T09:00:00Z',
    target: { systems: ['postgres'] },
  });
  const body = receiptBody(d);
  for (const key of ['code_changes', 'code_review', 'untrusted', 'skills_used']) {
    assert.ok(key in body, `${key} is evidence the decision was taken on, and must be sealed`);
  }
  // And the things that legitimately keep moving afterwards are still outside.
  for (const key of ['post_apply', 'undo', 'harness_events', 'cost']) {
    assert.equal(key in body, false, `${key} is a later fact and must stay outside the seal`);
  }
});

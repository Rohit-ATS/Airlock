import test from 'node:test';
import assert from 'node:assert/strict';
import { Magnitude } from '../dist/index.js';

/**
 * Magnitude, and the currency field that taught an agent to lie.
 *
 * These cases come from a real run. Asked to open a schema migration, the agent
 * filled in a magnitude with no money in it, sent `currency: ""`, and was told:
 *
 *   Too small: expected string to have >=3 characters
 *
 * It read that as "this field needs a value" — which is what it says — and
 * answered `"USD"`. The dossier that reached the ledger therefore carried a
 * currency for a change that moves no money at all.
 *
 * Nothing downstream was wrong: the certificate was genuine and the gate was
 * evaluated correctly. But an audit record with an invented field in it is a
 * worse failure for this product than a missing optional one, because the whole
 * claim is that every value in a dossier came from somewhere. So the two honest
 * ways of saying "there is no currency" are accepted, and a wrong code is still
 * refused.
 */

const base = { records: 0, people: 0, amount_minor: 0 };

test('a change with no money may say so, in any of the three ways', () => {
  for (const [label, input] of [
    ['omitted', base],
    ['empty string', { ...base, currency: '' }],
    ['null', { ...base, currency: null }],
  ]) {
    const parsed = Magnitude.safeParse(input);
    assert.ok(parsed.success, `${label} should be accepted`);
    assert.equal(parsed.data.currency, undefined, `${label} should normalise to absent`);
  }
});

test('a real currency still has to be a real currency', () => {
  assert.equal(Magnitude.safeParse({ ...base, currency: 'USD' }).data.currency, 'USD');
  // Widening the absent cases must not widen the present ones.
  assert.equal(Magnitude.safeParse({ ...base, currency: 'US' }).success, false);
  assert.equal(Magnitude.safeParse({ ...base, currency: 'DOLLAR' }).success, false);
});

test('the countable fields default rather than forcing a guess', () => {
  const parsed = Magnitude.safeParse({});
  assert.ok(parsed.success);
  assert.equal(parsed.data.records, 0);
  assert.equal(parsed.data.people, 0);
  assert.equal(parsed.data.amount_minor, 0);
  // Never undoable is a fact worth stating, so it is null rather than missing.
  assert.equal(parsed.data.undo_window_seconds, null);
});

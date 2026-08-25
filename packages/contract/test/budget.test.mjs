/**
 * The budget cap, tested.
 *
 * Two properties carry this. The first is that the *binding* ceiling is the one
 * furthest consumed, not the one declared first — without it a run could sail
 * past its token ceiling while the console reassured everybody about dollars.
 * The second is that observing and enforcing are distinguishable: a budget set
 * to watch still reports the overspend truthfully, and still refuses to stop
 * anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, assessBudget, describeStop, formatTokens, formatUsd } from '../dist/index.js';

const ENFORCED = { usd: 5, tokens: 2_000_000, warn_at: 0.75, enforce: true };
const OBSERVING = { ...ENFORCED, enforce: false };
const UNCAPPED = { usd: null, tokens: null, warn_at: 0.75, enforce: true };

test('a run comfortably inside its ceiling is within', () => {
  const v = assessBudget({ usd: 0.4, tokens: 90_000 }, ENFORCED);
  assert.equal(v.state, 'WITHIN');
  assert.equal(v.shouldStop, false);
});

test('past the warning threshold it warns, and keeps running', () => {
  const v = assessBudget({ usd: 4, tokens: 10_000 }, ENFORCED);
  assert.equal(v.state, 'WARNING');
  assert.equal(v.shouldStop, false);
  assert.match(v.message, /80% of the spend ceiling/);
});

test('reaching the ceiling stops the run', () => {
  const v = assessBudget({ usd: 5, tokens: 10_000 }, ENFORCED);
  assert.equal(v.state, 'EXCEEDED');
  assert.equal(v.shouldStop, true);
  assert.equal(v.binding, 'usd');
});

test('no ceiling is reported as uncapped rather than as safe', () => {
  const v = assessBudget({ usd: 900, tokens: 90_000_000 }, UNCAPPED);
  assert.equal(v.state, 'UNCAPPED');
  assert.equal(v.shouldStop, false);
});

/**
 * The one that matters. A run three-quarters through its dollars but over its
 * token ceiling is over budget, and must say so on the ceiling it actually
 * breached.
 */
test('the binding ceiling is the one furthest consumed, not the first declared', () => {
  const v = assessBudget({ usd: 2.5, tokens: 2_100_000 }, ENFORCED);
  assert.equal(v.state, 'EXCEEDED');
  assert.equal(v.binding, 'tokens');
  assert.equal(v.shouldStop, true);
  assert.match(v.message, /tokens ceiling/);
});

test('a token-only ceiling binds when no dollar ceiling is set', () => {
  const v = assessBudget({ usd: 99, tokens: 500 }, { usd: null, tokens: 1_000, warn_at: 0.75, enforce: true });
  assert.equal(v.state, 'WITHIN');
  assert.equal(v.binding, 'tokens');
});

test('observing reports the overspend and refuses to act on it', () => {
  const v = assessBudget({ usd: 12, tokens: 10 }, OBSERVING);
  assert.equal(v.state, 'EXCEEDED');
  assert.equal(v.shouldStop, false);
  assert.match(v.message, /observe, not enforce/);
});

test('the shipped policy carries an enforcing budget', () => {
  assert.equal(DEFAULT_POLICY.budget.enforce, true);
  assert.ok(DEFAULT_POLICY.budget.usd > 0);
});

test('a stop names its cause, because cancelled alone is ambiguous', () => {
  assert.match(describeStop('human'), /operator/);
  assert.match(describeStop('budget', assessBudget({ usd: 6, tokens: 0 }, ENFORCED)), /budget cap/);
});

/* Small numbers matter when the ceiling is five dollars. */
test('money is formatted so a fraction of a cent is still legible', () => {
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(0.0071), '$0.0071');
  assert.equal(formatUsd(4.318), '$4.32');
});

test('tokens are formatted at a glance', () => {
  assert.equal(formatTokens(430), '430');
  assert.equal(formatTokens(812_000), '812k');
  assert.equal(formatTokens(1_400_000), '1.4M');
});

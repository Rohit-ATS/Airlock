import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDdl, expandContractPlan } from '../dist/index.js';

test('dropping a column is classified as destructive', () => {
  const [finding] = classifyDdl(['ALTER TABLE users DROP COLUMN plan_name;']);
  assert.equal(finding.kind, 'DROP_COLUMN');
  assert.equal(finding.severity, 'destructive');
  assert.equal(finding.table, 'users');
  assert.equal(finding.column, 'plan_name');
  assert.match(finding.reason, /breaks any reader/);
});

test('renaming a column is classified as destructive', () => {
  const [finding] = classifyDdl(['ALTER TABLE "users" RENAME COLUMN "plan_name" TO "tier";']);
  assert.equal(finding.kind, 'RENAME_COLUMN');
  assert.equal(finding.severity, 'destructive');
  assert.equal(finding.table, 'users');
  assert.equal(finding.column, 'plan_name');
  assert.equal(finding.object, 'tier');
});

test('adding a required column without a default is cautionary, not destructive', () => {
  const [finding] = classifyDdl(['ALTER TABLE users ADD COLUMN country TEXT NOT NULL;']);
  assert.equal(finding.kind, 'ADD_NOT_NULL_COLUMN');
  assert.equal(finding.severity, 'caution');
});

test('adding a required column with a default is not flagged by the classifier', () => {
  assert.deepEqual(classifyDdl(["ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT 'US';"]), []);
});

test('expand/contract plan is generated for destructive column drops', () => {
  const [finding] = classifyDdl(['ALTER TABLE users DROP COLUMN plan_name;']);
  const plan = expandContractPlan(finding);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((step) => step.phase), ['expand', 'migrate', 'contract']);
  assert.match(plan[0].statement, /ADD COLUMN plan_name_v2/);
  assert.match(plan[2].statement, /DROP COLUMN plan_name/);
});

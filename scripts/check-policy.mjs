/**
 * Check `airlock.policy.yaml` against the shipped default.
 *
 * The YAML file is authored, not generated — the whole point is that a team can
 * edit it. But it ships as an exact copy of `DEFAULT_POLICY`, and those two
 * drifting apart would be quietly awful: the console would enforce the file, the
 * landing page and the tests would describe the default, and both would look
 * right.
 *
 * So this asserts three things:
 *
 *   1. the file is valid YAML and a valid policy document (unknown keys are a
 *      hard error, because a typo'd key removes a rule rather than tightening
 *      one);
 *   2. every rule it resolves to is identical to the shipped default;
 *   3. the rules that must never exist still do not — no change freeze on
 *      erasure, money or access.
 *
 * If you deliberately change the policy, change both, and this will tell you
 * which one you forgot.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_POLICY, parsePolicy, resolvedRules, CHANGE_CLASSES } from '../packages/contract/dist/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, 'airlock.policy.yaml');

if (!existsSync(file)) {
  console.error('airlock.policy.yaml is missing. The console would silently fall back to the shipped default.');
  process.exit(1);
}

let document;
try {
  document = parseYaml(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`airlock.policy.yaml is not valid YAML:\n  ${error.message}`);
  process.exit(1);
}

const result = parsePolicy(document);
if (!result.ok) {
  console.error('airlock.policy.yaml is not a valid policy document:\n');
  for (const problem of result.problems) console.error(`  ✗ ${problem}`);
  console.error('\nUnknown keys are rejected on purpose: a typo removes a rule rather than tightening one.');
  process.exit(1);
}

const fromFile = resolvedRules(result.policy);
const shipped = resolvedRules(DEFAULT_POLICY);
const problems = [];

if (result.policy.name !== DEFAULT_POLICY.name) {
  problems.push(`name: file says "${result.policy.name}", shipped default says "${DEFAULT_POLICY.name}"`);
}

for (let i = 0; i < shipped.length; i += 1) {
  const cls = shipped[i].cls;
  const a = fromFile[i].rule;
  const b = shipped[i].rule;
  for (const key of Object.keys(b)) {
    const left = JSON.stringify(a[key]);
    const right = JSON.stringify(b[key]);
    if (left !== right) problems.push(`${cls}.${key}: file has ${left}, shipped default has ${right}`);
  }
}

/* --- the rules that must never exist -------------------------------------- */

const MUST_NOT_FREEZE = ['ERASURE', 'MONEY_MOVEMENT', 'ACCESS_GRANT', 'SCHEMA_MIGRATION', 'DATA_OPERATION'];
for (const { cls, rule } of fromFile) {
  if (MUST_NOT_FREEZE.includes(cls) && rule.blackout.length > 0) {
    problems.push(`${cls} has a change freeze. A freeze on this class trades a legal problem for an operational one.`);
  }
  if (rule.allow_self_approval) {
    problems.push(`${cls} permits self-approval. Separation of duties is not configurable to off.`);
  }
}

for (const cls of CHANGE_CLASSES) {
  if (!fromFile.some((r) => r.cls === cls)) problems.push(`${cls} resolves to no rule at all`);
}

if (problems.length > 0) {
  console.error(`airlock.policy.yaml and the shipped default disagree in ${problems.length} place(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('\nChange both, or neither.');
  process.exit(1);
}

console.log(`airlock.policy.yaml checks out — ${fromFile.length} classes, identical to the shipped default.`);
for (const { cls, rule } of fromFile) {
  const caps = [
    rule.max_records !== null && `${rule.max_records.toLocaleString()} records`,
    rule.max_people !== null && `${rule.max_people.toLocaleString()} people`,
    rule.max_amount_minor !== null && `£${(rule.max_amount_minor / 100).toLocaleString()}`,
    rule.max_lock_ms !== null && `${(rule.max_lock_ms / 1000).toFixed(1)}s lock`,
    rule.require_expiry && 'expiry required',
  ].filter(Boolean);
  console.log(`  ${cls.padEnd(18)} ${rule.requires.padEnd(6)} ${rule.quorum} approver(s)  ${caps.join(', ')}`);
}

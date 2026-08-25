/**
 * Assert the benchmark tasks still match the database they run against.
 *
 * This exists because the first version of the benchmark did not have it, and
 * the result was a set of numbers that looked reasonable and meant nothing.
 * Two tasks referenced things that were not true of the schema — an index that
 * already existed, a column that never had — so their SQL failed to execute.
 * The scorer saw "did not verify", the model had said "not reversible", and it
 * scored the pair as a *correct refusal*.
 *
 * A model was being rewarded for writing SQL so broken it could not run.
 *
 * That is the specific way a benchmark rots: not by breaking loudly, but by
 * quietly measuring something else. So the tasks declare what they depend on,
 * and this asserts it against the real seeded database before anybody quotes a
 * number from a run.
 *
 * Run: npm run check:benchmark   (needs `npm run seed:sqlite -- --reset` first)
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_REQUIREMENTS, TASKS, UNPROVABLE } from '../benchmark/tasks.mjs';

const dbPath = process.env.SQLITE_PATH ?? path.join('data', 'airlock.sqlite');

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}.`);
  console.error('Run:  npm run seed:sqlite -- --reset');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const problems = [];

const tableNames = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name),
);
const indexNames = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name),
);

for (const table of SCHEMA_REQUIREMENTS.tables) {
  if (!tableNames.has(table)) problems.push(`table "${table}" does not exist`);
}

for (const [table, columns] of Object.entries(SCHEMA_REQUIREMENTS.columns)) {
  if (!tableNames.has(table)) continue;
  const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const column of columns) {
    if (!actual.has(column)) problems.push(`column "${table}.${column}" does not exist`);
  }
}

for (const index of SCHEMA_REQUIREMENTS.indexes_present) {
  if (!indexNames.has(index)) problems.push(`index "${index}" was expected to exist and does not`);
}

// The other direction, and the one that actually bit: a task that creates an
// index which is already there fails on every model, for reasons that have
// nothing to do with the model.
for (const index of SCHEMA_REQUIREMENTS.indexes_absent) {
  if (indexNames.has(index)) {
    problems.push(`index "${index}" already exists, so the task that creates it can never succeed`);
  }
}

/* --- the task set itself ------------------------------------------------- */

const ids = new Set();
for (const task of TASKS) {
  if (ids.has(task.id)) problems.push(`duplicate task id "${task.id}"`);
  ids.add(task.id);
  if (!task.prompt || task.prompt.length < 20) problems.push(`task "${task.id}" has no real prompt`);
  if (!['REVERSIBLE', 'NOT_REVERSIBLE'].includes(task.expects)) {
    problems.push(`task "${task.id}" has an invalid expectation: ${task.expects}`);
  }
  if (!task.note) problems.push(`task "${task.id}" has no note saying why it is in the set`);
}

// A benchmark made only of provable tasks rewards confidence, and one made only
// of unprovable tasks rewards refusal. Neither measures judgement.
const provable = TASKS.length - UNPROVABLE.length;
if (UNPROVABLE.length === 0 || provable === 0) {
  problems.push('the task set must contain both provable and unprovable migrations, or it measures a reflex');
}

db.close();

console.log('');
if (problems.length > 0) {
  console.error(`${problems.length} problem(s) with the benchmark:\n`);
  for (const p of problems) console.error(`  X ${p}`);
  console.error('\nA task that has drifted from the schema does not fail loudly — it fails as');
  console.error('a model error and inflates whatever score is quoted next.');
  process.exit(1);
}

console.log(`benchmark checks out — ${TASKS.length} tasks against ${dbPath}`);
console.log(`  ${provable} provable, ${UNPROVABLE.length} deliberately unprovable`);
for (const task of TASKS) {
  console.log(`  ${task.id.padEnd(17)} ${task.expects}`);
}

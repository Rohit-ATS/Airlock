#!/usr/bin/env node
/**
 * Seed the local SQLite dataset for Damir's verifier lane.
 *
 * This is deliberately boring data with a useful shape: users carry the legacy
 * `plan_name`, subscriptions carry both the new `plan_tier` and the old value
 * needed to prove rollback after `plan_name` is dropped.
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.SQLITE_PATH ?? path.join('data', 'airlock.sqlite');
const rows = Number(process.env.AIRLOCK_SEED_ROWS ?? 50_000);
const reset = process.argv.includes('--reset') || process.env.AIRLOCK_RESET_SQLITE === '1';

if (!Number.isInteger(rows) || rows <= 0) {
  console.error('AIRLOCK_SEED_ROWS must be a positive integer.');
  process.exit(1);
}

mkdirSync(path.dirname(dbPath), { recursive: true });
if (reset) rmSync(dbPath, { force: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    plan_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    plan_tier TEXT NOT NULL,
    legacy_plan_name TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_plan_name ON users(plan_name);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_tier ON subscriptions(plan_tier);
`);

const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (existing >= rows) {
  console.log(`SQLite seed already has ${existing.toLocaleString()} users at ${dbPath}.`);
  db.close();
  process.exit(0);
}

const plans = [
  ['free', 'FREE'],
  ['pro', 'PRO'],
  ['team', 'TEAM'],
  ['enterprise', 'ENTERPRISE'],
];

const insertUser = db.prepare(`
  INSERT INTO users (id, email, plan_name, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);
const insertSubscription = db.prepare(`
  INSERT INTO subscriptions (user_id, plan_tier, legacy_plan_name, status, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

function seed(from, to) {
  db.exec('BEGIN');
  for (let id = from; id <= to; id += 1) {
    const [legacy, tier] = plans[id % plans.length];
    const day = String((id % 28) + 1).padStart(2, '0');
    const created = `2026-07-${day}T12:00:00.000Z`;
    const updated = `2026-08-${day}T12:00:00.000Z`;
    insertUser.run(id, `user${id}@airlock.dev`, legacy, created, updated);
    insertSubscription.run(id, tier, legacy, id % 17 === 0 ? 'past_due' : 'active', updated);
  }
  db.exec('COMMIT');
}

const batch = 10_000;
for (let from = existing + 1; from <= rows; from += batch) {
  const to = Math.min(rows, from + batch - 1);
  seed(from, to);
  if (to === rows || to % 100_000 === 0) {
    console.log(`seeded ${to.toLocaleString()} / ${rows.toLocaleString()} users`);
  }
}

db.close();
console.log(`SQLite seed ready at ${dbPath}.`);

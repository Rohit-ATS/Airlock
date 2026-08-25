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
    stripe_customer_id TEXT NOT NULL,
    slack_user_id TEXT NOT NULL,
    upload_prefix TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    actor_user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    retained_until TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_uploads (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    object_key TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_plan_name ON users(plan_name);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_tier ON subscriptions(plan_tier);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_id ON audit_log(actor_user_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_uploads_user_id ON user_uploads(user_id);
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
  INSERT INTO users (id, email, stripe_customer_id, slack_user_id, upload_prefix, plan_name, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSubscription = db.prepare(`
  INSERT INTO subscriptions (user_id, plan_tier, legacy_plan_name, status, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);
const insertSession = db.prepare(`
  INSERT INTO sessions (id, user_id, token_hash, created_at)
  VALUES (?, ?, ?, ?)
`);
const insertAudit = db.prepare(`
  INSERT INTO audit_log (id, actor_user_id, action, created_at)
  VALUES (?, ?, ?, ?)
`);
const insertInvoice = db.prepare(`
  INSERT INTO invoices (id, user_id, amount_minor, currency, retained_until)
  VALUES (?, ?, ?, ?, ?)
`);
const insertUpload = db.prepare(`
  INSERT INTO user_uploads (id, user_id, object_key)
  VALUES (?, ?, ?)
`);

function seed(from, to) {
  db.exec('BEGIN');
  for (let id = from; id <= to; id += 1) {
    const [legacy, tier] = plans[id % plans.length];
    const day = String((id % 28) + 1).padStart(2, '0');
    const created = `2026-07-${day}T12:00:00.000Z`;
    const updated = `2026-08-${day}T12:00:00.000Z`;
    const stripe = `cus_airlock_${String(id).padStart(8, '0')}`;
    const slack = `U${String(id).padStart(8, '0')}`;
    const prefix = `u/${id}/`;
    insertUser.run(id, `user${id}@airlock.dev`, stripe, slack, prefix, legacy, created, updated);
    insertSubscription.run(id, tier, legacy, id % 17 === 0 ? 'past_due' : 'active', updated);

    for (let n = 1; n <= (id % 5) + 1; n += 1) {
      insertSession.run(id * 10 + n, id, `sha256:${String(id * 10 + n).padStart(64, '0').slice(-64)}`, updated);
    }
    for (let n = 1; n <= (id % 7) + 2; n += 1) {
      insertAudit.run(id * 20 + n, id, n % 2 === 0 ? 'profile.update' : 'billing.view', updated);
    }
    for (let n = 1; n <= id % 3; n += 1) {
      insertInvoice.run(id * 30 + n, id, 1900 + n * 100, 'USD', '2033-08-24T00:00:00.000Z');
    }
    for (let n = 1; n <= id % 6; n += 1) {
      insertUpload.run(id * 40 + n, id, `${prefix}file-${n}.bin`);
    }
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

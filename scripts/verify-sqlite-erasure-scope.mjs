#!/usr/bin/env node
/**
 * First Scope Certificate slice: compute the blast radius for erasing one user
 * from the local SQLite seed dataset.
 *
 * This is intentionally read-only. A Scope Certificate proves what would be
 * destroyed and what is deliberately excluded; it does not pretend erasure is
 * reversible.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseDossier } from '../packages/contract/dist/index.js';
import { buildErasureScopePlan } from '../packages/verifier/dist/index.js';

const dbPath = process.env.SQLITE_PATH ?? path.join('data', 'airlock.sqlite');
const outDir = process.env.AIRLOCK_DATA_DIR ?? '.airlock';
const consoleUrl = process.env.AIRLOCK_CONSOLE_URL ?? '';
const dossierId = process.env.AIRLOCK_DOSSIER_ID ?? `dos_sqlite_erasure_${Date.now()}`;
const requestedBy = process.env.AIRLOCK_REQUESTED_BY ?? 'damir@airlock.dev';
const apiToken = process.env.AIRLOCK_API_TOKEN ?? '';
const userId = Number(process.env.AIRLOCK_ERASURE_USER_ID ?? process.argv.find((arg) => /^\d+$/.test(arg)) ?? 17);
const emitOnly = process.argv.includes('--emit-only') || !consoleUrl;

if (!Number.isInteger(userId) || userId <= 0) {
  console.error('AIRLOCK_ERASURE_USER_ID must be a positive integer.');
  process.exit(1);
}

function count(db, sql, params = []) {
  return Number(db.prepare(sql).get(...params).count);
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function writeNdjson(file, rows) {
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

async function postDossier(dossier) {
  const res = await fetch(new URL('/api/dossiers', consoleUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}) },
    body: JSON.stringify(dossier),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} from ${consoleUrl}/api/dossiers: ${text}`);
  return text ? JSON.parse(text) : {};
}

mkdirSync(outDir, { recursive: true });
const outputPath = path.join(outDir, `${dossierId}.dossier.json`);
const reportPath = path.join(outDir, `${dossierId}.scope.json`);
const detailPath = path.join(outDir, `${dossierId}.scope.ndjson`);

const db = new DatabaseSync(dbPath, { readOnly: true });
const verifiedAt = new Date().toISOString();
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

let dossier;
let detailRows = [];

if (!user) {
  dossier = parseDossier({
    dossier_id: dossierId,
    change_class: 'ERASURE',
    request: `Erase user ${userId} from every system AIRLOCK knows about.`,
    requested_by: requestedBy,
    started_by: 'api',
    created_at: verifiedAt,
    target: { project_ref: 'sqlite-local', branch_ref: null, systems: ['postgres'] },
    forward: [],
    rollback: [],
    magnitude: { records: 0, people: 0, amount_minor: 0, undo_window_seconds: null },
    certificate: {
      kind: 'SCOPE',
      status: 'FAILED',
      failure_reason: `No user ${userId} exists in the seed dataset, so the erasure scope cannot be computed.`,
      verified_at: verifiedAt,
    },
    affected_tables: [],
    recommendation: 'BLOCK',
  });
} else {
  const sessions = count(db, 'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', [userId]);
  const auditRows = count(db, 'SELECT COUNT(*) AS count FROM audit_log WHERE actor_user_id = ?', [userId]);
  const retainedInvoices = count(db, 'SELECT COUNT(*) AS count FROM invoices WHERE user_id = ?', [userId]);
  const uploads = count(db, 'SELECT COUNT(*) AS count FROM user_uploads WHERE user_id = ?', [userId]);
  detailRows = [
    {
      system: 'postgres',
      table: 'users',
      id: String(userId),
      action: 'anonymize',
      email: user.email,
    },
    ...all(db, 'SELECT id, token_hash FROM sessions WHERE user_id = ? ORDER BY id', [userId]).map((row) => ({
      system: 'postgres',
      table: 'sessions',
      id: String(row.id),
      action: 'delete',
      token_hash: row.token_hash,
    })),
    ...all(db, 'SELECT id, action, created_at FROM audit_log WHERE actor_user_id = ? ORDER BY id', [userId]).map((row) => ({
      system: 'postgres',
      table: 'audit_log',
      id: String(row.id),
      action: 'anonymize',
      event: row.action,
      created_at: row.created_at,
    })),
    ...all(db, 'SELECT id, amount_minor, currency, retained_until FROM invoices WHERE user_id = ? ORDER BY id', [
      userId,
    ]).map((row) => ({
      system: 'postgres',
      table: 'invoices',
      id: String(row.id),
      action: 'retain',
      reason: 'Seven-year statutory retention',
      amount_minor: row.amount_minor,
      currency: row.currency,
      retained_until: row.retained_until,
    })),
    {
      system: 'stripe',
      table: 'customer',
      id: String(user.stripe_customer_id),
      action: 'delete',
    },
    {
      system: 'slack',
      table: 'user',
      id: String(user.slack_user_id),
      action: 'anonymize',
    },
    ...all(db, 'SELECT id, object_key FROM user_uploads WHERE user_id = ? ORDER BY id', [userId]).map((row) => ({
      system: 'object_storage',
      table: 'airlock-uploads',
      id: String(row.id),
      action: 'delete',
      object_key: row.object_key,
    })),
  ];

  const scope = buildErasureScopePlan({
    user,
    counts: { sessions, auditRows, retainedInvoices, uploads },
  });

  dossier = parseDossier({
    dossier_id: dossierId,
    change_class: 'ERASURE',
    request: `Erase ${user.email} from every system AIRLOCK knows about.`,
    requested_by: requestedBy,
    started_by: 'api',
    created_at: verifiedAt,
    target: {
      project_ref: 'sqlite-local',
      branch_ref: null,
      systems: scope.target_systems,
    },
    forward: scope.forward,
    rollback: [],
    magnitude: { records: scope.record_count, people: 1, amount_minor: 0, undo_window_seconds: null },
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: { records: scope.records, exclusions: scope.exclusions },
      sandbox_artifact_url: `file://${path.resolve(reportPath)}`,
      verified_at: verifiedAt,
    },
    affected_tables: scope.affected_tables,
    blast_radius: [],
    risk_notes: [
      {
        note: 'SQLite scope computation is the local erasure slice. Hosted connectors can replace the mocked Stripe, Slack and object storage lookups without changing the dossier shape.',
      },
      {
        note: `Detailed row-level scope was offloaded to ${path.basename(detailPath)}; this dossier carries aggregate counts and exclusions.`,
      },
    ],
    recommendation: 'APPLY',
  });
}

db.close();
writeNdjson(detailPath, detailRows);

writeFileSync(
  reportPath,
  JSON.stringify(
    {
      dossier_id: dossier.dossier_id,
      database: path.resolve(dbPath),
      user_id: userId,
      artifacts: {
        detail_ndjson: path.resolve(detailPath),
        rows: detailRows.length,
      },
      certificate: dossier.certificate,
      affected_tables: dossier.affected_tables,
      verified_at: verifiedAt,
    },
    null,
    2,
  ),
  'utf8',
);
writeFileSync(outputPath, JSON.stringify(dossier, null, 2), 'utf8');

if (emitOnly) {
  console.log(JSON.stringify(dossier, null, 2));
  console.error(`\nWrote ${outputPath}. Set AIRLOCK_CONSOLE_URL=http://localhost:3000 to post it.`);
} else {
  const result = await postDossier(dossier);
  console.log(`Posted ${result.dossier?.dossier_id ?? dossier.dossier_id} to ${consoleUrl}/api/dossiers.`);
  console.log(`Local copy: ${outputPath}`);
}

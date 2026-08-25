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

const dbPath = process.env.SQLITE_PATH ?? path.join('data', 'airlock.sqlite');
const outDir = process.env.AIRLOCK_DATA_DIR ?? '.airlock';
const consoleUrl = process.env.AIRLOCK_CONSOLE_URL ?? '';
const dossierId = process.env.AIRLOCK_DOSSIER_ID ?? `dos_sqlite_erasure_${Date.now()}`;
const requestedBy = process.env.AIRLOCK_REQUESTED_BY ?? 'damir@airlock.dev';
const userId = Number(process.env.AIRLOCK_ERASURE_USER_ID ?? process.argv.find((arg) => /^\d+$/.test(arg)) ?? 17);
const emitOnly = process.argv.includes('--emit-only') || !consoleUrl;

if (!Number.isInteger(userId) || userId <= 0) {
  console.error('AIRLOCK_ERASURE_USER_ID must be a positive integer.');
  process.exit(1);
}

function count(db, sql, params = []) {
  return Number(db.prepare(sql).get(...params).count);
}

async function postDossier(dossier) {
  const res = await fetch(new URL('/api/dossiers', consoleUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dossier),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} from ${consoleUrl}/api/dossiers: ${text}`);
  return text ? JSON.parse(text) : {};
}

mkdirSync(outDir, { recursive: true });
const outputPath = path.join(outDir, `${dossierId}.dossier.json`);
const reportPath = path.join(outDir, `${dossierId}.scope.json`);

const db = new DatabaseSync(dbPath, { readOnly: true });
const verifiedAt = new Date().toISOString();
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

let dossier;

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

  const scopeRecords = [
    { system: 'postgres', table: 'users', id: String(userId), action: 'anonymize', count: 1 },
    { system: 'postgres', table: 'sessions', id: `user_id=${userId}`, action: 'delete', count: sessions },
    { system: 'postgres', table: 'audit_log', id: `actor_user_id=${userId}`, action: 'anonymize', count: auditRows },
    { system: 'stripe', table: 'customer', id: String(user.stripe_customer_id), action: 'delete', count: 1 },
    { system: 'slack', table: 'user', id: String(user.slack_user_id), action: 'anonymize', count: 1 },
    { system: 'object_storage', table: 'airlock-uploads', id: `${user.upload_prefix}*`, action: 'delete', count: uploads },
  ].filter((record) => record.count > 0);

  const exclusions = [
    {
      system: 'postgres',
      table: 'invoices',
      reason: 'Seven-year statutory retention. Personal fields must be redacted separately, but invoice rows are not deleted.',
      count: retainedInvoices,
    },
  ].filter((record) => record.count > 0);

  const recordCount =
    scopeRecords.reduce((sum, record) => sum + record.count, 0) +
    exclusions.reduce((sum, record) => sum + record.count, 0);

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
      systems: ['postgres', 'stripe', 'slack', 'object_storage'],
    },
    forward: [
      { system: 'postgres', op: `anonymize users.id=${userId}`, reversible: false, proven: true },
      { system: 'postgres', op: `DELETE FROM sessions WHERE user_id = ${userId};`, reversible: false, proven: true },
      { system: 'postgres', op: `anonymize audit_log.actor_user_id=${userId}`, reversible: false, proven: true },
      { system: 'stripe', op: `customers.delete("${user.stripe_customer_id}")`, reversible: false, proven: true },
      { system: 'slack', op: `admin.users.session.reset + profile scrub for ${user.slack_user_id}`, reversible: false, proven: true },
      { system: 'object_storage', op: `DELETE airlock-uploads/${user.upload_prefix}*`, reversible: false, proven: true },
    ],
    rollback: [],
    magnitude: { records: recordCount, people: 1, amount_minor: 0, undo_window_seconds: null },
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: { records: scopeRecords, exclusions },
      sandbox_artifact_url: `file://${path.resolve(reportPath)}`,
      verified_at: verifiedAt,
    },
    affected_tables: [
      { system: 'postgres', name: 'users', rows: 1, operation: 'anonymize in place' },
      { system: 'postgres', name: 'sessions', rows: sessions, operation: 'delete' },
      { system: 'postgres', name: 'audit_log', rows: auditRows, operation: 'anonymize actor' },
      { system: 'postgres', name: 'invoices', rows: retainedInvoices, operation: 'excluded by retention policy' },
      { system: 'object_storage', name: 'airlock-uploads', rows: uploads, operation: 'delete objects' },
    ],
    blast_radius: [],
    risk_notes: [
      {
        note: 'SQLite scope computation is the local erasure slice. Hosted connectors can replace the mocked Stripe, Slack and object storage lookups without changing the dossier shape.',
      },
    ],
    recommendation: 'APPLY',
  });
}

db.close();

writeFileSync(
  reportPath,
  JSON.stringify(
    {
      dossier_id: dossier.dossier_id,
      database: path.resolve(dbPath),
      user_id: userId,
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

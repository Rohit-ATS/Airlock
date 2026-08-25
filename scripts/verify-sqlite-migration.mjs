#!/usr/bin/env node
/**
 * First real verifier slice: SQLite shadow execution for the tier migration.
 *
 * The console fixtures prove the UI and gate. This script produces evidence
 * from a database: copy production to a shadow file, checksum, apply forward
 * SQL, checksum, rollback, checksum, then write a Change Dossier.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { classifyDdl, expandContractPlan, parseDossier } from '../packages/contract/dist/index.js';

const dbPath = process.env.SQLITE_PATH ?? path.join('data', 'airlock.sqlite');
const outDir = process.env.AIRLOCK_DATA_DIR ?? '.airlock';
const consoleUrl = process.env.AIRLOCK_CONSOLE_URL ?? '';
const dossierId = process.env.AIRLOCK_DOSSIER_ID ?? `dos_sqlite_tier_${Date.now()}`;
const requestedBy = process.env.AIRLOCK_REQUESTED_BY ?? 'damir@airlock.dev';
const keepShadow = process.env.AIRLOCK_KEEP_SHADOW === '1';
const emitOnly = process.argv.includes('--emit-only') || !consoleUrl;
const breakRollback = process.argv.includes('--break-rollback') || process.env.AIRLOCK_BREAK_ROLLBACK === '1';
const simulateDrift = process.argv.includes('--simulate-drift') || process.env.AIRLOCK_SIMULATE_DRIFT === '1';

const forward = [
  'ALTER TABLE users ADD COLUMN tier TEXT;',
  `UPDATE users
      SET tier = (
        SELECT subscriptions.plan_tier
          FROM subscriptions
         WHERE subscriptions.user_id = users.id
      );`,
  'DROP INDEX IF EXISTS idx_users_plan_name;',
  'ALTER TABLE users DROP COLUMN plan_name;',
];

const rollback = [
  'ALTER TABLE users ADD COLUMN plan_name TEXT;',
  breakRollback
    ? `UPDATE users
      SET plan_name = '__airlock_bad_rollback__';`
    : `UPDATE users
      SET plan_name = (
        SELECT subscriptions.legacy_plan_name
          FROM subscriptions
         WHERE subscriptions.user_id = users.id
      );`,
  'ALTER TABLE users DROP COLUMN tier;',
  'CREATE INDEX IF NOT EXISTS idx_users_plan_name ON users(plan_name);',
];

const ddlFindings = classifyDdl(forward);
const expandContract = ddlFindings.flatMap((finding) => expandContractPlan(finding));

function quote(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function tableColumns(db, table) {
  return db
    .prepare(`PRAGMA table_info(${quote(table)})`)
    .all()
    .map((row) => String(row.name))
    .sort();
}

function tableChecksum(db, table) {
  const columns = tableColumns(db, table);
  const h = createHash('sha256');
  h.update(`${table}\n`);
  h.update(`${columns.join('\t')}\n`);

  const projection = columns.map((column) => quote(column)).join(', ');
  const rows = db.prepare(`SELECT ${projection} FROM ${quote(table)} ORDER BY id`).all();
  for (const row of rows) {
    h.update(JSON.stringify(columns.map((column) => row[column] ?? null)));
    h.update('\n');
  }

  return `sha256:${h.digest('hex')}`;
}

function tableCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quote(table)}`).get().count);
}

function execSteps(db, steps) {
  const proven = [];
  for (const sql of steps) {
    db.exec(sql);
    proven.push({ system: 'postgres', op: sql, reversible: true, proven: true });
  }
  return proven;
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
const shadowPath = path.join(outDir, `${dossierId}.shadow.sqlite`);
const outputPath = path.join(outDir, `${dossierId}.dossier.json`);
const reportPath = path.join(outDir, `${dossierId}.verification.json`);

const checkpoint = new DatabaseSync(dbPath);
checkpoint.exec('PRAGMA wal_checkpoint(FULL)');
checkpoint.close();
copyFileSync(dbPath, shadowPath);

const started = Date.now();
const shadow = new DatabaseSync(shadowPath);

let forwardOps = [];
let rollbackOps = [];
let pre;
let post;
let postRollback;
let failed = null;

try {
  pre = tableChecksum(shadow, 'users');
  forwardOps = execSteps(shadow, forward);
  post = tableChecksum(shadow, 'users');
  rollbackOps = execSteps(shadow, rollback);
  postRollback = tableChecksum(shadow, 'users');
} catch (error) {
  failed = error;
} finally {
  shadow.close();
}

if (simulateDrift) {
  const drift = new DatabaseSync(dbPath);
  drift.prepare('UPDATE users SET updated_at = ? WHERE id = 1').run(new Date().toISOString());
  drift.close();
}

const production = new DatabaseSync(dbPath, { readOnly: true });
const productionChecksum = tableChecksum(production, 'users');
const userRows = tableCount(production, 'users');
const subscriptionRows = tableCount(production, 'subscriptions');
production.close();

const verifiedAt = new Date().toISOString();
const proofMatched = pre !== undefined && postRollback !== undefined && pre === postRollback;
const productionDrifted = pre !== undefined && productionChecksum !== pre;
const mismatchReason =
  pre !== undefined && postRollback !== undefined
    ? `Rollback completed, but post-rollback checksum ${postRollback} did not match pre-change checksum ${pre}.`
    : 'The shadow database did not return to its starting checksum after rollback.';
const certificate = failed
  ? {
      kind: 'UNDO',
      status: 'FAILED',
      ...(pre && post && postRollback ? { checksums: { pre, post, post_rollback: postRollback, match: false } } : {}),
      failure_reason: String(failed.message ?? failed),
      verified_at: verifiedAt,
    }
  : {
      kind: 'UNDO',
      status: proofMatched ? 'PROVEN' : 'FAILED',
      checksums: { pre, post, post_rollback: postRollback, match: proofMatched },
      lock_ms_estimate: Date.now() - started,
      table_rewrite: true,
      sandbox_artifact_url: `file://${path.resolve(reportPath)}`,
      ...(proofMatched
        ? {}
        : { failure_reason: mismatchReason }),
      verified_at: verifiedAt,
    };

const dossier = parseDossier({
  dossier_id: dossierId,
  change_class: 'SCHEMA_MIGRATION',
  request: 'Add a tier column to users, backfill it from subscriptions, then drop the deprecated plan_name column.',
  requested_by: requestedBy,
  started_by: 'api',
  created_at: verifiedAt,
  target: { project_ref: 'sqlite-local', branch_ref: shadowPath, systems: ['postgres'] },
  magnitude: { records: userRows, people: 0, amount_minor: 0, undo_window_seconds: 604800 },
  forward: forwardOps.length
    ? forwardOps
    : forward.map((op) => ({ system: 'postgres', op, reversible: true, proven: false })),
  rollback: rollbackOps.length
    ? rollbackOps
    : rollback.map((op) => ({ system: 'postgres', op, reversible: true, proven: false })),
  certificate,
  drift: { checked_at: verifiedAt, production_checksum: productionChecksum, drifted: productionDrifted },
  affected_tables: [
    { system: 'postgres', name: 'users', rows: userRows, operation: 'add column, backfill, drop column' },
    { system: 'postgres', name: 'subscriptions', rows: subscriptionRows, operation: 'read only (backfill source)' },
  ],
  blast_radius: [],
  risk_notes: [
    {
      note: 'SQLite shadow verification is the local Day 1 slice. Supabase branch lifecycle can wrap the same checksum flow once credentials are available.',
    },
    ...ddlFindings.map((finding) => ({
      note: `${finding.kind}: ${finding.reason}`,
    })),
    ...(expandContract.length
      ? [
          {
            note: `Expand/contract alternative generated ${expandContract.length} staged step(s) for review before hosted branch credentials exist.`,
          },
        ]
      : []),
    ...(breakRollback
      ? [
          {
            note: 'Negative verifier scenario: rollback SQL executed, but restored the wrong values. AIRLOCK must emit a FAILED certificate and keep the gate sealed.',
          },
        ]
      : []),
    ...(simulateDrift
      ? [
          {
            note: 'Drift scenario: rollback proof still passed, but production changed before approval. AIRLOCK must seal the gate until verification is re-run.',
          },
        ]
      : []),
  ],
  recommendation: proofMatched && !productionDrifted ? 'APPLY' : 'BLOCK',
});

writeFileSync(
  reportPath,
  JSON.stringify(
    {
      dossier_id: dossierId,
      database: path.resolve(dbPath),
      shadow: {
        path: path.resolve(shadowPath),
        kept: keepShadow,
      },
      checksums: certificate.checksums ?? null,
      forward,
      rollback,
      ddl_findings: ddlFindings,
      expand_contract_plan: expandContract,
      scenario: breakRollback ? 'break-rollback' : simulateDrift ? 'simulate-drift' : 'happy-path',
      production_drifted: productionDrifted,
      failed: failed ? String(failed.message ?? failed) : null,
      verified_at: verifiedAt,
    },
    null,
    2,
  ),
  'utf8',
);
writeFileSync(outputPath, JSON.stringify(dossier, null, 2), 'utf8');

if (!keepShadow) rmSync(shadowPath, { force: true });

if (emitOnly) {
  console.log(JSON.stringify(dossier, null, 2));
  console.error(`\nWrote ${outputPath}. Set AIRLOCK_CONSOLE_URL=http://localhost:3000 to post it.`);
} else {
  const result = await postDossier(dossier);
  console.log(`Posted ${result.dossier?.dossier_id ?? dossier.dossier_id} to ${consoleUrl}/api/dossiers.`);
  console.log(`Local copy: ${outputPath}`);
}

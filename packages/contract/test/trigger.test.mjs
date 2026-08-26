import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBrief,
  splitStatements,
  renderCertificateComment,
  shouldDeliverCertificate,
  parseDossier,
} from '../dist/index.js';

/**
 * The trigger and the delivery — the two ends of a run nobody started.
 *
 * These are the claims worth defending: that the agent's task is derived from
 * the diff rather than typed, and that the certificate reaches the human
 * exactly once.
 */

const RENDER = { consoleUrl: 'http://localhost:3000' };

// Checksums are validated by the contract, so the fixtures use real ones.
const A = `sha256:${'a'.repeat(64)}`;
const B = `sha256:${'b'.repeat(64)}`;
const C = `sha256:${'c'.repeat(64)}`;

function dossier(overrides = {}) {
  return parseDossier({
    dossier_id: 'dos_pr_7_abc1234',
    change_class: 'SCHEMA_MIGRATION',
    request: 'derived',
    requested_by: 'github:someone',
    started_by: 'webhook',
    created_at: '2026-08-26T00:00:00.000Z',
    target: { systems: ['postgres'] },
    ...overrides,
  });
}

const prOrigin = (extra = {}) => ({
  kind: 'pull_request',
  repo: 'Rohit-ATS/Airlock',
  pr_number: 7,
  head_sha: 'abc1234',
  paths: ['migrations/003_drop.sql'],
  detected_at: '2026-08-26T00:00:00.000Z',
  notified_at: null,
  ...extra,
});

const provenUndo = {
  kind: 'UNDO',
  status: 'PROVEN',
  checksums: { pre: A, post: B, post_rollback: A, match: true },
};

/* --- splitting ------------------------------------------------------------- */

test('statements split on semicolons that actually terminate a statement', () => {
  const sql = `ALTER TABLE users DROP COLUMN email;\nCREATE INDEX i ON t (c);`;
  assert.deepEqual(splitStatements(sql), ['ALTER TABLE users DROP COLUMN email', 'CREATE INDEX i ON t (c)']);
});

test('a semicolon inside a string literal does not split the statement', () => {
  const sql = `INSERT INTO t (note) VALUES ('a; b');`;
  assert.equal(splitStatements(sql).length, 1);
});

test('a semicolon inside a dollar-quoted body does not split the statement', () => {
  const sql = `CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END $$ LANGUAGE plpgsql;`;
  assert.equal(splitStatements(sql).length, 1);
});

test('a semicolon inside a line comment does not split the statement', () => {
  const sql = `ALTER TABLE t DROP COLUMN c -- careful; really\n;`;
  assert.equal(splitStatements(sql).length, 1);
});

/* --- the brief is derived, not typed --------------------------------------- */

test('the brief names what the classifier found, not what a template says', () => {
  const brief = deriveBrief({
    repo: 'Rohit-ATS/Airlock',
    pull: 7,
    headSha: 'abc1234',
    files: [{ path: 'migrations/003_drop.sql', sql: 'ALTER TABLE users DROP COLUMN email;' }],
  });

  assert.equal(brief.severity, 'destructive');
  assert.equal(brief.findings.length, 1);
  assert.equal(brief.findings[0].kind, 'DROP_COLUMN');
  // The specifics of this diff appear in the text; that is what makes it derived.
  assert.match(brief.text, /users\.email/);
  assert.match(brief.text, /ALTER TABLE users DROP COLUMN email/);
  assert.match(brief.text, /abc1234/);
});

test('a different diff produces a different brief — it describes, it does not prompt', () => {
  const base = { repo: 'Rohit-ATS/Airlock', pull: 7, headSha: 'abc1234' };
  const drop = deriveBrief({ ...base, files: [{ path: 'm.sql', sql: 'ALTER TABLE users DROP COLUMN email;' }] });
  const add = deriveBrief({ ...base, files: [{ path: 'm.sql', sql: 'CREATE INDEX i ON users (email);' }] });

  assert.notEqual(drop.text, add.text);
  assert.equal(drop.severity, 'destructive');
  assert.equal(add.severity, 'safe');
});

test('a harmless migration says so rather than staying silent about it', () => {
  const brief = deriveBrief({
    repo: 'r/r',
    pull: 1,
    headSha: 'deadbee',
    files: [{ path: 'm.sql', sql: 'CREATE INDEX CONCURRENTLY i ON t (c);' }],
  });
  assert.match(brief.text, /no destructive DDL/i);
});

test('the worst finding in the diff sets the severity', () => {
  const brief = deriveBrief({
    repo: 'r/r',
    pull: 1,
    headSha: 'deadbee',
    files: [
      { path: 'a.sql', sql: 'CREATE INDEX i ON t (c);' },
      { path: 'b.sql', sql: 'DROP TABLE orders;' },
    ],
  });
  assert.equal(brief.severity, 'destructive');
});

/* --- delivery happens once ------------------------------------------------- */

test('a certificate from a pull request is delivered', () => {
  assert.equal(shouldDeliverCertificate(dossier({ origin: prOrigin(), certificate: provenUndo })), true);
});

test('an already-notified change is never delivered a second time', () => {
  const already = dossier({
    origin: prOrigin({ notified_at: '2026-08-26T01:00:00.000Z' }),
    certificate: provenUndo,
  });
  assert.equal(shouldDeliverCertificate(already), false);
});

test('a change with no certificate yet is not delivered', () => {
  assert.equal(shouldDeliverCertificate(dossier({ origin: prOrigin() })), false);
});

test('a change nobody triggered from a pull request has nowhere to deliver to', () => {
  assert.equal(shouldDeliverCertificate(dossier({ certificate: provenUndo })), false);
  const sweep = dossier({ origin: prOrigin({ kind: 'sweep' }), certificate: provenUndo });
  assert.equal(shouldDeliverCertificate(sweep), false);
});

/* --- what the human reads -------------------------------------------------- */

test('the comment states the verdict, the proof and what happens on refusal', () => {
  const body = renderCertificateComment(dossier({ origin: prOrigin(), certificate: provenUndo }), RENDER);

  assert.match(body, /UNDO certificate proven/);
  assert.match(body, new RegExp(A));
  assert.match(body, /before == after rollback/);
  assert.match(body, /If you say no/);
  assert.match(body, /no human started this run/i);
});

test('the comment recomputes the checksum match rather than trusting the flag', () => {
  // `match: true` is a lie here; the numbers disagree. The comment must say so,
  // because this is the text a human approves from.
  const lying = {
    kind: 'UNDO',
    status: 'PROVEN',
    checksums: { pre: A, post: B, post_rollback: C, match: true },
  };
  const body = renderCertificateComment(dossier({ origin: prOrigin(), certificate: lying }), RENDER);
  assert.match(body, /does not restore it/);
  assert.doesNotMatch(body, /before == after rollback/);
});

test('a failed certificate offers nothing to approve', () => {
  const failed = { kind: 'UNDO', status: 'FAILED', failure_reason: 'rollback left 3 rows behind' };
  const body = renderCertificateComment(dossier({ origin: prOrigin(), certificate: failed }), RENDER);

  assert.match(body, /FAILED/);
  assert.match(body, /rollback left 3 rows behind/);
  assert.match(body, /gate is sealed/i);
  assert.doesNotMatch(body, /Approve or refuse/);
});

test('the comment says approval cannot be automated', () => {
  const body = renderCertificateComment(dossier({ origin: prOrigin(), certificate: provenUndo }), RENDER);
  assert.match(body, /cannot be automated/);
  assert.match(body, /no auto-approve/i);
});

test('exclusions are stated even when there are none', () => {
  const scoped = {
    kind: 'SCOPE',
    status: 'PROVEN',
    scope: {
      records: [{ system: 'postgres', table: 'users', id: 'u1', action: 'delete', count: 12 }],
      exclusions: [],
    },
  };
  const body = renderCertificateComment(dossier({ origin: prOrigin(), certificate: scoped }), RENDER);
  assert.match(body, /No exclusions were recorded/);
  assert.match(body, /12/);
});

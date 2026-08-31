import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findUnsafeSqliteStatement, verifyOnSqliteShadow } from '../dist/index.js';

test('file-affecting sqlite statements are refused before shadow execution', () => {
  assert.equal(findUnsafeSqliteStatement('UPDATE users SET tier = "pro" WHERE id = 1;'), null);
  assert.equal(findUnsafeSqliteStatement("UPDATE users SET note = 'ATTACH DATABASE /tmp/x AS prod';"), null);

  assert.equal(findUnsafeSqliteStatement("ATTACH DATABASE '/tmp/prod.sqlite' AS prod;"), 'attach');
  assert.equal(findUnsafeSqliteStatement('DETACH prod;'), 'detach');
  assert.equal(findUnsafeSqliteStatement("VACUUM INTO '/tmp/copy.sqlite';"), 'vacuum into');
  assert.equal(findUnsafeSqliteStatement('PRAGMA writable_schema = ON;'), 'pragma');
  assert.equal(findUnsafeSqliteStatement("SELECT load_extension('/tmp/ext');"), 'load_extension');
  assert.equal(findUnsafeSqliteStatement('SELECT "load_extension"(\'/tmp/ext\');'), 'load_extension');
});

test('sqlite shadow verifier refuses ATTACH without mutating the source database', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'airlock-sqlite-test-'));
  const databasePath = path.join(dir, 'prod.sqlite');
  const shadowDir = path.join(dir, 'shadow');

  try {
    const db = new DatabaseSync(databasePath);
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, tier TEXT); INSERT INTO users VALUES (1, 'free');");
    db.close();

    const result = verifyOnSqliteShadow({
      databasePath,
      shadowDir,
      runId: 'attach_escape',
      tables: ['users'],
      forward: [`ATTACH DATABASE '${databasePath.replaceAll("'", "''")}' AS prod; UPDATE prod.users SET tier = 'admin';`],
      rollback: ["UPDATE users SET tier = 'free' WHERE id = 1;"],
    });

    assert.equal(result.status, 'FAILED');
    assert.match(result.failure_reason ?? '', /attach/i);

    const after = new DatabaseSync(databasePath);
    assert.equal(after.prepare('SELECT tier FROM users WHERE id = 1').get().tier, 'free');
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ordinary sqlite shadow verification still succeeds', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'airlock-sqlite-test-'));
  const databasePath = path.join(dir, 'prod.sqlite');
  const shadowDir = path.join(dir, 'shadow');

  try {
    const db = new DatabaseSync(databasePath);
    db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, tier TEXT); INSERT INTO users VALUES (1, 'free');");
    db.close();

    const result = verifyOnSqliteShadow({
      databasePath,
      shadowDir,
      runId: 'ordinary',
      tables: ['users'],
      forward: ["UPDATE users SET tier = 'pro' WHERE id = 1;"],
      rollback: ["UPDATE users SET tier = 'free' WHERE id = 1;"],
    });

    assert.equal(result.status, 'PROVEN');
    assert.equal(result.checksums?.match, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

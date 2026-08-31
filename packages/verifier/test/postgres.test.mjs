import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSchemaQualifier,
  findUnsafePostgresStatement,
  parseSnapshots,
  rewrittenTables,
  snapshotSql,
} from '../dist/index.js';

test('qualified statements are refused because they bypass the shadow search_path', () => {
  assert.equal(findSchemaQualifier('alter table public.users add column tier text;'), 'public.users');
  assert.equal(findSchemaQualifier('alter table "public"."users" add column tier text;'), 'public.users');
  assert.equal(findSchemaQualifier('update "public.users" set note = \'schema.name is data\';'), null);
  assert.equal(findSchemaQualifier("insert into audit_log(message) values ('public.users')"), null);
});

test('session and transaction control are refused in postgres shadow statements', () => {
  assert.equal(findUnsafePostgresStatement("set lock_timeout = '5s'; alter table users add column tier text;"), null);
  assert.equal(findUnsafePostgresStatement("update users set note = 'SET search_path = public'"), null);

  assert.equal(findUnsafePostgresStatement('SET search_path TO public; UPDATE users SET tier = 1;'), 'set search_path');
  assert.equal(findUnsafePostgresStatement('set local search_path to public'), 'set search_path');
  assert.equal(findUnsafePostgresStatement('SET "search_path" TO public; UPDATE users SET tier = 1;'), 'set search_path');
  assert.equal(findUnsafePostgresStatement('RESET search_path; UPDATE users SET tier = 1;'), 'reset search_path');
  assert.equal(findUnsafePostgresStatement("select set_config('search_path', 'public', true);"), 'set_config');
  assert.equal(findUnsafePostgresStatement('select "set_config"(\'search_path\', \'public\', true);'), 'set_config');
  assert.equal(findUnsafePostgresStatement('COMMIT; ALTER TABLE users ADD COLUMN tier text;'), 'commit');
  assert.equal(findUnsafePostgresStatement('SET ROLE postgres; UPDATE users SET tier = 1;'), 'set role');
  assert.equal(findUnsafePostgresStatement('SET SESSION AUTHORIZATION postgres; UPDATE users SET tier = 1;'), 'set session authorization');
  assert.equal(findUnsafePostgresStatement('DISCARD ALL; UPDATE users SET tier = 1;'), 'discard');
  assert.equal(findUnsafePostgresStatement('DO $$ BEGIN PERFORM set_config(\'search_path\', \'public\', true); END $$;'), 'set_config');
  assert.equal(findUnsafePostgresStatement('PREPARE p AS UPDATE users SET tier = 1; EXECUTE p;'), 'prepare');
  assert.equal(findUnsafePostgresStatement('CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;'), 'create function');
  assert.equal(findUnsafePostgresStatement('ALTER ROLE app SET search_path = public;'), 'alter role');
});

test('postgres snapshot SQL captures relfilenode, indexes and constraints', () => {
  const sql = snapshotSql('airlock_shadow_run_1', ['users', "plan's"]);

  assert.match(sql, /pg_indexes/);
  assert.match(sql, /pg_constraint/);
  assert.match(sql, /relfilenode/);
  assert.match(sql, /values \('users'\), \('plan''s'\)/);
  assert.doesNotMatch(sql, /plan's/);
});

test('snapshot rows are normalised from Supabase JSON responses', () => {
  const [snapshot] = parseSnapshots([
    {
      table: 'users',
      relfilenode: 12345,
      indexes: '["CREATE INDEX users_email_idx ON users(email)"]',
      constraints: ['users_pkey: PRIMARY KEY (id)'],
    },
  ]);

  assert.deepEqual(snapshot, {
    table: 'users',
    relfilenode: '12345',
    indexes: ['CREATE INDEX users_email_idx ON users(email)'],
    constraints: ['users_pkey: PRIMARY KEY (id)'],
  });
});

test('table rewrite detection is based on relfilenode changes, not row digests', () => {
  const before = [
    { table: 'audit_log', relfilenode: '10', indexes: [], constraints: [] },
    { table: 'users', relfilenode: '20', indexes: [], constraints: [] },
  ];
  const after = [
    { table: 'audit_log', relfilenode: '10', indexes: [], constraints: [] },
    { table: 'users', relfilenode: '21', indexes: [], constraints: [] },
  ];

  assert.deepEqual(rewrittenTables(before, after), ['users']);
});

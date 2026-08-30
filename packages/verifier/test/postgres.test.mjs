import test from 'node:test';
import assert from 'node:assert/strict';
import { findSchemaQualifier, parseSnapshots, rewrittenTables, snapshotSql } from '../dist/index.js';

test('qualified statements are refused because they bypass the shadow search_path', () => {
  assert.equal(findSchemaQualifier('alter table public.users add column tier text;'), 'public.users');
  assert.equal(findSchemaQualifier('alter table "public"."users" add column tier text;'), 'public.users');
  assert.equal(findSchemaQualifier('update "public.users" set note = \'schema.name is data\';'), null);
  assert.equal(findSchemaQualifier("insert into audit_log(message) values ('public.users')"), null);
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

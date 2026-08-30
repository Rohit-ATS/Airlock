import test from 'node:test';
import assert from 'node:assert/strict';
import { buildErasureScopePlan, postgresErasureScopeSql, summariseErasureScopeRows } from '../dist/index.js';

const user = {
  id: 17,
  email: 'dana.reyes@example.com',
  stripe_customer_id: 'cus_17',
  slack_user_id: 'U017',
  upload_prefix: 'users/17/',
};

test('builds the same erasure scope shape across database and external systems', () => {
  const scope = buildErasureScopePlan({
    user,
    counts: { sessions: 3, auditRows: 2, retainedInvoices: 4, uploads: 5 },
  });

  assert.deepEqual(scope.target_systems, ['postgres', 'stripe', 'slack', 'object_storage']);
  assert.equal(scope.record_count, 17);
  assert.deepEqual(scope.records.map((record) => `${record.system}:${record.table}:${record.action}:${record.count}`), [
    'postgres:users:anonymize:1',
    'postgres:sessions:delete:3',
    'postgres:audit_log:anonymize:2',
    'stripe:customer:delete:1',
    'slack:user:anonymize:1',
    'object_storage:airlock-uploads:delete:5',
  ]);
  assert.equal(scope.exclusions.length, 1);
  assert.equal(scope.exclusions[0].table, 'invoices');
  assert.match(scope.exclusions[0].reason, /statutory retention/i);
  assert.equal(scope.forward.every((op) => op.proven === true && op.reversible === false), true);
});

test('omits empty buckets without turning the scope into unbounded nothing', () => {
  const scope = buildErasureScopePlan({
    user,
    counts: { sessions: 0, auditRows: 0, retainedInvoices: 0, uploads: 0 },
  });

  assert.deepEqual(scope.records.map((record) => `${record.system}:${record.table}`), [
    'postgres:users',
    'stripe:customer',
    'slack:user',
  ]);
  assert.deepEqual(scope.exclusions, []);
  assert.equal(scope.record_count, 3);
});

test('postgres erasure query enumerates rows but keeps invoices as retained scope', () => {
  const sql = postgresErasureScopeSql(17);

  assert.match(sql, /from public\.users/);
  assert.match(sql, /from public\.sessions/);
  assert.match(sql, /from public\.audit_log/);
  assert.match(sql, /from public\.invoices/);
  assert.match(sql, /from public\.user_uploads/);
  assert.match(sql, /'retain'/);
  assert.match(sql, /where id = 17/);
  assert.throws(() => postgresErasureScopeSql('17; drop table users'), /positive integer/);
});

test('summarises postgres scope rows into certificate records and exclusions', () => {
  const summary = summariseErasureScopeRows([
    { system: 'postgres', table: 'users', id: '17', action: 'anonymize' },
    { system: 'postgres', table: 'sessions', id: '1', action: 'delete' },
    { system: 'postgres', table: 'sessions', id: '2', action: 'delete' },
    { system: 'postgres', table: 'audit_log', id: '9', action: 'anonymize' },
    { system: 'postgres', table: 'invoices', id: '5', action: 'retain' },
    { system: 'stripe', table: 'customer', id: 'cus_17', action: 'delete' },
    { system: 'slack', table: 'user', id: 'U017', action: 'anonymize' },
    { system: 'object_storage', table: 'airlock-uploads', id: 'obj_1', action: 'delete' },
    { system: 'object_storage', table: 'airlock-uploads', id: 'obj_2', action: 'delete' },
  ]);

  assert.equal(summary.record_count, 9);
  assert.deepEqual(summary.records.map((record) => `${record.system}:${record.table}:${record.count}`), [
    'postgres:users:1',
    'postgres:sessions:2',
    'postgres:audit_log:1',
    'stripe:customer:1',
    'slack:user:1',
    'object_storage:airlock-uploads:2',
  ]);
  assert.equal(summary.exclusions[0].count, 1);
});

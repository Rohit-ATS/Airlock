/**
 * Generates the three example dossiers.
 *
 * These are CONSOLE FIXTURES: they exercise the certificate card, the queue and
 * the ledger without requiring the verification engine to be running. They are
 * not proof of anything about a database, and the README says so.
 *
 * Checksums are real sha256 digests so the card renders genuine 64-character
 * hashes — and so the "byte-identical" case is genuinely byte-identical rather
 * than two strings that merely look alike.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const h = (s) => 'sha256:' + createHash('sha256').update(s).digest('hex');

const provenPre = h('users@1200000rows@pre-migration');

const proven = {
  dossier_id: 'dos_tier_migration',
  change_class: 'SCHEMA_MIGRATION',
  request: 'Add a tier column to users, backfill it from subscriptions, then drop the deprecated plan_name column.',
  requested_by: 'rohit@airlock.dev',
  started_by: 'ui',
  created_at: '2026-08-24T09:02:00Z',
  session_id: null,
  turn_id: null,
  target: { project_ref: 'airlock-demo', branch_ref: 'br_shadow_4f21a', systems: ['postgres'] },
  forward: [
    { system: 'postgres', op: 'ALTER TABLE users ADD COLUMN tier text;', reversible: true, proven: true },
    {
      system: 'postgres',
      op: 'UPDATE users u SET tier = s.plan_tier\n  FROM subscriptions s\n WHERE s.user_id = u.id;',
      reversible: true,
      proven: true,
    },
    { system: 'postgres', op: 'ALTER TABLE users DROP COLUMN plan_name;', reversible: true, proven: true },
  ],
  rollback: [
    { system: 'postgres', op: 'ALTER TABLE users ADD COLUMN plan_name text;', reversible: true, proven: true },
    {
      system: 'postgres',
      op: 'UPDATE users u SET plan_name = s.legacy_plan_name\n  FROM subscriptions s\n WHERE s.user_id = u.id;',
      reversible: true,
      proven: true,
    },
    { system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier;', reversible: true, proven: true },
  ],
  certificate: {
    kind: 'UNDO',
    status: 'PROVEN',
    checksums: {
      pre: provenPre,
      post: h('users@1200000rows@post-migration'),
      post_rollback: provenPre,
      match: true,
    },
    lock_ms_estimate: 4210,
    table_rewrite: false,
    sandbox_artifact_url: 'sandbox://verify/dos_tier_migration/report.json',
    verified_at: '2026-08-24T09:06:11Z',
  },
  affected_tables: [
    { system: 'postgres', name: 'users', rows: 1200000, operation: 'add column, backfill, drop column' },
    { system: 'postgres', name: 'subscriptions', rows: 1180422, operation: 'read only (backfill source)' },
  ],
  blast_radius: [
    { repo: 'airlock/app', file: 'src/billing/plan.ts', line: 42, symbol: 'resolvePlanName' },
    { repo: 'airlock/app', file: 'src/billing/plan.ts', line: 118, symbol: 'serializeUser' },
    { repo: 'airlock/app', file: 'src/api/users/route.ts', line: 57, symbol: 'GET' },
    { repo: 'airlock/app', file: 'src/emails/welcome.tsx', line: 23, symbol: 'WelcomeEmail' },
    { repo: 'airlock/app', file: 'tests/billing.spec.ts', line: 88, symbol: 'plan name fixture' },
  ],
  questions: [],
  recommendation: 'APPLY',
  risk_notes: [
    {
      note: 'ADD COLUMN with no default does not rewrite the table on PostgreSQL 11 and later, so the ACCESS EXCLUSIVE lock is held only briefly.',
      source_url: 'https://www.postgresql.org/docs/16/sql-altertable.html',
      source_title: 'PostgreSQL 16 — ALTER TABLE',
    },
    { note: 'The backfill runs in batches of 10,000 rows to avoid holding one long transaction over 1.2M rows.' },
  ],
  harness_events: [],
  cost: {
    usd: 0.4127,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.3312, 'zai/glm-5.2': 0.0815 },
    tokens: { input: 184220, output: 12894, total: 197114 },
  },
  approval: { approver: null, at: null, role_required: 'approver', decision: null, reason: null },
  audit: { applied_at: null, post_apply_checksum: null, applied_by: null },
};

const failed = {
  dossier_id: 'dos_currency_fix',
  change_class: 'DATA_OPERATION',
  request: 'Every EU invoice created before 2026-01-01 was stored in USD instead of EUR. Correct them.',
  requested_by: 'rohit@airlock.dev',
  started_by: 'ui',
  created_at: '2026-08-24T10:14:00Z',
  session_id: null,
  turn_id: null,
  target: { project_ref: 'airlock-demo', branch_ref: 'br_shadow_9c3de', systems: ['postgres'] },
  forward: [
    {
      system: 'postgres',
      op: "UPDATE invoices\n   SET currency = 'EUR',\n       amount_minor = ROUND(amount_minor / 1.0871)\n WHERE region = 'EU'\n   AND created_at < '2026-01-01';",
      reversible: false,
      proven: true,
    },
  ],
  rollback: [
    {
      system: 'postgres',
      op: "UPDATE invoices\n   SET currency = 'USD',\n       amount_minor = ROUND(amount_minor * 1.0871)\n WHERE region = 'EU'\n   AND created_at < '2026-01-01';",
      reversible: false,
      proven: true,
    },
  ],
  certificate: {
    kind: 'UNDO',
    status: 'FAILED',
    checksums: {
      pre: h('invoices@47120rows@pre'),
      post: h('invoices@47120rows@post'),
      post_rollback: h('invoices@47120rows@post-rollback-drifted-by-2'),
      match: false,
    },
    lock_ms_estimate: 18740,
    table_rewrite: true,
    failure_reason:
      'Rollback restored 47,118 of 47,120 rows.\n\nTwo rows did not return to their starting value: ROUND() is not invertible, and amounts 1699 and 2549 minor units both map to 1563 on the forward pass, so they cannot be told apart on the way back.\n\nA rollback that mostly restores data is a failure, not a warning.',
    verified_at: '2026-08-24T10:19:52Z',
  },
  affected_tables: [{ system: 'postgres', name: 'invoices', rows: 47120, operation: 'update currency and amount' }],
  blast_radius: [
    { repo: 'airlock/app', file: 'src/billing/invoice.ts', line: 210, symbol: 'formatAmount' },
    { repo: 'airlock/app', file: 'src/reports/revenue.ts', line: 64, symbol: 'sumByCurrency' },
  ],
  questions: [],
  recommendation: 'EXPAND_CONTRACT',
  risk_notes: [
    {
      note: 'A lossy arithmetic correction cannot be proven reversible. Write the corrected value into a new column, migrate readers to it, then drop the old column once nothing reads it.',
    },
  ],
  harness_events: [],
  cost: {
    usd: 0.2891,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.2313, 'zai/glm-5.2': 0.0578 },
    tokens: { input: 121004, output: 8420, total: 129424 },
  },
  approval: { approver: null, at: null, role_required: 'approver', decision: null, reason: null },
  audit: { applied_at: null, post_apply_checksum: null, applied_by: null },
};

const erasure = {
  dossier_id: 'dos_erasure_dana_reyes',
  change_class: 'ERASURE',
  request: 'Right-to-erasure request for dana.reyes@example.com. Remove them from every system we hold them in.',
  requested_by: 'rohit@airlock.dev',
  started_by: 'ui',
  created_at: '2026-08-24T11:40:00Z',
  session_id: null,
  turn_id: null,
  target: {
    project_ref: 'airlock-demo',
    branch_ref: 'br_shadow_e71b3',
    systems: ['postgres', 'stripe', 'slack', 'object_storage'],
  },
  forward: [
    {
      system: 'postgres',
      op: 'DELETE FROM users WHERE email = $1;\n-- cascades: sessions, preferences',
      reversible: false,
      proven: false,
    },
    { system: 'stripe', op: 'customers.del("cus_Qk29ZtL4mXbW1p")', reversible: false, proven: false },
    { system: 'slack', op: 'admin.users.remove("U04H2K9PLQ2")', reversible: false, proven: false },
    { system: 'object_storage', op: 'DELETE s3://airlock-uploads/avatars/8f21c/*   (3 objects)', reversible: false, proven: false },
  ],
  rollback: [],
  certificate: {
    kind: 'SCOPE',
    status: 'PROVEN',
    scope: {
      records: [
        { system: 'postgres', table: 'users', id: 'usr_8f21c', action: 'delete', count: 1 },
        { system: 'postgres', table: 'sessions', id: 'user_id=usr_8f21c', action: 'delete', count: 47 },
        { system: 'postgres', table: 'preferences', id: 'user_id=usr_8f21c', action: 'delete', count: 12 },
        { system: 'stripe', table: 'customers', id: 'cus_Qk29ZtL4mXbW1p', action: 'delete', count: 1 },
        { system: 'stripe', table: 'payment_methods', id: 'pm_1PxQ2LEXAMPLE', action: 'delete', count: 1 },
        { system: 'slack', table: 'members', id: 'U04H2K9PLQ2', action: 'delete', count: 1 },
        { system: 'object_storage', table: 'avatars', id: 's3://airlock-uploads/avatars/8f21c/', action: 'delete', count: 3 },
      ],
      exclusions: [
        {
          system: 'postgres',
          table: 'invoices',
          reason:
            'Seven-year statutory retention under UK VAT record-keeping rules. Retained with the customer name replaced by a pseudonym, which satisfies the erasure request without destroying the financial record.',
          count: 12,
        },
        {
          system: 'postgres',
          table: 'audit_log',
          reason: 'Immutable security audit trail. The actor id is retained; every personal field is nulled.',
          count: 318,
        },
        {
          system: 'stripe',
          table: 'charges',
          reason:
            'Stripe retains charge records for financial reporting and does not delete them when a customer is deleted. Nothing further is held on our side.',
          count: 9,
        },
      ],
    },
    lock_ms_estimate: 890,
    table_rewrite: false,
    sandbox_artifact_url: 'sandbox://verify/dos_erasure_dana_reyes/scope.json',
    verified_at: '2026-08-24T11:47:03Z',
  },
  affected_tables: [
    { system: 'postgres', name: 'users', rows: 1, operation: 'delete' },
    { system: 'postgres', name: 'sessions', rows: 47, operation: 'cascade delete' },
    { system: 'postgres', name: 'preferences', rows: 12, operation: 'cascade delete' },
  ],
  blast_radius: [{ repo: 'airlock/app', file: 'src/privacy/erasure.ts', line: 31, symbol: 'eraseSubject' }],
  questions: [
    {
      asked:
        'Invoices for this person fall under a seven-year statutory retention obligation. Delete them anyway, pseudonymise them, or retain them unchanged?',
      options: ['Delete them', 'Pseudonymise and retain', 'Retain unchanged'],
      answered_by: 'rohit@airlock.dev',
      answer: 'Pseudonymise and retain',
      at: '2026-08-24T11:45:12Z',
    },
  ],
  recommendation: 'APPLY',
  risk_notes: [
    {
      note: 'Stripe does not delete charge objects when a customer is deleted; they remain in Stripe for financial reporting. That is disclosed in the exclusion list rather than quietly ignored.',
    },
  ],
  harness_events: [],
  cost: {
    usd: 0.6633,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.5104, 'zai/glm-5.2': 0.1529 },
    tokens: { input: 288411, output: 19203, total: 307614 },
  },
  approval: { approver: null, at: null, role_required: 'approver', decision: null, reason: null },
  audit: { applied_at: null, post_apply_checksum: null, applied_by: null },
};

const files = [
  ['schema-migration.proven.json', proven],
  ['data-operation.failed.json', failed],
  ['erasure.scope.json', erasure],
];

for (const [name, value] of files) {
  writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n');
  console.log('wrote', name);
}

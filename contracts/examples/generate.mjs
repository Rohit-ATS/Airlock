/**
 * Generates the example dossiers.
 *
 * These are CONSOLE FIXTURES: they exercise the certificate card, the queue,
 * the policy engine and the ledger without requiring the verification engine to
 * be running. They are not proof of anything about a database, and the README
 * says so.
 *
 * Checksums are real sha256 digests so the card renders genuine 64-character
 * hashes — and so the "byte-identical" case is genuinely byte-identical rather
 * than two strings that merely look alike.
 *
 * The set is chosen so that every way the gate can refuse is represented once:
 *
 *   dos_tier_migration     UNDO proven, one signature needed   -> GATE OPEN
 *   dos_currency_fix       rollback restored 1,199,998/1.2M    -> CERTIFICATE_FAILED
 *   dos_erasure_dana       SCOPE proven, one of two signed     -> GATE OPEN, final
 *   dos_access_oncall      SCOPE proven, expiry present        -> GATE OPEN, countersign
 *   dos_access_standing    SCOPE proven, no expiry             -> GRANT_WITHOUT_EXPIRY
 *   dos_refund_stripe      SCOPE proven, GBP 41,900            -> POLICY_AMOUNT_CEILING
 *   dos_incident_email     SCOPE proven, 61,400 people         -> POLICY_PEOPLE_CEILING
 *   dos_replica_scaledown  UNDO proven, production moved       -> PRODUCTION_DRIFTED
 *
 * plus three decided records so the ledger has a real hash chain in it.
 *
 * Timestamps: the eight undecided fixtures are re-based to the current time
 * when the console seeds them, because a certificate has a freshness window and
 * a demo whose queue is permanently expired demonstrates nothing. The three
 * decided records are NOT re-based — history is history, and their receipts
 * commit to the timestamps they were sealed with. See seedIfEmpty().
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const h = (s) => 'sha256:' + createHash('sha256').update(s).digest('hex');

const EMPTY_COST = { usd: 0, by_model: {}, tokens: { input: 0, output: 0, total: 0 } };
const NO_APPROVAL = { approver: null, at: null, role_required: 'approver', decision: null, reason: null };
const NO_AUDIT = { applied_at: null, post_apply_checksum: null, applied_by: null };
const NO_DRIFT = { checked_at: null, production_checksum: null, drifted: null };

/** Fill the parts of the contract every fixture shares, so each one below reads as its own story. */
const dossier = (d) => ({
  started_by: 'ui',
  session_id: null,
  turn_id: null,
  forward: [],
  rollback: [],
  magnitude: { records: 0, people: 0, amount_minor: 0, undo_window_seconds: null },
  principals: [],
  affected_tables: [],
  blast_radius: [],
  questions: [],
  recommendation: null,
  risk_notes: [],
  harness_events: [],
  cost: EMPTY_COST,
  signatures: [],
  approval: NO_APPROVAL,
  drift: NO_DRIFT,
  audit: NO_AUDIT,
  receipt: null,
  ...d,
});

/* ========================================================================== */
/* 1. The headline: a schema migration proven reversible                       */
/* ========================================================================== */

const tierPre = h('users@1200000rows@pre-migration');

const tierMigration = dossier({
  dossier_id: 'dos_tier_migration',
  change_class: 'SCHEMA_MIGRATION',
  request: 'Add a tier column to users, backfill it from subscriptions, then drop the deprecated plan_name column.',
  requested_by: 'priya.n@airlock.dev',
  created_at: '2026-08-24T09:02:00Z',
  target: { project_ref: 'airlock-demo', branch_ref: 'br_shadow_4f21a', systems: ['postgres'] },
  magnitude: { records: 1_200_000, people: 0, amount_minor: 0, undo_window_seconds: 604800 },
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
      pre: tierPre,
      post: h('users@1200000rows@post-migration'),
      post_rollback: tierPre,
      match: true,
    },
    lock_ms_estimate: 4210,
    table_rewrite: false,
    sandbox_artifact_url: 'sandbox://verify/dos_tier_migration/report.json',
    verified_at: '2026-08-24T09:06:11Z',
  },
  drift: { checked_at: '2026-08-24T09:06:40Z', production_checksum: tierPre, drifted: false },
  affected_tables: [
    { system: 'postgres', name: 'users', rows: 1_200_000, operation: 'add column, backfill, drop column' },
    { system: 'postgres', name: 'subscriptions', rows: 1_180_422, operation: 'read only (backfill source)' },
  ],
  blast_radius: [
    { repo: 'airlock/app', file: 'src/billing/plan.ts', line: 42, symbol: 'resolvePlanName' },
    { repo: 'airlock/app', file: 'src/billing/plan.ts', line: 118, symbol: 'serializeUser' },
    { repo: 'airlock/app', file: 'src/api/users/route.ts', line: 57, symbol: 'GET' },
    { repo: 'airlock/app', file: 'src/emails/welcome.tsx', line: 23, symbol: 'WelcomeEmail' },
    { repo: 'airlock/app', file: 'tests/billing.spec.ts', line: 88, symbol: 'plan name fixture' },
  ],
  recommendation: 'APPLY',
  risk_notes: [
    {
      note: 'ADD COLUMN with no default does not rewrite the table on PostgreSQL 11 and later, so the ACCESS EXCLUSIVE lock is held only briefly.',
      source_url: 'https://www.postgresql.org/docs/16/sql-altertable.html',
      source_title: 'PostgreSQL 16 — ALTER TABLE',
    },
    { note: 'The backfill runs in batches of 10,000 rows to avoid holding one long transaction over 1.2M rows.' },
  ],
  cost: {
    usd: 0.4127,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.3312, 'openai/gpt-5.2-mini': 0.0815 },
    tokens: { input: 184_220, output: 12_894, total: 197_114 },
  },
});

/* ========================================================================== */
/* 2. The refusal everyone remembers: a rollback that nearly worked            */
/* ========================================================================== */

const currencyFix = dossier({
  dossier_id: 'dos_currency_fix',
  change_class: 'DATA_OPERATION',
  request:
    'Every EU invoice created before 2026-01-01 was stored in USD instead of EUR. Correct them, and show me exactly which rows you would touch before you touch any of them.',
  requested_by: 'marco.b@airlock.dev',
  created_at: '2026-08-24T08:40:00Z',
  target: { project_ref: 'airlock-demo', branch_ref: 'br_shadow_9c30d', systems: ['postgres', 'stripe'] },
  magnitude: { records: 1_200_000, people: 0, amount_minor: 0, undo_window_seconds: null },
  forward: [
    {
      system: 'postgres',
      op: "UPDATE invoices\n   SET currency = 'EUR',\n       amount_minor = ROUND(amount_minor / rate.usd_per_eur)\n  FROM fx_rates rate\n WHERE invoices.region = 'EU'\n   AND invoices.created_at < '2026-01-01';",
      reversible: true,
      proven: true,
    },
  ],
  rollback: [
    {
      system: 'postgres',
      op: 'UPDATE invoices\n   SET currency = prev.currency,\n       amount_minor = prev.amount_minor\n  FROM invoices_backup_20260824 prev\n WHERE invoices.id = prev.id;',
      reversible: true,
      proven: true,
    },
  ],
  certificate: {
    kind: 'UNDO',
    status: 'FAILED',
    checksums: {
      pre: h('invoices@1200000rows@pre'),
      post: h('invoices@1200000rows@post'),
      post_rollback: h('invoices@1199998rows@post-rollback'),
      match: false,
    },
    lock_ms_estimate: 91_400,
    table_rewrite: true,
    sandbox_artifact_url: 'sandbox://verify/dos_currency_fix/diff.ndjson',
    failure_reason:
      'The rollback restored 1,199,998 of 1,200,000 rows.\n\nTwo invoices (id 88213, 88217) were written by a concurrent process between the forward operation and the rollback, so their pre-migration values were overwritten and could not be restored from invoices_backup_20260824.\n\nA rollback that mostly restores the data is a failed rollback. The gate stays sealed.',
    verified_at: '2026-08-24T08:59:02Z',
  },
  affected_tables: [
    { system: 'postgres', name: 'invoices', rows: 1_200_000, operation: 'update currency and amount' },
    { system: 'postgres', name: 'fx_rates', rows: 2_190, operation: 'read only (conversion source)' },
    { system: 'stripe', name: 'invoice', rows: 41_882, operation: 'read only (reconciliation)' },
  ],
  blast_radius: [
    { repo: 'airlock/app', file: 'src/billing/invoice.ts', line: 210, symbol: 'formatInvoiceTotal' },
    { repo: 'airlock/app', file: 'src/reports/revenue.sql', line: 14, symbol: 'monthly_revenue' },
  ],
  recommendation: 'BLOCK',
  risk_notes: [
    {
      note: 'The rewrite holds an ACCESS EXCLUSIVE lock for an estimated 91 seconds. Every query against invoices queues behind it for the duration.',
      source_url: 'https://www.postgresql.org/docs/16/explicit-locking.html',
      source_title: 'PostgreSQL 16 — Explicit Locking',
    },
    {
      note: 'Two rows changed underneath the verification run, which is itself the finding: this table is written to continuously and cannot be corrected with a single statement.',
    },
  ],
  cost: {
    usd: 0.8814,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.7702, 'openai/gpt-5.2-mini': 0.1112 },
    tokens: { input: 402_118, output: 21_005, total: 423_123 },
  },
});

/* ========================================================================== */
/* 3. An erasure, one signature short of moving                                */
/* ========================================================================== */

const erasure = dossier({
  dossier_id: 'dos_erasure_dana',
  change_class: 'ERASURE',
  request:
    'We received a right-to-erasure request for the user with email dana.reyes@example.com. Remove them from every system we hold them in, and tell me exactly what you will destroy and what you will keep.',
  requested_by: 'legal@airlock.dev',
  created_at: '2026-08-24T07:15:00Z',
  target: { project_ref: 'airlock-demo', branch_ref: 'br_shadow_1188e', systems: ['postgres', 'stripe', 'slack', 'object_storage'] },
  magnitude: { records: 41, people: 1, amount_minor: 0, undo_window_seconds: null },
  forward: [
    { system: 'postgres', op: 'DELETE FROM sessions WHERE user_id = 8812;', reversible: false, proven: true },
    {
      system: 'postgres',
      op: "UPDATE users\n   SET email = 'erased+8812@invalid',\n       full_name = NULL,\n       phone = NULL\n WHERE id = 8812;",
      reversible: false,
      proven: true,
    },
    { system: 'stripe', op: 'customers.delete("cus_QK92mXvT")', reversible: false, proven: true },
    { system: 'object_storage', op: 'DELETE s3://airlock-uploads/u/8812/*  (14 objects)', reversible: false, proven: true },
    { system: 'slack', op: 'admin.users.session.reset + profile scrub for U04D2H1', reversible: false, proven: true },
  ],
  rollback: [],
  certificate: {
    kind: 'SCOPE',
    status: 'PROVEN',
    scope: {
      records: [
        { system: 'postgres', table: 'users', id: '8812', action: 'anonymize', count: 1 },
        { system: 'postgres', table: 'sessions', id: 'user_id=8812', action: 'delete', count: 6 },
        { system: 'postgres', table: 'audit_log', id: 'actor_id=8812', action: 'anonymize', count: 19 },
        { system: 'stripe', table: 'customer', id: 'cus_QK92mXvT', action: 'delete', count: 1 },
        { system: 'object_storage', table: 'airlock-uploads', id: 'u/8812/*', action: 'delete', count: 14 },
      ],
      exclusions: [
        {
          system: 'postgres',
          table: 'invoices',
          reason:
            'Seven-year statutory retention under UK VAT record-keeping rules. Personal fields are redacted in place; the financial record itself is retained and cannot lawfully be destroyed.',
          count: 12,
        },
        {
          system: 'postgres',
          table: 'fraud_signals',
          reason:
            'Retained under the legitimate-interest basis recorded in the DPIA. Erasing it would remove the evidence that a chargeback pattern was investigated.',
          count: 3,
        },
        {
          system: 'object_storage',
          table: 'airlock-backups',
          reason:
            'Immutable backup snapshots older than the request. These expire on their own 35-day schedule; forcing deletion would break the restore chain for every other customer.',
          count: 4,
        },
      ],
    },
    sandbox_artifact_url: 'sandbox://verify/dos_erasure_dana/scope.json',
    verified_at: '2026-08-24T07:41:55Z',
  },
  affected_tables: [
    { system: 'postgres', name: 'users', rows: 1, operation: 'anonymize in place' },
    { system: 'postgres', name: 'sessions', rows: 6, operation: 'delete' },
    { system: 'postgres', name: 'audit_log', rows: 19, operation: 'anonymize actor' },
  ],
  questions: [
    {
      asked:
        'Invoices for this user carry a seven-year statutory retention obligation. Redact the personal fields and keep the financial record, or destroy the invoices entirely?',
      options: ['Redact and retain (recommended — destroying them is unlawful)', 'Destroy entirely'],
      answered_by: 'legal@airlock.dev',
      answer: 'Redact and retain. Destroying them would breach the retention obligation.',
      at: '2026-08-24T07:38:12Z',
    },
  ],
  signatures: [
    {
      approver: 'sam.okafor@airlock.dev',
      at: '2026-08-24T07:52:00Z',
      decision: 'approved',
      reason: 'Scope matches the DSAR. Exclusions are the ones I would expect.',
      break_glass: false,
    },
  ],
  recommendation: 'APPLY',
  risk_notes: [
    {
      note: 'Article 17(3)(b) permits retention where processing is necessary for compliance with a legal obligation. The three exclusions each cite the obligation they rest on.',
      source_url: 'https://gdpr-info.eu/art-17-gdpr/',
      source_title: 'GDPR Article 17 — Right to erasure',
    },
  ],
  cost: {
    usd: 0.6402,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.5219, 'openai/gpt-5.2-mini': 0.1183 },
    tokens: { input: 291_004, output: 18_770, total: 309_774 },
  },
});

/* ========================================================================== */
/* 4 & 5. Access: the same change, with and without an expiry                  */
/* ========================================================================== */

const accessScope = (expires) => ({
  kind: 'SCOPE',
  status: 'PROVEN',
  scope: {
    records: [
      { system: 'iam', table: 'role_binding', id: 'oncall@airlock.dev -> prod_reader', action: 'grant', count: 1 },
      { system: 'postgres', table: 'grants', id: 'prod_reader -> public.*', action: 'grant', count: 214 },
    ],
    exclusions: [
      {
        system: 'postgres',
        table: 'payment_methods',
        reason: 'Cardholder data is out of scope for the on-call role under PCI-DSS 7.2. The grant explicitly excludes it.',
        count: 1,
      },
      {
        system: 'iam',
        table: 'role_binding',
        reason: 'No write binding is created. The role is read-only, so the grant cannot be escalated by using it.',
        count: 0,
      },
    ],
  },
  sandbox_artifact_url: 'sandbox://verify/access/effective-permissions.json',
  verified_at: expires ? '2026-08-24T11:22:00Z' : '2026-08-24T11:40:00Z',
});

const accessBounded = dossier({
  dossier_id: 'dos_access_oncall',
  change_class: 'ACCESS_GRANT',
  request:
    'Give the on-call engineer read access to the production database for the length of this incident so they can diagnose the checkout failures.',
  requested_by: 'ops@airlock.dev',
  created_at: '2026-08-24T11:18:00Z',
  target: { project_ref: 'airlock-demo', systems: ['iam', 'postgres'] },
  magnitude: { records: 215, people: 1, amount_minor: 0, undo_window_seconds: 0 },
  principals: [
    {
      subject: 'oncall@airlock.dev',
      grants: ['iam:role/prod_reader', 'postgres:SELECT ON ALL TABLES IN SCHEMA public'],
      scope: 'airlock-production',
      expires_at: '2026-08-24T15:18:00Z',
      unlocks: [
        'Reading every row of customer data in public.*, including email addresses and order history',
        'Reading query plans and pg_stat_activity, which is the point of the grant',
      ],
    },
  ],
  forward: [
    { system: 'iam', op: 'aws iam attach-role-policy --role-name oncall --policy-arn arn:aws:iam::…:policy/prod_reader', reversible: true, proven: true },
    { system: 'postgres', op: 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO prod_reader;', reversible: true, proven: true },
  ],
  rollback: [
    { system: 'postgres', op: 'REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM prod_reader;', reversible: true, proven: true },
    { system: 'iam', op: 'aws iam detach-role-policy --role-name oncall --policy-arn arn:aws:iam::…:policy/prod_reader', reversible: true, proven: true },
  ],
  certificate: accessScope(true),
  affected_tables: [{ system: 'postgres', name: 'public.* (214 tables)', rows: 214, operation: 'grant SELECT' }],
  recommendation: 'APPLY',
  risk_notes: [
    {
      note: 'The grant expires four hours after it is applied. AIRLOCK schedules the revoke as part of applying it, so nobody has to remember.',
    },
    {
      note: 'Effective permissions were computed against a shadow IAM account rather than read from the policy document, because a policy document and an effective permission are famously not the same thing.',
    },
  ],
  cost: {
    usd: 0.2216,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.1801, 'openai/gpt-5.2-mini': 0.0415 },
    tokens: { input: 96_400, output: 7_220, total: 103_620 },
  },
});

const accessStanding = dossier({
  dossier_id: 'dos_access_standing',
  change_class: 'ACCESS_GRANT',
  request:
    'The analytics service account needs permanent read access to production so the nightly export stops failing.',
  requested_by: 'data@airlock.dev',
  created_at: '2026-08-24T11:36:00Z',
  target: { project_ref: 'airlock-demo', systems: ['iam', 'postgres'] },
  magnitude: { records: 215, people: 0, amount_minor: 0, undo_window_seconds: 0 },
  principals: [
    {
      subject: 'svc-analytics@airlock.dev',
      grants: ['iam:role/prod_reader', 'postgres:SELECT ON ALL TABLES IN SCHEMA public'],
      scope: 'airlock-production',
      expires_at: null,
      unlocks: [
        'Reading every row of customer data in public.*, indefinitely, with no scheduled review',
        'Surviving the departure of everyone who remembers why it was granted',
      ],
    },
  ],
  forward: [
    { system: 'postgres', op: 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO svc_analytics;', reversible: true, proven: true },
  ],
  rollback: [
    { system: 'postgres', op: 'REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM svc_analytics;', reversible: true, proven: true },
  ],
  certificate: accessScope(false),
  affected_tables: [{ system: 'postgres', name: 'public.* (214 tables)', rows: 214, operation: 'grant SELECT' }],
  recommendation: 'EXPAND_CONTRACT',
  risk_notes: [
    {
      note: 'The certificate is fine. The change is not. Nothing about this grant is unproven — policy simply does not permit access that never expires, so the gate never opens however good the proof is.',
    },
    {
      note: 'The workable version of this request is a grant that expires nightly and is re-issued by the scheduled export itself, which AIRLOCK can open as a change on its own.',
    },
  ],
  cost: {
    usd: 0.1904,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.1502, 'openai/gpt-5.2-mini': 0.0402 },
    tokens: { input: 81_200, output: 5_940, total: 87_140 },
  },
});

/* ========================================================================== */
/* 6. Money over the ceiling                                                   */
/* ========================================================================== */

const refund = dossier({
  dossier_id: 'dos_refund_stripe',
  change_class: 'MONEY_MOVEMENT',
  request:
    'The 14 August pricing bug double-charged term subscribers. Refund the duplicate charge to everyone affected.',
  requested_by: 'support@airlock.dev',
  created_at: '2026-08-24T10:04:00Z',
  target: { project_ref: 'airlock-demo', systems: ['stripe', 'postgres'] },
  magnitude: { records: 1_046, people: 1_046, amount_minor: 4_190_400, currency: 'GBP', undo_window_seconds: null },
  principals: [],
  forward: [
    { system: 'stripe', op: 'refunds.create({ charge, amount }) × 1046  — total GBP 41,904.00', reversible: false, proven: true },
    { system: 'postgres', op: "UPDATE invoices SET status = 'refunded' WHERE id = ANY($1);", reversible: true, proven: true },
  ],
  rollback: [],
  certificate: {
    kind: 'SCOPE',
    status: 'PROVEN',
    scope: {
      records: [
        { system: 'stripe', table: 'charge', id: '1,046 duplicate charges from 2026-08-14', action: 'transfer', count: 1_046 },
        { system: 'postgres', table: 'invoices', id: 'status -> refunded', action: 'update', count: 1_046 },
      ],
      exclusions: [
        {
          system: 'stripe',
          table: 'charge',
          reason:
            'Eleven charges from the same window were already refunded manually by support on 15 August. Refunding them again would send money twice.',
          count: 11,
        },
        {
          system: 'stripe',
          table: 'charge',
          reason:
            'Four charges are under dispute. A refund on a disputed charge forfeits the dispute and the fee, so these are left for the chargeback process.',
          count: 4,
        },
      ],
    },
    sandbox_artifact_url: 'sandbox://verify/dos_refund_stripe/charges.ndjson',
    verified_at: '2026-08-24T10:26:41Z',
  },
  affected_tables: [
    { system: 'stripe', name: 'charge', rows: 1_046, operation: 'refund' },
    { system: 'postgres', name: 'invoices', rows: 1_046, operation: 'mark refunded' },
  ],
  recommendation: 'BLOCK',
  risk_notes: [
    {
      note: 'A refund cannot be recalled. There is no undo certificate for money that has left, so the proof offered is a scope certificate: exactly these 1,046 charges, and explicitly not the 15 that would have gone out twice.',
    },
    {
      note: 'GBP 41,904 is above the GBP 25,000 ceiling AIRLOCK is authorised to move. The correct outcome is that a human treasury process handles it, and that this dossier is what they read.',
    },
  ],
  cost: {
    usd: 0.5511,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.4402, 'openai/gpt-5.2-mini': 0.1109 },
    tokens: { input: 220_140, output: 14_002, total: 234_142 },
  },
});

/* ========================================================================== */
/* 7. A comms blast over the people ceiling                                    */
/* ========================================================================== */

const incidentEmail = dossier({
  dossier_id: 'dos_incident_email',
  change_class: 'COMMS_BLAST',
  request:
    'Email every customer who was affected by the 14 August pricing bug to tell them about the refund before they see it on their statement.',
  requested_by: 'comms@airlock.dev',
  created_at: '2026-08-24T10:40:00Z',
  target: { project_ref: 'airlock-demo', systems: ['email', 'postgres'] },
  magnitude: { records: 61_400, people: 61_400, amount_minor: 0, undo_window_seconds: null },
  forward: [
    { system: 'email', op: 'sendgrid.send(template=pricing-incident-2026-08, recipients=61,400)', reversible: false, proven: true },
  ],
  rollback: [],
  certificate: {
    kind: 'SCOPE',
    status: 'PROVEN',
    scope: {
      records: [
        { system: 'email', table: 'recipients', id: 'affected customers, deduplicated by person', action: 'send', count: 61_400 },
      ],
      exclusions: [
        {
          system: 'email',
          table: 'suppression_list',
          reason: 'Unsubscribed from all non-transactional mail. Sending anyway would be both unlawful and the reason they unsubscribed.',
          count: 3_902,
        },
        {
          system: 'email',
          table: 'recipients',
          reason: 'Bounced hard in the last 30 days. Sending to them damages the sending domain reputation for everybody else.',
          count: 811,
        },
        {
          system: 'postgres',
          table: 'users',
          reason: 'Erased under a right-to-erasure request. There is no lawful address to send to and no person to send it about.',
          count: 6,
        },
      ],
    },
    sandbox_artifact_url: 'sandbox://verify/dos_incident_email/audience.ndjson',
    verified_at: '2026-08-24T10:58:20Z',
  },
  affected_tables: [{ system: 'postgres', name: 'users', rows: 61_400, operation: 'read only (audience)' }],
  recommendation: 'BLOCK',
  risk_notes: [
    {
      note: 'There is no unsend. The scope certificate is the only kind of proof available, and the exclusion list is the part that matters: 4,719 people are deliberately not being written to, each for a stated reason.',
    },
    {
      note: '61,400 people is above the 50,000 ceiling for a single automated send. Splitting it does not evade the ceiling — the magnitude counts people, not batches.',
    },
  ],
  cost: {
    usd: 0.3308,
    by_model: { 'anthropic/claude-sonnet-4-6': 0.2604, 'openai/gpt-5.2-mini': 0.0704 },
    tokens: { input: 142_800, output: 9_110, total: 151_910 },
  },
});

/* ========================================================================== */
/* 8. Proven, permitted — and out of date                                      */
/* ========================================================================== */

const scaledownPre = h('replica-topology@3-nodes@pre');

const scaledown = dossier({
  dossier_id: 'dos_replica_scaledown',
  change_class: 'INFRA_MUTATION',
  request: 'Scale the read replica pool from three nodes down to one now that the migration backfill has finished.',
  requested_by: 'platform@airlock.dev',
  created_at: '2026-08-24T06:30:00Z',
  target: { project_ref: 'airlock-demo', branch_ref: 'br_shadow_77a10', systems: ['kubernetes', 'postgres'] },
  magnitude: { records: 2, people: 0, amount_minor: 0, undo_window_seconds: 900 },
  forward: [
    { system: 'kubernetes', op: 'kubectl scale statefulset/pg-replica --replicas=1', reversible: true, proven: true },
  ],
  rollback: [
    { system: 'kubernetes', op: 'kubectl scale statefulset/pg-replica --replicas=3', reversible: true, proven: true },
  ],
  certificate: {
    kind: 'UNDO',
    status: 'PROVEN',
    checksums: {
      pre: scaledownPre,
      post: h('replica-topology@1-node@post'),
      post_rollback: scaledownPre,
      match: true,
    },
    lock_ms_estimate: 0,
    table_rewrite: false,
    sandbox_artifact_url: 'sandbox://verify/dos_replica_scaledown/topology.json',
    verified_at: '2026-08-24T06:44:10Z',
  },
  drift: {
    checked_at: '2026-08-24T11:02:00Z',
    production_checksum: h('replica-topology@4-nodes@autoscaled'),
    drifted: false,
  },
  affected_tables: [{ system: 'kubernetes', name: 'statefulset/pg-replica', rows: 3, operation: 'scale to 1' }],
  recommendation: 'BLOCK',
  risk_notes: [
    {
      note: 'The proof is genuine and the rollback is genuinely proven. It was taken against a three-node pool, and the pool autoscaled to four while this change was queued — so the plan would now remove three nodes rather than two.',
    },
    {
      note: 'The drift checker reported drifted:false. AIRLOCK compared the digests itself and disagreed. A claim of safety is never taken on trust.',
    },
  ],
  cost: {
    usd: 0.1102,
    by_model: { 'openai/gpt-5.2-mini': 0.1102 },
    tokens: { input: 48_200, output: 3_100, total: 51_300 },
  },
});

/* ========================================================================== */
/* 9-11. History: three decided changes, sealed into the ledger chain          */
/* ========================================================================== */

const indexPre = h('orders@842119rows@pre-index');

const indexApplied = dossier({
  dossier_id: 'dos_orders_index',
  change_class: 'SCHEMA_MIGRATION',
  request: 'Add a concurrent index on orders(customer_id, created_at) so the dashboard query stops sequential-scanning.',
  requested_by: 'priya.n@airlock.dev',
  started_by: 'webhook',
  created_at: '2026-08-21T09:00:00Z',
  target: { project_ref: 'airlock-demo', branch_ref: 'br_shadow_2ab41', systems: ['postgres'] },
  magnitude: { records: 842_119, people: 0, amount_minor: 0, undo_window_seconds: 604800 },
  forward: [
    { system: 'postgres', op: 'CREATE INDEX CONCURRENTLY idx_orders_customer_created\n    ON orders (customer_id, created_at);', reversible: true, proven: true },
  ],
  rollback: [{ system: 'postgres', op: 'DROP INDEX CONCURRENTLY idx_orders_customer_created;', reversible: true, proven: true }],
  certificate: {
    kind: 'UNDO',
    status: 'PROVEN',
    checksums: { pre: indexPre, post: h('orders@842119rows@post-index'), post_rollback: indexPre, match: true },
    lock_ms_estimate: 120,
    table_rewrite: false,
    verified_at: '2026-08-21T09:12:00Z',
  },
  affected_tables: [{ system: 'postgres', name: 'orders', rows: 842_119, operation: 'create index concurrently' }],
  recommendation: 'APPLY',
  signatures: [
    { approver: 'sam.okafor@airlock.dev', at: '2026-08-21T09:20:00Z', decision: 'approved', reason: null, break_glass: false },
  ],
  approval: {
    approver: 'sam.okafor@airlock.dev',
    at: '2026-08-21T09:20:00Z',
    role_required: 'approver',
    decision: 'approved',
    reason: null,
  },
  audit: { applied_at: '2026-08-21T09:20:40Z', post_apply_checksum: null, applied_by: 'sam.okafor@airlock.dev' },
  cost: { usd: 0.1901, by_model: { 'anthropic/claude-sonnet-4-6': 0.1901 }, tokens: { input: 74_200, output: 4_010, total: 78_210 } },
});

const gdprApplied = dossier({
  dossier_id: 'dos_gdpr_batch',
  change_class: 'ERASURE',
  request: 'Process the four right-to-erasure requests that came in during the week of 10 August.',
  requested_by: 'legal@airlock.dev',
  created_at: '2026-08-22T13:00:00Z',
  target: { project_ref: 'airlock-demo', branch_ref: 'br_shadow_5f0c2', systems: ['postgres', 'stripe', 'object_storage'] },
  magnitude: { records: 168, people: 4, amount_minor: 0, undo_window_seconds: null },
  forward: [{ system: 'postgres', op: 'anonymize 4 subjects across 12 tables', reversible: false, proven: true }],
  rollback: [],
  certificate: {
    kind: 'SCOPE',
    status: 'PROVEN',
    scope: {
      records: [{ system: 'postgres', table: 'users', id: '4 subjects', action: 'anonymize', count: 168 }],
      exclusions: [
        { system: 'postgres', table: 'invoices', reason: 'Seven-year statutory retention. Personal fields redacted in place.', count: 47 },
      ],
    },
    verified_at: '2026-08-22T13:26:00Z',
  },
  affected_tables: [{ system: 'postgres', name: '12 tables', rows: 168, operation: 'anonymize' }],
  recommendation: 'APPLY',
  signatures: [
    { approver: 'sam.okafor@airlock.dev', at: '2026-08-22T13:40:00Z', decision: 'approved', reason: 'Scope checked against all four DSARs.', break_glass: false },
    { approver: 'priya.n@airlock.dev', at: '2026-08-22T14:02:00Z', decision: 'approved', reason: 'Countersigned. Exclusions are correct.', break_glass: false },
  ],
  approval: {
    approver: 'priya.n@airlock.dev',
    at: '2026-08-22T14:02:00Z',
    role_required: 'approver',
    decision: 'approved',
    reason: 'Countersigned. Exclusions are correct.',
  },
  audit: { applied_at: '2026-08-22T14:02:30Z', post_apply_checksum: null, applied_by: 'priya.n@airlock.dev' },
  cost: { usd: 0.7714, by_model: { 'anthropic/claude-sonnet-4-6': 0.6602, 'openai/gpt-5.2-mini': 0.1112 }, tokens: { input: 318_400, output: 20_110, total: 338_510 } },
});

const bucketRejected = dossier({
  dossier_id: 'dos_bucket_delete',
  change_class: 'INFRA_MUTATION',
  request: 'Delete the airlock-uploads-legacy bucket. Nothing has read from it since May.',
  requested_by: 'platform@airlock.dev',
  created_at: '2026-08-23T15:20:00Z',
  target: { project_ref: 'airlock-demo', systems: ['object_storage'] },
  magnitude: { records: 2_204_118, people: 0, amount_minor: 0, undo_window_seconds: null },
  forward: [{ system: 'object_storage', op: 'aws s3 rb s3://airlock-uploads-legacy --force  (2,204,118 objects)', reversible: false, proven: true }],
  rollback: [],
  certificate: {
    kind: 'SCOPE',
    status: 'PROVEN',
    scope: {
      records: [{ system: 'object_storage', table: 'airlock-uploads-legacy', id: '**/*', action: 'delete', count: 2_204_118 }],
      exclusions: [],
    },
    verified_at: '2026-08-23T15:44:00Z',
  },
  affected_tables: [{ system: 'object_storage', name: 'airlock-uploads-legacy', rows: 2_204_118, operation: 'delete bucket' }],
  recommendation: 'BLOCK',
  risk_notes: [
    {
      note: 'The scope is correct and the claim that nothing reads from it is correct. What the blast-radius scan found is that 11,908 of those objects are still referenced by rows in attachments, so the objects are unread because the feature that reads them is broken, not because they are unused.',
    },
  ],
  blast_radius: [
    { repo: 'airlock/app', file: 'src/attachments/resolve.ts', line: 66, symbol: 'legacyBucketFallback' },
    { repo: 'airlock/app', file: 'src/attachments/resolve.ts', line: 91, symbol: 'signLegacyUrl' },
  ],
  signatures: [
    {
      approver: 'sam.okafor@airlock.dev',
      at: '2026-08-23T16:10:00Z',
      decision: 'rejected',
      reason: '11,908 attachments still point at this bucket. Fix the resolver first, then re-open this change.',
      break_glass: false,
    },
  ],
  approval: {
    approver: 'sam.okafor@airlock.dev',
    at: '2026-08-23T16:10:00Z',
    role_required: 'approver',
    decision: 'rejected',
    reason: '11,908 attachments still point at this bucket. Fix the resolver first, then re-open this change.',
  },
  cost: { usd: 0.2402, by_model: { 'openai/gpt-5.2-mini': 0.2402 }, tokens: { input: 102_400, output: 6_220, total: 108_620 } },
});

/* ========================================================================== */
/* Seal the decided records into a hash chain, then write everything out       */
/* ========================================================================== */

const { canonicalJson, GENESIS_HASH } = await import('../../packages/contract/dist/receipt.js');

/** Recomputed exactly as receipt.ts does it, so the fixtures verify at runtime. */
function bodyOf(d) {
  return {
    dossier_id: d.dossier_id,
    change_class: d.change_class,
    request: d.request,
    requested_by: d.requested_by,
    created_at: d.created_at,
    certificate: d.certificate ?? null,
    magnitude: d.magnitude,
    principals: d.principals,
    forward: d.forward,
    rollback: d.rollback,
    signatures: d.signatures,
    approval: d.approval,
    audit: d.audit,
  };
}

/** History, in the order it happened. The chain commits to that order. */
const history = [indexApplied, gdprApplied, bucketRejected];

let prev = GENESIS_HASH;
history.forEach((d, seq) => {
  const hash = h(canonicalJson({ seq, prev, body: bodyOf(d) })).slice('sha256:'.length);
  d.receipt = {
    seq,
    prev_hash: prev,
    hash: `sha256:${hash}`,
    sealed_at: d.approval.at,
  };
  prev = d.receipt.hash;
});

const files = [
  ['schema-migration.proven.json', tierMigration],
  ['data-operation.failed.json', currencyFix],
  ['erasure.scope.json', erasure],
  ['access-grant.expiring.json', accessBounded],
  ['access-grant.standing.json', accessStanding],
  ['money-movement.ceiling.json', refund],
  ['comms-blast.quiet-hours.json', incidentEmail],
  ['infra-mutation.drifted.json', scaledown],
  ['history.schema-migration.applied.json', indexApplied],
  ['history.erasure.applied.json', gdprApplied],
  ['history.infra-mutation.rejected.json', bucketRejected],
];

for (const [name, value] of files) {
  writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', 'utf8');
}

console.log(`wrote ${files.length} fixtures`);
console.log(`ledger head: ${prev}`);

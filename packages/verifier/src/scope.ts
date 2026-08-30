import type { AffectedTable, Operation, ScopeExclusion, ScopeRecord, SystemName } from '@airlock/contract';

export interface ErasureScopeUser {
  id: string | number;
  email: string;
  stripe_customer_id: string;
  slack_user_id: string;
  upload_prefix: string;
}

export interface ErasureScopeCounts {
  sessions: number;
  auditRows: number;
  retainedInvoices: number;
  uploads: number;
}

export interface ErasureScopeDetailRow {
  system: SystemName;
  table: string;
  id: string;
  action: 'delete' | 'anonymize' | 'retain';
  [key: string]: unknown;
}

export interface ErasureScopePlan {
  records: ScopeRecord[];
  exclusions: ScopeExclusion[];
  forward: Operation[];
  affected_tables: AffectedTable[];
  target_systems: SystemName[];
  record_count: number;
}

export interface BuildErasureScopeInput {
  user: ErasureScopeUser;
  counts: ErasureScopeCounts;
}

export function buildErasureScopePlan(input: BuildErasureScopeInput): ErasureScopePlan {
  const userId = String(input.user.id);
  const recordCandidates: ScopeRecord[] = [
    { system: 'postgres', table: 'users', id: userId, action: 'anonymize', count: 1 },
    { system: 'postgres', table: 'sessions', id: `user_id=${userId}`, action: 'delete', count: input.counts.sessions },
    {
      system: 'postgres',
      table: 'audit_log',
      id: `actor_user_id=${userId}`,
      action: 'anonymize',
      count: input.counts.auditRows,
    },
    { system: 'stripe', table: 'customer', id: String(input.user.stripe_customer_id), action: 'delete', count: 1 },
    { system: 'slack', table: 'user', id: String(input.user.slack_user_id), action: 'anonymize', count: 1 },
    {
      system: 'object_storage',
      table: 'airlock-uploads',
      id: `${input.user.upload_prefix}*`,
      action: 'delete',
      count: input.counts.uploads,
    },
  ];
  const records = recordCandidates.filter((record) => record.count > 0);

  const exclusionCandidates: ScopeExclusion[] = [
    {
      system: 'postgres',
      table: 'invoices',
      reason: 'Seven-year statutory retention. Personal fields must be redacted separately, but invoice rows are not deleted.',
      count: input.counts.retainedInvoices,
    },
  ];
  const exclusions = exclusionCandidates.filter((record) => record.count > 0);

  const recordCount =
    records.reduce((sum, record) => sum + record.count, 0) +
    exclusions.reduce((sum, record) => sum + record.count, 0);

  return {
    records,
    exclusions,
    forward: [
      { system: 'postgres', op: `anonymize users.id=${userId}`, reversible: false, proven: true },
      { system: 'postgres', op: `DELETE FROM sessions WHERE user_id = ${userId};`, reversible: false, proven: true },
      { system: 'postgres', op: `anonymize audit_log.actor_user_id=${userId}`, reversible: false, proven: true },
      { system: 'stripe', op: `customers.delete("${input.user.stripe_customer_id}")`, reversible: false, proven: true },
      {
        system: 'slack',
        op: `admin.users.session.reset + profile scrub for ${input.user.slack_user_id}`,
        reversible: false,
        proven: true,
      },
      {
        system: 'object_storage',
        op: `DELETE airlock-uploads/${input.user.upload_prefix}*`,
        reversible: false,
        proven: true,
      },
    ],
    affected_tables: [
      { system: 'postgres', name: 'users', rows: 1, operation: 'anonymize in place' },
      { system: 'postgres', name: 'sessions', rows: input.counts.sessions, operation: 'delete' },
      { system: 'postgres', name: 'audit_log', rows: input.counts.auditRows, operation: 'anonymize actor' },
      {
        system: 'postgres',
        name: 'invoices',
        rows: input.counts.retainedInvoices,
        operation: 'excluded by retention policy',
      },
      { system: 'object_storage', name: 'airlock-uploads', rows: input.counts.uploads, operation: 'delete objects' },
    ],
    target_systems: ['postgres', 'stripe', 'slack', 'object_storage'],
    record_count: recordCount,
  };
}

export function postgresErasureScopeSql(userId: string | number): string {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Erasure user id must be a positive integer.');

  return `
with target_user as (
  select id, email, stripe_customer_id, slack_user_id, upload_prefix
    from public.users
   where id = ${id}
),
scope_rows as (
  select 'postgres' as system, 'users' as table_name, id::text as id, 'anonymize' as action,
         jsonb_build_object('email', email) as payload
    from target_user
  union all
  select 'postgres', 'sessions', s.id::text, 'delete',
         jsonb_build_object('token_hash', s.token_hash)
    from public.sessions s join target_user u on u.id = s.user_id
  union all
  select 'postgres', 'audit_log', a.id::text, 'anonymize',
         jsonb_build_object('event', a.action, 'created_at', a.created_at)
    from public.audit_log a join target_user u on u.id = a.actor_user_id
  union all
  select 'postgres', 'invoices', i.id::text, 'retain',
         jsonb_build_object(
           'reason', 'Seven-year statutory retention',
           'amount_minor', i.amount_minor,
           'currency', i.currency,
           'retained_until', i.retained_until
         )
    from public.invoices i join target_user u on u.id = i.user_id
  union all
  select 'stripe', 'customer', stripe_customer_id, 'delete', '{}'::jsonb
    from target_user
  union all
  select 'slack', 'user', slack_user_id, 'anonymize', '{}'::jsonb
    from target_user
  union all
  select 'object_storage', 'airlock-uploads', up.id::text, 'delete',
         jsonb_build_object('object_key', up.object_key)
    from public.user_uploads up join target_user u on u.id = up.user_id
)
select system, table_name, id, action, payload
  from scope_rows
 order by system, table_name, id`;
}

export function summariseErasureScopeRows(rows: ErasureScopeDetailRow[]): {
  records: ScopeRecord[];
  exclusions: ScopeExclusion[];
  record_count: number;
} {
  const count = (system: SystemName, table: string, action: ErasureScopeDetailRow['action']) =>
    rows.filter((row) => row.system === system && row.table === table && row.action === action).length;
  const ids = (system: SystemName, table: string, action: ErasureScopeDetailRow['action']) =>
    rows.filter((row) => row.system === system && row.table === table && row.action === action).map((row) => row.id);

  const userIds = ids('postgres', 'users', 'anonymize');
  const stripeIds = ids('stripe', 'customer', 'delete');
  const slackIds = ids('slack', 'user', 'anonymize');
  const uploadRows = rows.filter((row) => row.system === 'object_storage' && row.table === 'airlock-uploads');

  const recordCandidates: ScopeRecord[] = [
    ...userIds.map((id) => ({ system: 'postgres' as const, table: 'users', id, action: 'anonymize' as const, count: 1 })),
    {
      system: 'postgres',
      table: 'sessions',
      id: userIds[0] ? `user_id=${userIds[0]}` : 'user_id=unknown',
      action: 'delete',
      count: count('postgres', 'sessions', 'delete'),
    },
    {
      system: 'postgres',
      table: 'audit_log',
      id: userIds[0] ? `actor_user_id=${userIds[0]}` : 'actor_user_id=unknown',
      action: 'anonymize',
      count: count('postgres', 'audit_log', 'anonymize'),
    },
    ...stripeIds.map((id) => ({ system: 'stripe' as const, table: 'customer', id, action: 'delete' as const, count: 1 })),
    ...slackIds.map((id) => ({ system: 'slack' as const, table: 'user', id, action: 'anonymize' as const, count: 1 })),
    {
      system: 'object_storage',
      table: 'airlock-uploads',
      id: uploadRows.length === 1 ? uploadRows[0]!.id : 'matched-objects',
      action: 'delete',
      count: uploadRows.length,
    },
  ];
  const records = recordCandidates.filter((record) => record.count > 0);

  const exclusionCandidates: ScopeExclusion[] = [
    {
      system: 'postgres',
      table: 'invoices',
      reason: 'Seven-year statutory retention. Personal fields must be redacted separately, but invoice rows are not deleted.',
      count: count('postgres', 'invoices', 'retain'),
    },
  ];
  const exclusions = exclusionCandidates.filter((record) => record.count > 0);

  return {
    records,
    exclusions,
    record_count:
      records.reduce((sum, record) => sum + record.count, 0) +
      exclusions.reduce((sum, record) => sum + record.count, 0),
  };
}

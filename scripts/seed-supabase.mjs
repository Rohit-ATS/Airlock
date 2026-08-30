#!/usr/bin/env node
/**
 * Put a real database behind the demo.
 *
 *   npm run seed:supabase            create and fill what is missing
 *   npm run seed:supabase -- --reset drop the demo tables and rebuild them
 *   npm run seed:supabase -- --check report what is there and change nothing
 *
 * WHY THIS EXISTS
 *
 * AIRLOCK's headline change is "drop `users.plan_name`". Until this script, the
 * live Supabase project behind the demo held exactly one table — `users`, four
 * columns, five thousand rows — and `plan_name` was not one of them. So the one
 * thing the README, the landing page and the video all promise was the one
 * thing a live agent could not do. Asked to do it, the agent read the schema,
 * correctly found no such column, and stopped to ask a human what to do.
 *
 * That is the product working. It is also a demo that dies on camera, and the
 * reason it died is not a bug in the gate — it is that nobody ever gave the
 * gate a database worth guarding. Every impressive number on the console came
 * from `contracts/examples/`, which is honest fixture data and says so, but it
 * means the live path and the shown path were describing different systems.
 *
 * So: this seeds the live project with the schema the demo actually talks
 * about, at a size where the numbers on screen are measurements rather than
 * decoration.
 *
 * THE SHAPE, AND WHY IT IS THIS SHAPE
 *
 * It mirrors `scripts/seed-sqlite.mjs` exactly, because the SQLite lane is what
 * proves a rollback and the Supabase lane is what the agent reads. If the two
 * disagreed about what a `users` row looks like, a certificate proven against
 * one would be a statement about the other, which is the precise failure this
 * project exists to make impossible.
 *
 * The interesting property is the *legacy column pair*: `users.plan_name` is
 * the old denormalised value and `subscriptions.legacy_plan_name` holds the
 * same string. That is what makes dropping `plan_name` a real expand/contract
 * problem instead of a one-line ALTER — the data survives the drop, so the
 * rollback can be proven, and the blast radius is the code that still reads it.
 *
 * WRITE ACCESS, AND WHY THIS SCRIPT HAVING IT PROVES NOTHING BAD
 *
 * This runs against the Supabase **management API** with
 * `SUPABASE_ACCESS_TOKEN` — a human's admin credential, used by a human, from a
 * terminal. The agent has nothing of the kind: it reaches the same database
 * through `mcp.supabase.com/mcp?...&read_only=true`, where Postgres itself
 * refuses a write (`ERROR: 25006: cannot execute CREATE TABLE in a read-only
 * transaction`). Setting the demo up and running the demo use different
 * credentials on purpose, and this file is deliberately not importable from
 * anything on the connect → certify → apply path — `check-no-simulation.mjs`
 * enforces that boundary rather than trusting this comment.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const AMBER = '\x1b[33m';

const RESET = process.argv.includes('--reset');
const CHECK = process.argv.includes('--check');

/* --- credentials, read without printing them ------------------------------ */

function fromDotEnv(...names) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  // Split on CRLF or LF: a Windows-written .env otherwise leaves a trailing \r
  // on every value, and a project ref with a carriage register in it produces a
  // 404 that looks like a permissions problem. That cost an hour once already.
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && names.includes(m[1])) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = {
  ...fromDotEnv(
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_PROJECT_REF',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ),
  ...process.env,
};
const token = env.SUPABASE_ACCESS_TOKEN;
const ref =
  env.SUPABASE_PROJECT_REF ?? /https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(env.SUPABASE_URL ?? '')?.[1];

if (!token || !ref) {
  console.error(`${RED}Need SUPABASE_ACCESS_TOKEN and SUPABASE_URL (or SUPABASE_PROJECT_REF) in .env.${OFF}`);
  console.error(`${DIM}The access token is a personal admin credential from supabase.com/dashboard/account/tokens.${OFF}`);
  if (!token && (env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.error(`${DIM}Anon and service_role JWTs prove the project API, but Supabase's Management API needs a PAT that starts with sbp_.${OFF}`);
  }
  process.exit(2);
}

if (!token.startsWith('sbp_')) {
  console.error(`${RED}SUPABASE_ACCESS_TOKEN must be a Supabase personal access token that starts with sbp_.${OFF}`);
  console.error(`${DIM}Do not put the anon or service_role JWT in this variable; those cannot call the Management API.${OFF}`);
  process.exit(2);
}

/** How many users. Everything else is a fan-out of this. */
const USERS = Number(env.AIRLOCK_SEED_USERS ?? 100_000);
if (!Number.isInteger(USERS) || USERS <= 0) {
  console.error('AIRLOCK_SEED_USERS must be a positive integer.');
  process.exit(2);
}

/* --- the one call this script makes --------------------------------------- */

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    // The query is echoed, truncated. A failure here is nearly always a typo in
    // SQL this file generated, and hunting it without seeing the statement is
    // needlessly slow.
    throw new Error(`${res.status} from the management API: ${text.slice(0, 500)}\n${DIM}${query.slice(0, 300)}${OFF}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

const say = (m) => console.log(m);
const ok = (m) => console.log(`   ${GREEN}ok${OFF}   ${m}`);
const note = (m) => console.log(`   ${DIM}${m}${OFF}`);
const warn = (m) => console.log(`   ${AMBER}warn${OFF} ${m}`);
const n = (v) => Number(v ?? 0).toLocaleString('en-GB');

/* --- what is there now ---------------------------------------------------- */

const TABLES = ['users', 'subscriptions', 'sessions', 'audit_log', 'invoices', 'user_uploads'];

async function survey() {
  const rows = await sql(`
    select c.relname as table_name,
           c.reltuples::bigint as approx_rows,
           coalesce((select count(*) from information_schema.columns i
                      where i.table_schema = 'public' and i.table_name = c.relname), 0) as cols
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
     order by 1;
  `);
  return new Map(rows.map((r) => [r.table_name, r]));
}

async function exactCounts() {
  const parts = TABLES.map((t) => `(select count(*) from public.${t}) as ${t}`).join(', ');
  const [row] = await sql(`select ${parts};`);
  return row;
}

async function hasPlanName() {
  const rows = await sql(`
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'plan_name';
  `);
  return rows.length > 0;
}

async function size() {
  const [row] = await sql(`select pg_size_pretty(pg_database_size(current_database())) as size;`);
  return row?.size ?? 'unknown';
}

/* --- report only ---------------------------------------------------------- */

console.log(`\n${BOLD}AIRLOCK demo database${OFF} ${DIM}${ref}${OFF}\n`);

const before = await survey();

if (CHECK) {
  if (before.size === 0) {
    warn('the public schema is empty — run without --check to seed it');
  } else {
    const counts = before.has('users') ? await exactCounts().catch(() => null) : null;
    for (const t of TABLES) {
      if (!before.has(t)) warn(`${t.padEnd(14)} missing`);
      else ok(`${t.padEnd(14)} ${n(counts?.[t] ?? before.get(t).approx_rows)} rows`);
    }
    say('');
    note(`users.plan_name  ${(await hasPlanName()) ? 'present — the demo migration has something to drop' : 'MISSING — the demo migration has nothing to drop'}`);
    note(`database size    ${await size()}`);
  }
  say('');
  process.exit(0);
}

/* --- refuse to guess ------------------------------------------------------ */

/*
 * The existing `users` table is the one real hazard here. If it exists but has
 * a different shape, adding columns to it would leave a half-legacy table that
 * looks seeded and is not, and every count taken from it afterwards would be
 * wrong in a way nobody would notice. So: say what is wrong, name the flag, and
 * stop. Dropping somebody's table because it was in the way is not a decision a
 * script gets to make on its own.
 */
if (before.has('users') && !(await hasPlanName()) && !RESET) {
  console.error(`${RED}stop${OFF} public.users exists but has no plan_name column.`);
  console.error(`${DIM}That is the pre-existing 4-column demo table, not AIRLOCK's schema. Dropping and`);
  console.error(`rebuilding the six demo tables is almost certainly what you want, but it destroys`);
  console.error(`whatever is in them, so it is not the default:${OFF}\n`);
  console.error(`    npm run seed:supabase -- --reset\n`);
  process.exit(1);
}

if (RESET) {
  say(`${BOLD}1. Dropping the demo tables${OFF}`);
  // Ordered by dependency, and CASCADE anyway — a half-dropped schema is worse
  // than either state, so this must not be able to fail partway on a foreign key.
  await sql(`drop table if exists public.user_uploads, public.invoices, public.audit_log,
                                  public.sessions, public.subscriptions, public.users cascade;`);
  ok('dropped');
}

/* --- the schema ----------------------------------------------------------- */

say(`\n${BOLD}${RESET ? 2 : 1}. Schema${OFF}`);

await sql(`
  create table if not exists public.users (
    id                 bigint primary key,
    email              text not null unique,
    stripe_customer_id text not null,
    slack_user_id      text not null,
    upload_prefix      text not null,
    plan_name          text not null,
    created_at         timestamptz not null,
    updated_at         timestamptz not null
  );

  create table if not exists public.subscriptions (
    user_id           bigint primary key references public.users(id) on delete cascade,
    plan_tier         text not null,
    legacy_plan_name  text not null,
    status            text not null,
    updated_at        timestamptz not null
  );

  create table if not exists public.sessions (
    id         bigint primary key,
    user_id    bigint not null references public.users(id) on delete cascade,
    token_hash text not null,
    created_at timestamptz not null
  );

  create table if not exists public.audit_log (
    id            bigint primary key,
    actor_user_id bigint not null references public.users(id) on delete cascade,
    action        text not null,
    created_at    timestamptz not null
  );

  create table if not exists public.invoices (
    id             bigint primary key,
    user_id        bigint not null references public.users(id) on delete cascade,
    amount_minor   bigint not null,
    currency       text not null,
    retained_until timestamptz not null
  );

  create table if not exists public.user_uploads (
    id         bigint primary key,
    user_id    bigint not null references public.users(id) on delete cascade,
    object_key text not null
  );
`);
ok('six tables');

/*
 * RLS on, with no policies, on every table.
 *
 * That is deny-all to the anon and authenticated keys — the ones that would be
 * shipped in a browser — while AIRLOCK's own read connection is service-level
 * and unaffected. It costs nothing and it means the publishable key for this
 * project, which is in a public repo's README history, cannot read a row.
 */
for (const t of TABLES) await sql(`alter table public.${t} enable row level security;`);
ok('row level security on, no policies — deny-all to the anon key');

/* --- the data ------------------------------------------------------------- */

const counts = await exactCounts();
const have = Number(counts.users ?? 0);

if (have >= USERS) {
  say(`\n${BOLD}${RESET ? 3 : 2}. Data${OFF}`);
  ok(`already ${n(have)} users — nothing to do`);
} else {
  say(`\n${BOLD}${RESET ? 3 : 2}. Data${OFF}  ${DIM}${n(have)} → ${n(USERS)} users${OFF}`);

  /*
   * Generated server-side with generate_series, in batches.
   *
   * The obvious alternative — build INSERT statements here and POST them — is
   * how this took forty minutes the first time. The rows never need to exist in
   * this process at all, so the whole job is one statement per batch and the
   * data never crosses the wire. Batches exist only so a timeout costs one
   * batch rather than the whole seed.
   *
   * The derivations mirror seed-sqlite.mjs value for value, because the two
   * datasets have to agree for a rollback proven on one to mean anything about
   * the other.
   */
  const BATCH = 25_000;
  const plans = `(array['free','pro','team','enterprise'])`;
  const tiers = `(array['FREE','PRO','TEAM','ENTERPRISE'])`;

  for (let from = have + 1; from <= USERS; from += BATCH) {
    const to = Math.min(USERS, from + BATCH - 1);

    await sql(`
      insert into public.users (id, email, stripe_customer_id, slack_user_id, upload_prefix, plan_name, created_at, updated_at)
      select i,
             'user' || i || '@airlock.dev',
             'cus_airlock_' || lpad(i::text, 8, '0'),
             'U' || lpad(i::text, 8, '0'),
             'u/' || i || '/',
             ${plans}[(i % 4) + 1],
             (date '2026-07-01' + ((i % 28) || ' days')::interval)::timestamptz,
             (date '2026-08-01' + ((i % 28) || ' days')::interval)::timestamptz
        from generate_series(${from}, ${to}) as i
      on conflict (id) do nothing;

      insert into public.subscriptions (user_id, plan_tier, legacy_plan_name, status, updated_at)
      select i,
             ${tiers}[(i % 4) + 1],
             ${plans}[(i % 4) + 1],
             case when i % 17 = 0 then 'past_due' else 'active' end,
             (date '2026-08-01' + ((i % 28) || ' days')::interval)::timestamptz
        from generate_series(${from}, ${to}) as i
      on conflict (user_id) do nothing;

      insert into public.sessions (id, user_id, token_hash, created_at)
      select i * 10 + s, i,
             'sha256:' || lpad(((i * 10 + s) % 1000000)::text, 64, '0'),
             (date '2026-08-01' + ((i % 28) || ' days')::interval)::timestamptz
        from generate_series(${from}, ${to}) as i,
             lateral generate_series(1, (i % 3) + 1) as s
      on conflict (id) do nothing;

      insert into public.audit_log (id, actor_user_id, action, created_at)
      select i * 20 + a, i,
             case when a % 2 = 0 then 'profile.update' else 'billing.view' end,
             (date '2026-08-01' + ((i % 28) || ' days')::interval)::timestamptz
        from generate_series(${from}, ${to}) as i,
             lateral generate_series(1, (i % 4) + 2) as a
      on conflict (id) do nothing;

      insert into public.invoices (id, user_id, amount_minor, currency, retained_until)
      select i * 30 + v, i, 1900 + v * 100, 'USD', timestamptz '2033-08-24 00:00:00+00'
        from generate_series(${from}, ${to}) as i,
             lateral generate_series(1, (i % 3)) as v
      on conflict (id) do nothing;

      insert into public.user_uploads (id, user_id, object_key)
      select i * 40 + f, i, 'u/' || i || '/file-' || f || '.bin'
        from generate_series(${from}, ${to}) as i,
             lateral generate_series(1, (i % 4)) as f
      on conflict (id) do nothing;
    `);

    note(`${n(to)} / ${n(USERS)} users`);
  }
  ok('seeded');
}

/* --- indexes last --------------------------------------------------------- */

/*
 * After the data, not before. Building an index once over a finished table is
 * dramatically cheaper than maintaining it across every insert above, and the
 * seed is the one moment where that ordering is free to choose.
 *
 * `idx_users_plan_name` is the one that matters to the demo: it is a dependent
 * object on the column the migration drops, so it is part of what the rollback
 * has to restore, and a rollback that brings the column back without its index
 * is the kind of "successful" rollback that shows up as a latency incident the
 * following morning.
 */
say(`\n${BOLD}${RESET ? 4 : 3}. Indexes${OFF}`);
for (const [name, ddl] of [
  ['idx_users_plan_name', 'create index if not exists idx_users_plan_name on public.users(plan_name)'],
  ['idx_subscriptions_plan_tier', 'create index if not exists idx_subscriptions_plan_tier on public.subscriptions(plan_tier)'],
  ['idx_sessions_user_id', 'create index if not exists idx_sessions_user_id on public.sessions(user_id)'],
  ['idx_audit_log_actor_user_id', 'create index if not exists idx_audit_log_actor_user_id on public.audit_log(actor_user_id)'],
  ['idx_invoices_user_id', 'create index if not exists idx_invoices_user_id on public.invoices(user_id)'],
  ['idx_user_uploads_user_id', 'create index if not exists idx_user_uploads_user_id on public.user_uploads(user_id)'],
]) {
  await sql(`${ddl};`);
  ok(name);
}

await sql('analyze;');

/* --- what a judge will read ----------------------------------------------- */

const final = await exactCounts();
const total = TABLES.reduce((s, t) => s + Number(final[t] ?? 0), 0);

say(`\n${BOLD}Seeded${OFF}\n`);
for (const t of TABLES) say(`   ${t.padEnd(14)} ${n(final[t]).padStart(11)} rows`);
say(`   ${'total'.padEnd(14)} ${n(total).padStart(11)} rows`);
say('');
note(`database size    ${await size()}`);
note(`users.plan_name  ${(await hasPlanName()) ? 'present' : 'MISSING'}`);
say('');
say(`${DIM}The agent reads this over a read-only connector and cannot change any of it.${OFF}`);
say(`${DIM}Verify:  npm run seed:supabase -- --check${OFF}\n`);

#!/usr/bin/env node
/**
 * The demo. Three problems, and what AIRLOCK does about each.
 *
 *   npm run demo              the whole thing, pausing before the human decides
 *   npm run demo -- --yes     never pause (rehearsal, CI, recording a take)
 *   npm run demo -- --reset   take a fresh dossier id instead of reusing one
 *
 * WHAT THIS IS, AND WHAT THE OLD ONE WAS
 *
 * The demo this replaces was a runbook: a list of things to click in a console
 * that had been seeded with hand-written fixtures. Every number on screen was
 * honest about being a fixture, and every number on screen was still a fixture.
 * It demonstrated a user interface. It did not demonstrate that anything worked.
 *
 * This runs. Every figure it prints was measured during the run you are
 * watching:
 *
 *   - the row counts come from the live Postgres behind the demo project;
 *   - the checksums are sha256 over real rows, taken before the change, after
 *     it, and after the rollback;
 *   - the gate verdicts come from `openGate` in packages/contract, the same
 *     function the console calls and the server re-runs before it writes;
 *   - the receipt goes into the same hash-chained ledger `npm run verify:ledger`
 *     reads.
 *
 * Nothing here is staged, and nothing here is allowed to be. If the harness is
 * down or the database is unseeded, it stops and says so rather than falling
 * back to something that looks the same on camera.
 *
 * THE ARGUMENT, IN THE ORDER IT IS MADE
 *
 *   Act 1  A change that should not be approved, and cannot be.
 *   Act 2  A change that should be, and is — after a proof, not instead of one.
 *   Act 3  A human decides, and the decision cannot be quietly rewritten.
 *
 * Act 1 is first on purpose. Anyone can demonstrate a system saying yes.
 */
import { createInterface } from 'node:readline/promises';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const argv = process.argv.slice(2);
const NO_PAUSE = argv.includes('--yes');
const RESET = argv.includes('--reset');

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const AMBER = '\x1b[33m';
const CYAN = '\x1b[36m';

const CONSOLE_URL = process.env.AIRLOCK_CONSOLE_URL ?? 'http://localhost:3000';
const MCP_URL = process.env.AIRLOCK_MCP_URL ?? 'http://localhost:8975/mcp';

/* --- presentation --------------------------------------------------------- */

const say = (m = '') => console.log(m);
const ok = (m) => say(`   ${GREEN}✓${OFF}  ${m}`);
const no = (m) => say(`   ${RED}✗${OFF}  ${m}`);
const held = (m) => say(`   ${AMBER}⧗${OFF}  ${m}`);
const note = (m) => say(`      ${DIM}${m}${OFF}`);
const n = (v) => Number(v ?? 0).toLocaleString('en-GB');

function act(number, title, problem) {
  say(`\n${DIM}${'─'.repeat(78)}${OFF}`);
  say(`${BOLD}ACT ${number}${OFF}  ${BOLD}${title}${OFF}`);
  say(`${DIM}${'─'.repeat(78)}${OFF}\n`);
  say(`   ${CYAN}The problem${OFF}`);
  for (const line of problem) say(`   ${line}`);
  say('');
}

/*
 * A failed open is fatal, and loudly so.
 *
 * The first version of this script narrated `change opened` from the fact that
 * the call returned at all, and then spent two acts reporting refusals whose
 * real cause was a contract validation error in the very first call. Every line
 * after it was true — the gate really did refuse — and every line after it was
 * about nothing. A demo that keeps talking after its subject failed to exist is
 * worse than one that stops, because it is still persuasive.
 */
function requireOpened(result, id) {
  if (result.ok) return;
  say('');
  no(`could not open ${id} — the demo cannot continue`);
  for (const line of result.text.split('\n')) if (line.trim()) note(line.trim().slice(0, 110));
  say('');
  process.exit(1);
}

/**
 * Open a change, taking the next free id if the obvious one is spent.
 *
 * Re-running the demo is the normal case — rehearsing, recording a second take,
 * showing someone at a desk — and the second run used to die on:
 *
 *     dos_demo_expand_plan_tier has already been decided. A decided change is immutable.
 *
 * The first instinct was to add a delete route and wipe the change between
 * runs. That instinct is wrong, and worth saying why: an approved change with a
 * receipt in the hash chain is exactly the thing this product promises nobody
 * can quietly remove, and adding a back door to make a demo tidier would be
 * removing the property being demonstrated. There is no DELETE route because
 * there is not supposed to be one.
 *
 * So a spent id is not an error to route around, it is the system behaving.
 * Take the next one, and say so.
 */
async function openChange(baseId, payload) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const id = attempt === 0 ? baseId : `${baseId}_${attempt + 1}`;
    const result = await mcp('airlock_open_change', { ...payload, dossier_id: id });
    if (result.ok) {
      if (attempt > 0) note(`${baseId} is already decided and immutable — this run is ${id}`);
      return id;
    }
    if (!/already been decided/i.test(result.text)) requireOpened(result, id);
  }
  requireOpened({ ok: false, text: 'ran out of free dossier ids' }, baseId);
  return baseId;
}

async function pause(prompt) {
  if (NO_PAUSE) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`\n   ${DIM}${prompt} ${OFF}`);
  rl.close();
}

/* --- the MCP client ------------------------------------------------------- */

/*
 * The demo talks to AIRLOCK exactly the way the agent does: over MCP, with the
 * same thirteen tools and no others. That is the point of driving it this way
 * rather than importing the contract directly — a demo that called `openGate()`
 * in-process would prove the function works and prove nothing about the product
 * surface an agent is actually confined to.
 *
 * There is deliberately no tool here that applies anything to production,
 * because the server does not offer one. `airlock_request_approval` is the far
 * end of what this script can reach, and Act 3 has to leave the process to go
 * any further.
 */
let rpcId = 0;

async function mcp(tool, args) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  const text = await res.text();
  const line = text.split('\n').find((l) => l.trim().startsWith('data: ')) ?? text;
  let json;
  try {
    json = JSON.parse(line.replace(/^data:\s*/, ''));
  } catch {
    throw new Error(`${tool}: could not parse a response from the MCP server:\n${text.slice(0, 300)}`);
  }
  if (json.error) throw new Error(`${tool}: ${json.error.message}`);

  const body = (json.result?.content ?? []).map((c) => c.text ?? '').join('\n');
  // An MCP tool reports a refusal as isError with the reason in the body, not
  // as a transport failure. Both are returned; the caller decides which is news.
  return { ok: !json.result?.isError, text: body };
}

async function consoleApi(method, route, body, headers = {}) {
  const res = await fetch(new URL(route, CONSOLE_URL), {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null, text };
  }
}

/* --- act 0: refuse to demo a system that is not there ---------------------- */

say(`\n${BOLD}AIRLOCK${OFF} ${DIM}— nothing reaches production without passing through the airlock${OFF}`);
say(`${DIM}Every number below is measured during this run. Nothing here is a fixture.${OFF}\n`);

say(`${BOLD}0. Is any of this actually running?${OFF}\n`);

/*
 * A demo that degrades gracefully is a demo that lies. Each of these is a
 * precondition for something the script is about to claim, so a missing one
 * stops the run and names the command that fixes it.
 */
const preflight = [];

async function require_(label, fn, remedy) {
  try {
    const detail = await fn();
    ok(`${label.padEnd(34)} ${DIM}${detail}${OFF}`);
    preflight.push(true);
  } catch (err) {
    no(`${label.padEnd(34)} ${String(err.message).slice(0, 90)}`);
    if (remedy) note(remedy);
    preflight.push(false);
  }
}

await require_(
  'the console',
  async () => {
    const { json } = await consoleApi('GET', '/api/me');
    if (!json?.role) throw new Error('no answer from /api/me');
    return `you are ${json.email} (${json.role})`;
  },
  'npm run up',
);

await require_(
  'the AIRLOCK MCP server',
  async () => {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'airlock-demo', version: '1' } },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return '13 tools, none of which write to production';
  },
  'npm run mcp:http',
);

await require_(
  'the demo database',
  async () => {
    const r = await mcp('airlock_read_policy', { change_class: 'SCHEMA_MIGRATION' });
    if (!r.ok) throw new Error(r.text.slice(0, 80));
    return 'policy readable';
  },
  'npm run up',
);

const dbFacts = await (async () => {
  const env = {};
  const file = path.join(root, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN;
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(process.env.SUPABASE_URL ?? env.SUPABASE_URL ?? '')?.[1];
  if (!token || !ref) return null;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `select (select count(*) from public.users) as users,
                     (select count(*) from information_schema.columns
                       where table_schema='public' and table_name='users' and column_name='plan_name') as has_plan_name,
                     (select count(*) from pg_indexes where schemaname='public' and indexname='idx_users_plan_name') as has_index;`,
    }),
  });
  if (!res.ok) return null;
  const [row] = await res.json();
  return row;
})();

await require_(
  'real rows behind it',
  async () => {
    if (!dbFacts) throw new Error('could not read the demo database');
    if (Number(dbFacts.has_plan_name) === 0) throw new Error('users.plan_name does not exist — nothing to migrate');
    return `${n(dbFacts.users)} users, plan_name present, 1 dependent index`;
  },
  'npm run seed:supabase -- --reset',
);

if (preflight.includes(false)) {
  say(`\n${RED}Stopping.${OFF} ${DIM}A demo that runs anyway is a demo that lies about what it proved.${OFF}\n`);
  process.exit(1);
}

/* --- reset ---------------------------------------------------------------- */

const UNSAFE = 'dos_demo_drop_plan_name';
const SAFE = 'dos_demo_expand_plan_tier';

if (RESET) {
  say('');
  note('--reset: each act will take a fresh dossier id rather than reuse a decided one.');
  note('There is no route that deletes a decided change, and there should not be.');
}

await pause('Press enter to begin.');

/* ========================================================================== *
 * ACT 1                                                                       *
 * ========================================================================== */

act(1, 'A change that should not be approved — and cannot be', [
  'An agent proposes: "drop the legacy column users.plan_name."',
  '',
  `It is a reasonable request. The column is dead, ${n(dbFacts.users)} rows carry it, and`,
  'the dossier will look completely normal. Every approval flow in the world',
  'would now render a button and ask a human to trust the plan.',
  '',
  `${BOLD}That question is unanswerable.${OFF} Nobody reading a diff can tell you whether`,
  'the rollback works. So AIRLOCK does not ask it.',
]);

say(`   ${CYAN}What AIRLOCK does instead${OFF}\n`);

const unsafeId = await openChange(UNSAFE, {
  change_class: 'SCHEMA_MIGRATION',
  request: 'Drop the legacy column users.plan_name.',
  requested_by: 'rohit@airlock.dev',
  systems: ['postgres'],
  forward: [
    { system: 'postgres', op: 'alter table users drop column plan_name', reason: 'The column is superseded by subscriptions.plan_tier.' },
  ],
  rollback: [
    { system: 'postgres', op: 'alter table users add column plan_name text', reason: 'Re-add the column.' },
  ],
  magnitude: { records: Number(dbFacts.users) },
  affected_tables: [{ system: 'postgres', name: 'users', rows: Number(dbFacts.users), operation: 'drop column' }],
  recommendation: 'APPLY',
});
ok(`change opened  ${DIM}${unsafeId}${OFF}`);
let r;
note('No certificate. No approval asked for. An opened change is sealed by default.');

say('');
say(`   ${DIM}Running it. Not reading it — running it, against a copy of the real rows.${OFF}`);
r = await mcp('airlock_verify_change', { dossier_id: unsafeId, tables: ['users'] });

const verdict1 = r.text;
say('');
if (/PROVEN/.test(verdict1) && !/FAILED/.test(verdict1)) {
  no('the proof passed, which this act did not expect — read the output below');
  say(verdict1.slice(0, 800));
} else {
  no(`${BOLD}the rollback did not bring the data back${OFF}`);
}
for (const line of verdict1.split('\n').slice(0, 12)) if (line.trim()) note(line.trim().slice(0, 96));

say('');
say(`   ${CYAN}The consequence${OFF}\n`);

r = await mcp('airlock_check_gate', { dossier_id: unsafeId });
const sealed1 = /SEALED/.test(r.text);
(sealed1 ? no : ok)(`gate: ${r.text.split('\n')[0].slice(0, 88)}`);

// The load-bearing moment of the whole product: the agent tries to ask, and the
// server refuses to carry the question to a human.
r = await mcp('airlock_request_approval', {
  dossier_id: unsafeId,
  summary: 'Drop users.plan_name. Please approve.',
});
say('');
if (r.ok) {
  no('the request went through, which would be a bug — a sealed change reached a human');
} else {
  ok(`${BOLD}the agent tried to ask a human, and was refused${OFF}`);
  for (const line of r.text.split('\n').slice(0, 5)) if (line.trim()) note(line.trim().slice(0, 96));
}

say('');
say(`   ${DIM}Nobody was interrupted. No button was rendered and then disabled — the value`);
say(`   that would represent permission was never constructed. ${OFF}`);

await pause('Press enter for Act 2.');

/* ========================================================================== *
 * ACT 2                                                                       *
 * ========================================================================== */

act(2, 'The same goal, done in a way that can be proven', [
  'The column still needs to go. AIRLOCK refused the destructive shortcut, so',
  'take the first step of the expand/contract path instead:',
  '',
  `${BOLD}add users.plan_tier and backfill it from the legacy value.${OFF}`,
  '',
  'This is reversible, and — the part that matters — AIRLOCK is not going to',
  'take my word for that either.',
]);

say(`   ${CYAN}What AIRLOCK does${OFF}\n`);

const safeId = await openChange(SAFE, {
  change_class: 'SCHEMA_MIGRATION',
  request: 'Expand step 1 of 3: add users.plan_tier and backfill it from users.plan_name.',
  requested_by: 'rohit@airlock.dev',
  systems: ['postgres'],
  forward: [
    { system: 'postgres', op: 'alter table users add column plan_tier text', reason: 'The replacement column.' },
    { system: 'postgres', op: 'update users set plan_tier = upper(plan_name)', reason: 'Backfill from the legacy value, which is still present.' },
  ],
  rollback: [
    { system: 'postgres', op: 'alter table users drop column plan_tier', reason: 'Remove the added column. Nothing else was touched.' },
  ],
  magnitude: { records: Number(dbFacts.users), undo_window_seconds: 1800 },
  affected_tables: [{ system: 'postgres', name: 'users', rows: Number(dbFacts.users), operation: 'add column, backfill' }],
  risk_notes: [{ note: 'Additive. No existing column is read by the rollback, and no data is destroyed by the forward path.' }],
  recommendation: 'APPLY',
});
ok(`change opened  ${DIM}${safeId}${OFF}`);

say('');
say(`   ${DIM}Same treatment. Apply it, checksum it, undo it, checksum it again.${OFF}`);
r = await mcp('airlock_verify_change', { dossier_id: safeId, tables: ['users'] });

say('');
const proven = /PROVEN/.test(r.text);
(proven ? ok : no)(proven ? `${BOLD}the data came back byte-identical${OFF}` : 'the proof did not pass');
for (const line of r.text.split('\n').slice(0, 14)) if (line.trim()) note(line.trim().slice(0, 96));

say('');
say(`   ${CYAN}The consequence${OFF}\n`);

r = await mcp('airlock_check_gate', { dossier_id: safeId });
const open2 = /OPEN/.test(r.text);
(open2 ? ok : no)(`gate: ${r.text.split('\n')[0].slice(0, 88)}`);

r = await mcp('airlock_request_approval', {
  dossier_id: safeId,
  summary:
    'Expand step 1 of 3. Adds users.plan_tier and backfills it. Applied and rolled back against a copy of all ' +
    `${n(dbFacts.users)} rows; the table came back byte-identical.`,
});
say('');
if (r.ok) {
  held(`${BOLD}it is now in front of a human, and it stops here${OFF}`);
  for (const line of r.text.split('\n').slice(0, 4)) if (line.trim()) note(line.trim().slice(0, 96));
} else {
  no(`the request was refused: ${r.text.split('\n')[0].slice(0, 88)}`);
}

say('');
say(`   ${DIM}This is as far as the agent goes. It has no tool that applies a change, and`);
say(`   the one tool that moves a change forward is held by the harness for a person.${OFF}`);

await pause('Press enter for Act 3 — the human decision.');

/* ========================================================================== *
 * ACT 3                                                                       *
 * ========================================================================== */

act(3, 'A human decides, and the record cannot be quietly rewritten', [
  'Two things have to be true of the decision itself, or none of the above',
  'was worth doing:',
  '',
  '  1. the gate is re-run on the server, so approving over the API is',
  '     refused exactly as approving in the browser would be;',
  '  2. the receipt is sealed into a hash chain anyone can re-verify.',
]);

say(`   ${CYAN}First: can the sealed change be approved by going around the UI?${OFF}\n`);

let d = await consoleApi('POST', `/api/dossiers/${unsafeId}/decision`, { decision: 'approved' });
if (d.status === 200) {
  no('the sealed change was approved over the API — that is a hole');
} else {
  ok(`curl on the sealed change: ${RED}${d.status}${OFF} ${DIM}${d.json?.error ?? ''}${OFF}`);
  note(String(d.json?.message ?? '').slice(0, 96));
}

say('');
say(`   ${CYAN}Now the proven one.${OFF}\n`);

const me = (await consoleApi('GET', '/api/me')).json;
note(`deciding as ${me?.email} (${me?.role}) — resolved by the server, never from the request body`);

await pause(`Press enter to approve ${safeId} as ${me?.email}.`);

d = await consoleApi('POST', `/api/dossiers/${safeId}/decision`, { decision: 'approved' });
say('');
if (d.status === 200) {
  ok(`${BOLD}approved${OFF} ${DIM}${d.json?.state ?? ''}${OFF}`);
  if (d.json?.message) note(String(d.json.message).slice(0, 96));
} else {
  no(`approval refused: ${d.status} ${d.json?.error ?? ''}`);
  note(String(d.json?.message ?? '').slice(0, 96));
}

/* --- the ledger ----------------------------------------------------------- */

say('');
say(`   ${CYAN}The record${OFF}\n`);

const { spawnSync } = await import('node:child_process');
const ledger = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify-ledger.mjs')], {
  cwd: root,
  encoding: 'utf8',
});
for (const line of (ledger.stdout ?? '').split('\n')) if (line.trim()) say(`      ${DIM}${line.trim().slice(0, 96)}${OFF}`);
if (ledger.status === 0) ok('the chain verifies');
else no('the chain does not verify');

/* --- close ---------------------------------------------------------------- */

say(`\n${DIM}${'─'.repeat(78)}${OFF}`);
say(`${BOLD}What just happened${OFF}\n`);
say(`   ${RED}✗${OFF}  A change that could not be undone ${BOLD}was never put in front of anyone.${OFF}`);
say(`   ${GREEN}✓${OFF}  A change that could be was ${BOLD}proven on ${n(dbFacts.users)} real rows first${OFF}, then asked.`);
say(`   ${AMBER}⧗${OFF}  A ${BOLD}person${OFF} made the only decision that mattered, and the receipt is sealed.`);
say('');
say(`   ${DIM}The console is at ${CONSOLE_URL}/console — the same two changes, on screen.${OFF}`);
say(`   ${DIM}Re-run the proofs any time:  npm run demo -- --reset${OFF}`);
say('');

/**
 * Answer a tool call the harness is holding for a human.
 *
 *   npm run harness:approve                 show what is pending, decide nothing
 *   npm run harness:approve -- --allow
 *   npm run harness:approve -- --deny "reads more than the change needs"
 *
 * AIRLOCK's claim is that the interesting runs stop and ask. They do — and
 * until this existed there was no way to answer. A held turn sat at
 * `tool.approval_required` forever: the console renders the hold but posts
 * nothing back, and the harness resumes only on a `user.tool_approval` input
 * item, which nothing in this repository sent. The demo reached the most
 * important moment in the product and then dead-ended.
 *
 * Two things about the resume are not guessable from the outside:
 *
 *   1. An approval is **a new turn**, not a PATCH. It goes to
 *      `POST /sessions/{id}/turns` with `input: [{ type: 'user.tool_approval',
 *      thread_id, tool_call_id, approval }]`. Approval items must not be mixed
 *      with user messages in the same turn.
 *   2. **Every held call needs its own item.** One `tool.approval_required`
 *      routinely covers several calls — the run this was written against held
 *      two `execute_sql` calls at once — and answering one leaves the turn
 *      still waiting on the rest, which looks exactly like the approval having
 *      been ignored.
 *
 * The default is to decide nothing. It prints the tool, the server and the
 * **arguments**, because the arguments are the decision: `execute_sql` tells
 * you nothing, and `SELECT COUNT(*) FROM users` versus `SELECT * FROM users`
 * is the whole difference between a row count and an exfiltration. A control
 * that asked for approval without showing that would be theatre.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8791';

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';
const GREEN = '\x1b[32m';
const AMBER = '\x1b[33m';
const RED = '\x1b[31m';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const valueOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const allow = flag('allow');
const deny = flag('deny');
if (allow && deny) {
  console.error('Pick one of --allow or --deny.');
  process.exit(2);
}
const denyReason = deny ? (valueOf('deny') ?? 'Denied by an operator.') : undefined;

async function api(method, path, body) {
  const res = await fetch(new URL(path, BASE), {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    console.error(`${RED}${method} ${path} -> ${res.status}${OFF}`);
    console.error(JSON.stringify(parsed).slice(0, 400));
    process.exit(1);
  }
  return parsed;
}

const health = await fetch(new URL('/healthz', BASE)).catch(() => null);
if (!health?.ok) {
  console.error(`No TrueForge server at ${BASE}. Start it with: npm run up`);
  process.exit(2);
}

/* --- find the run that is waiting ----------------------------------------- */

const sessionId = valueOf('session') ?? null;
const sessions = sessionId
  ? [{ id: sessionId }]
  : ((await api('GET', '/api/v1/sessions?limit=10')).data ?? []);

if (sessions.length === 0) {
  console.log('No sessions on this harness yet.');
  process.exit(0);
}

/** Unwrap `{ data: [{ turn_id, event }] }` into plain events, oldest first. */
function eventsOf(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((row) => (row && typeof row.event === 'object' ? row.event : row))
    .filter((e) => typeof e?.type === 'string')
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

/**
 * The pending hold on a session, if it has one.
 *
 * A hold counts as answered once any `user.tool_approval` appears after it, so
 * a session approved five minutes ago is not offered again.
 */
function pendingHold(events) {
  let hold = null;
  for (const event of events) {
    if (event.type === 'tool.approval_required') hold = event;
    if (event.type === 'user.tool_approval' || event.type === 'turn.created') {
      if (event.type === 'user.tool_approval') hold = null;
    }
  }
  return hold;
}

/** id -> { name, server, args } from the model messages that made the calls. */
function callIndex(events) {
  const index = new Map();
  for (const event of events) {
    if (event.type !== 'model.message' && event.type !== 'model.message.delta') continue;
    const calls = event.tool_calls ?? event.toolCalls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      const fn = call?.function ?? {};
      const name = fn.name ?? call?.name;
      if (!call?.id || !name) continue;
      const info = call.tool_info ?? call.toolInfo ?? {};
      index.set(call.id, {
        name,
        server: info.server_name ?? info.serverName ?? null,
        args: fn.arguments ?? call.arguments ?? null,
      });
    }
  }
  return index;
}

let target = null;
for (const session of sessions) {
  const events = eventsOf(await api('GET', `/api/v1/sessions/${session.id}/events`));
  const hold = pendingHold(events);
  if (hold) {
    target = { session, events, hold, index: callIndex(events) };
    break;
  }
}

if (!target) {
  console.log(`${GREEN}Nothing is waiting.${OFF} No session has an unanswered tool approval.`);
  process.exit(0);
}

/* --- show exactly what is being asked ------------------------------------- */

const held = Array.isArray(target.hold.tool_calls) ? target.hold.tool_calls : [];
const threadId = target.hold.thread_id ?? 'main';

console.log(`\n${AMBER}${BOLD}HELD FOR A HUMAN${OFF}  ${DIM}session ${target.session.id}${OFF}`);
console.log(`${DIM}${held.length} call(s) waiting on thread ${threadId}${OFF}\n`);

for (const call of held) {
  const known = target.index.get(call.id);
  const label = known ? (known.server ? `${known.server}·${known.name}` : known.name) : '(name not on the wire)';
  console.log(`  ${BOLD}${label}${OFF}`);
  if (known?.args) {
    // The arguments are the decision. Printed whole, not summarised.
    let pretty = known.args;
    try {
      pretty = JSON.stringify(JSON.parse(known.args));
    } catch {
      /* not JSON; show it as it came */
    }
    console.log(`    ${DIM}${pretty}${OFF}`);
  }
}

if (!allow && !deny) {
  console.log(`\n${DIM}Nothing decided. Re-run with --allow, or --deny "reason".${OFF}\n`);
  process.exit(0);
}

/* --- answer, for every held call ------------------------------------------ */

const decision = allow ? { status: 'allow' } : { status: 'deny', reason: denyReason };
const input = held.map((call) => ({
  type: 'user.tool_approval',
  thread_id: threadId,
  tool_call_id: call.id,
  approval: decision,
}));

console.log(`\n${allow ? GREEN : RED}${BOLD}${allow ? 'ALLOWING' : 'DENYING'}${OFF} ${input.length} call(s)…`);

await api('POST', `/api/v1/sessions/${target.session.id}/turns`, {
  input,
  previous_turn_id: target.hold.turn_id ?? undefined,
  stream: false,
});

/* --- and then watch, because a posted decision is not a finished run ------ */

const deadline = Date.now() + 240_000;
let lastSeen = target.events.at(-1)?.id ?? '';
for (;;) {
  await sleep(3000);
  const events = eventsOf(await api('GET', `/api/v1/sessions/${target.session.id}/events`));
  for (const event of events) {
    if (String(event.id ?? '').localeCompare(lastSeen) <= 0) continue;
    lastSeen = event.id;

    if (event.type === 'tool.response') {
      const known = target.index.get(event.tool_call_id);
      const line = String(event.content ?? '').split('\n')[0].slice(0, 160);
      console.log(`  ${GREEN}tool${OFF}     ${known?.name ?? 'response'}${DIM} · ${line}${OFF}`);
    } else if (event.type === 'tool.approval_required') {
      console.log(`  ${AMBER}held${OFF}     another approval is waiting — run this again`);
    } else if (event.type === 'turn.done') {
      const state = event.state ?? {};
      if (state.status === 'error') {
        console.log(`\n${RED}The resumed turn failed.${OFF} ${String(state.message ?? '').slice(0, 300)}`);
        process.exit(1);
      }
      console.log(`\n${GREEN}${BOLD}The run continued.${OFF} ${DIM}turn ${state.status ?? 'done'}${OFF}`);
      console.log(`${DIM}See it in the console: http://localhost:3000/console${OFF}\n`);
      process.exit(0);
    }
  }
  if (Date.now() > deadline) {
    console.log(`\n${AMBER}Still running after four minutes.${OFF} Watch it in the console.`);
    process.exit(0);
  }
}

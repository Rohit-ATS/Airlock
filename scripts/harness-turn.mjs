/**
 * Drive one real turn against the harness, and show what crossed the wire.
 *
 *   npm run harness:turn -- "Read the policy for SCHEMA_MIGRATION."
 *
 * `harness-setup.mjs` has told people to run this since the day it was written,
 * and until now the script did not exist — the setup finished by printing a
 * command that failed. That is the worst kind of gap in a repo a stranger is
 * meant to clone: the instructions are confident and wrong, and the reader
 * concludes the project does not work rather than that one file is missing.
 *
 * What it prints is deliberately the event stream rather than just the model's
 * answer. The answer is the least interesting part — AIRLOCK's whole claim is
 * about what the harness did on the way there: which MCP servers initialised,
 * which tools were called, and whether the run stopped and asked a human. Those
 * are the events the Harness Panel lights lamps from, so seeing them here and
 * seeing them on screen are the same evidence.
 *
 * Exit code is 0 when the turn completed, 1 when it failed, and 0 when it
 * stopped for approval — because stopping for a human is a success, not an
 * error, and a script that treated it as a failure would be arguing against
 * the product.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8791';
const AGENT = process.env.AIRLOCK_AGENT ?? 'airlock-change-control';

const prompt = process.argv.slice(2).join(' ').trim();
if (!prompt) {
  console.error('Usage: npm run harness:turn -- "what you want the agent to do"');
  process.exit(2);
}

const DIM = '[2m';
const BOLD = '[1m';
const OFF = '[0m';
const GREEN = '[32m';
const AMBER = '[33m';
const RED = '[31m';

async function api(path, init) {
  const res = await fetch(new URL(path, BASE), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} from ${path}: ${(await res.text()).slice(0, 400)}`);
  }
  return res;
}

/* --- the session ---------------------------------------------------------- */

let sessionId = process.env.AIRLOCK_SESSION_ID;
if (!sessionId) {
  const created = await api('/api/v1/sessions', {
    method: 'POST',
    body: JSON.stringify({ agent: { name: AGENT } }),
  });
  sessionId = (await created.json()).data.id;
  console.log(`${DIM}session ${sessionId} against ${AGENT}${OFF}\n`);
} else {
  /*
   * The id is deliberately not echoed here.
   *
   * A session id is a live handle to a running conversation on the harness —
   * anyone holding it can read the transcript and post turns into it. When the
   * script mints one it is worth printing, because that is the only way the
   * operator learns it. When it arrives in AIRLOCK_SESSION_ID the operator
   * already has it, so printing it back buys nothing and writes a live handle
   * into terminal scrollback and any CI log this runs under.
   */
  console.log(`${DIM}reusing the session in AIRLOCK_SESSION_ID against ${AGENT}${OFF}\n`);
}

/* --- the turn ------------------------------------------------------------- */

const res = await api(`/api/v1/sessions/${sessionId}/turns`, {
  method: 'POST',
  body: JSON.stringify({ input: [{ type: 'user.message', content: prompt }] }),
});

/**
 * The observed run, in the same terms the capability registry uses.
 *
 * Counted rather than inferred: a tool call is a `tool.call` event that really
 * crossed the wire, not a sentence in the transcript that mentions one. This is
 * the same rule detectors.ts follows, for the same reason — a summary that can
 * be produced without the run having happened is not evidence of the run.
 */
const seen = {
  servers: new Set(),
  tools: [],
  approvalHeld: null,
  sandbox: false,
  subagents: 0,
  models: new Set(),
  cost: 0,
  status: null,
  text: '',
};

let buffer = '';
for await (const chunk of res.body) {
  buffer += Buffer.from(chunk).toString('utf8');

  // SSE frames are separated by a blank line. Anything after the last one is a
  // partial frame and has to wait for more bytes.
  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';

  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;

    let event;
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      continue;
    }

    switch (event.type) {
      case 'turn.created':
        console.log(`${BOLD}turn ${event.turn_id}${OFF}`);
        break;

      case 'mcp.initialize':
        for (const s of event.mcp_servers ?? []) seen.servers.add(s.name);
        console.log(`  ${GREEN}mcp${OFF}      ${(event.mcp_servers ?? []).map((s) => s.name).join(', ')}`);
        break;

      case 'thread.created':
        seen.subagents += 1;
        if (event.agentInfo?.model) seen.models.add(event.agentInfo.model);
        console.log(`  ${GREEN}subagent${OFF} ${event.thread_id} ${DIM}${event.agentInfo?.model ?? ''}${OFF}`);
        break;

      case 'sandbox.created':
        seen.sandbox = true;
        console.log(`  ${GREEN}sandbox${OFF}  created`);
        break;

      // The harness reports a completed call as `tool.response`; there is no
      // `tool.call` on the wire. Worth stating because detectors.ts folds the
      // same stream, and a lamp keyed to an event name that is never emitted
      // stays dark through a run that genuinely exercised the capability.
      case 'tool.response': {
        const name = event.tool_name ?? event.name ?? event.tool_info?.name ?? '?';
        seen.tools.push(name);
        console.log(`  ${GREEN}tool${OFF}     ${name}`);
        break;
      }

      case 'tool.approval_required':
        // The whole product, in one event.
        seen.approvalHeld = event.name ?? event.tool_name ?? 'unknown tool';
        console.log(`\n  ${AMBER}${BOLD}HELD FOR A HUMAN${OFF} ${AMBER}${seen.approvalHeld}${OFF}`);
        console.log(`  ${DIM}the harness is holding this tool. nothing moves until a person answers.${OFF}\n`);
        break;

      case 'model.message.delta':
        if (event.content) {
          seen.text += event.content;
          process.stdout.write(`${DIM}${event.content}${OFF}`);
        }
        break;

      case 'turn.done':
        seen.status = event.state?.status ?? 'done';
        seen.cost = event.state?.metrics?.total_cost_in_usd ?? 0;
        break;

      default:
        break;
    }
  }
}

/* --- what the run proved -------------------------------------------------- */

console.log(`\n\n${BOLD}what crossed the wire${OFF}`);
console.log(`  status         ${seen.status ?? 'unknown'}`);
console.log(`  mcp servers    ${seen.servers.size ? [...seen.servers].join(', ') : `${DIM}none${OFF}`}`);
console.log(`  tools called   ${seen.tools.length ? seen.tools.join(', ') : `${DIM}none${OFF}`}`);
console.log(`  sandbox        ${seen.sandbox ? 'created' : `${DIM}not used${OFF}`}`);
console.log(`  subagents      ${seen.subagents || `${DIM}none${OFF}`}`);
if (seen.cost) console.log(`  cost           $${seen.cost.toFixed(4)}`);

if (seen.approvalHeld) {
  console.log(`\n${AMBER}The run stopped and asked.${OFF} ${seen.approvalHeld} is held by the harness.`);
  console.log(`${DIM}Answer it in the console at http://localhost:3000/console — that is the gate.${OFF}`);
  process.exit(0);
}

if (seen.status === 'failed') {
  console.log(`\n${RED}The turn failed.${OFF} Check: npm run harness:logs`);
  process.exit(1);
}

await sleep(0);
process.exit(0);

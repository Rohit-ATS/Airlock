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
 *
 * A run throttled by the model provider is not a failed run, so it is not
 * reported as one. The harness ends the turn on a 429 and does not retry; this
 * script resumes it on the interval the provider named, by chaining a turn with
 * empty input. Against a 30k-tokens-per-minute ceiling a full change-control
 * run needs that several times, and without it the demo dies mid-investigation
 * for a reason that has nothing to do with the change. The resumes are counted
 * and printed rather than hidden — a deployment whose model ceiling is too low
 * should be visible in the output, not silently papered over.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import {
  RESUME_INPUT,
  planResume,
  qualifyToolCall,
  readToolCalls,
  readToolResponse,
  readTurnState,
} from '../packages/contract/dist/index.js';

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

/**
 * The observed run, in the same terms the capability registry uses.
 *
 * Counted rather than inferred: a tool call is a `tool.call` event that really
 * crossed the wire, not a sentence in the transcript that mentions one. This is
 * the same rule detectors.ts follows, for the same reason — a summary that can
 * be produced without the run having happened is not evidence of the run.
 *
 * Accumulated across resumes rather than reset per turn, because a run that was
 * throttled halfway through is still one run, and the operator wants the tools
 * it called, not the tools it called after the last 429.
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
  /** How the last turn ended, read the same way the console reads it. */
  outcome: { state: 'running' },
  /** Resume turns this run needed. Printed, so throttling is never invisible. */
  resumes: 0,
};

/**
 * Tool call id → the name it was called under.
 *
 * Survives across resumes deliberately: a response can arrive on a later turn
 * than the call that produced it, and losing the name at a turn boundary is how
 * this ends up printing `?` again.
 */
const calledAs = new Map();

/** Post a turn and fold its whole event stream into `seen`. */
async function driveTurn(input) {
  const res = await api(`/api/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });

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
        //
        // The name is *not* on this event. It only carries `tool_call_id`, so
        // reading `event.tool_name` — which nothing sets — printed a literal
        // `?` for every call this script has ever reported, and the summary
        // line read "tools called ?, ?, ?, ?". The name comes from the
        // `model.message` that made the call, remembered below.
        case 'tool.response': {
          const name = calledAs.get(event.tool_call_id) ?? '?';
          seen.tools.push(name);
          const decoded = readToolResponse(event.content);
          const colour = decoded.ok ? GREEN : RED;
          console.log(`  ${colour}tool${OFF}     ${name}${DIM} · ${decoded.text.split('\n')[0]}${OFF}`);
          break;
        }

        case 'tool.approval_required':
          // The whole product, in one event.
          seen.approvalHeld = event.name ?? event.tool_name ?? 'unknown tool';
          console.log(`\n  ${AMBER}${BOLD}HELD FOR A HUMAN${OFF} ${AMBER}${seen.approvalHeld}${OFF}`);
          console.log(`  ${DIM}the harness is holding this tool. nothing moves until a person answers.${OFF}\n`);
          break;

        // Where the id-to-name mapping a `tool.response` needs actually lives.
        //
        // Not on `model.message`: on the live wire that event carries only
        // `{ type, id, thread_id, created_at }`. The calls arrive on
        // `model.message.delta`, whose first frame per call holds the name and
        // the server and whose later frames hold argument fragments. Both are
        // read; `readToolCalls` drops the fragments.
        case 'model.message':
        case 'model.message.delta':
          for (const call of readToolCalls(event)) {
            if (!calledAs.has(call.id)) calledAs.set(call.id, qualifyToolCall(call));
          }
          // Same event, both jobs: a delta frame carries either a call fragment
          // or a piece of the reply, and the reply is what gets streamed out.
          if (event.content) {
            seen.text += event.content;
            process.stdout.write(`${DIM}${event.content}${OFF}`);
          }
          break;

        case 'turn.done':
          seen.status = event.state?.status ?? 'done';
          // Cost accumulates across resumes; a throttled run that went round
          // three times really did spend three turns' worth of tokens.
          seen.cost += event.state?.metrics?.total_cost_in_usd ?? 0;
          // Read the same way the console reads it, so "held" is never mistaken
          // for "complete" and an error carries the provider's own sentence.
          seen.outcome = readTurnState(event.state);
          break;

        default:
          break;
      }
  }
  }
}

/* --- drive it, and keep driving it through a throttle ---------------------- */

await driveTurn([{ type: 'user.message', content: prompt }]);

/*
 * A turn killed by a provider rate limit is not a finished run.
 *
 * Against a 30k-tokens-per-minute ceiling this agent spends its window around
 * the fourth iteration and the fifth request is refused, so a run that reaches
 * a human without being throttled at least once is the exception. The harness
 * reports the refusal as the terminal state of the turn and stops; nothing
 * upstream retries.
 *
 * So we do, on the interval the provider itself named, by chaining an
 * empty-input turn. `planResume` decides whether and how long — the same
 * function the console's unattended supervisor uses, so the CLI and the webhook
 * cannot drift into two different ideas of what is worth retrying.
 */
let resumeState = { attempts: 0, waitedMs: 0 };
while (seen.outcome.state === 'failed') {
  const plan = planResume(seen.outcome.failure, resumeState);
  if (!plan.resume) {
    console.log(`\n  ${RED}${plan.reason}${OFF}`);
    break;
  }

  console.log(`\n  ${AMBER}${plan.reason}${OFF}`);
  console.log(`  ${DIM}${seen.outcome.failure.message}${OFF}`);
  await sleep(plan.delayMs);

  resumeState = { attempts: plan.attempt, waitedMs: resumeState.waitedMs + plan.delayMs };
  seen.resumes = plan.attempt;
  // Empty input: TrueForge chains turns automatically, so history must never
  // be resent — doing so would double the input tokens of the very request
  // that was just refused for being too large.
  await driveTurn(RESUME_INPUT);
}

/* --- what the run proved -------------------------------------------------- */

console.log(`\n\n${BOLD}what crossed the wire${OFF}`);
console.log(`  status         ${seen.status ?? 'unknown'}`);
console.log(`  mcp servers    ${seen.servers.size ? [...seen.servers].join(', ') : `${DIM}none${OFF}`}`);
console.log(`  tools called   ${seen.tools.length ? seen.tools.join(', ') : `${DIM}none${OFF}`}`);
console.log(`  sandbox        ${seen.sandbox ? 'created' : `${DIM}not used${OFF}`}`);
console.log(`  subagents      ${seen.subagents || `${DIM}none${OFF}`}`);
if (seen.cost) console.log(`  cost           $${seen.cost.toFixed(4)}`);
// Printed even when zero would be noise, but never hidden when it is not: a run
// that was throttled four times and recovered is a different fact about this
// deployment than one that sailed through, and silently swallowing the
// difference is how a token ceiling stays invisible until a demo.
if (seen.resumes) {
  console.log(`  resumes        ${seen.resumes} ${DIM}(the provider throttled this run)${OFF}`);
}

// A run holding for a human is a success, and it is the success this product
// exists to produce — so it is checked before any failure branch.
if (seen.approvalHeld || seen.outcome.state === 'held') {
  const held = seen.approvalHeld ?? seen.outcome.actions?.join(', ') ?? 'a tool';
  console.log(`\n${AMBER}The run stopped and asked.${OFF} ${held} is held by the harness.`);
  console.log(`${DIM}Answer it in the console at http://localhost:3000/console — that is the gate.${OFF}`);
  process.exit(0);
}

if (seen.outcome.state === 'failed') {
  // The provider's own sentence, not "check the logs". The message names the
  // organisation, the ceiling and the overage, and it is the string an operator
  // pastes into a provider dashboard.
  console.log(`\n${RED}The run did not finish.${OFF} ${seen.outcome.failure.message}`);
  if (seen.outcome.failure.kind === 'RATE_LIMITED') {
    console.log(
      `${DIM}Nothing reached production. This deployment's model ceiling is too low for a full run;${OFF}`,
    );
    console.log(`${DIM}raise the provider limit, or point AIRLOCK_AGENT at a model with more headroom.${OFF}`);
  }
  process.exit(1);
}

await sleep(0);
process.exit(0);

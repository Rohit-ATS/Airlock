/**
 * What the agent is doing, reconstructed from the harness's own event stream.
 *
 * The DOING lane was permanently empty, and the reason is worth writing down
 * because it is a design mistake rather than a bug.
 *
 * The console's `RunStore` had exactly one writer: the observer wrapped around
 * `AgentUIServer.createTurn`, which fires only when *this browser tab* posts a
 * turn through the SDK composer. But AIRLOCK's entire argument is that nobody
 * types anything — a webhook opens the session and the turn runs on the server.
 * Those runs never pass through a browser, so nothing was ever ingested, and
 * the lane that is supposed to show autonomy could only ever be populated by a
 * human doing the thing autonomy was meant to remove.
 *
 * So the feed is rebuilt here, from the events the harness already stores, and
 * two details of this particular harness shape it:
 *
 *   - **There are no `thread.created` events.** The store created a lane only
 *     on that event, and this server emits none — zero across every session
 *     checked. The root agent runs as `thread_id: "main"` and is never
 *     announced. Lanes are therefore derived from whatever `thread_id` actually
 *     appears, with `main` assumed present, rather than waiting for an
 *     announcement that never comes.
 *   - **The wire is snake_case and the SDK is camelCase.** Both spellings are
 *     read for every field, the same way the detectors do, rather than betting
 *     on one and silently reading `undefined`.
 *
 * Pure on purpose: it takes events and returns a summary, so it can be tested
 * without a harness, a browser or a network.
 */

import { labelToolResponse, qualifyToolCall, readToolCalls, readToolResponse } from './toolText.js';

/** One event as it arrives, in either spelling. Deliberately loose. */
export interface SessionEvent {
  type?: string;
  id?: string;
  created_at?: string;
  createdAt?: string;
  thread_id?: string | null;
  threadId?: string | null;
  turn_id?: string;
  turnId?: string;
  content?: unknown;
  tool_calls?: unknown;
  toolCalls?: unknown;
  mcp_servers?: unknown;
  mcpServers?: unknown;
  state?: unknown;
  [key: string]: unknown;
}

export type StepKind =
  | 'turn'
  | 'thinking'
  | 'tool'
  | 'held'
  | 'asked'
  | 'connectors'
  | 'sandbox'
  | 'subagent'
  | 'done'
  /**
   * A turn that ended badly.
   *
   * Separate from `done` because a feed that stamps the same neutral chip on
   * "turn complete" and "turn failed" is asking the reader to notice the
   * difference in prose. The whole point of the kind is that it is the part you
   * can see without reading.
   */
  | 'failed';

export interface ActivityStep {
  at: string;
  kind: StepKind;
  /** Short enough for a lane row. */
  label: string;
  /** The evidence behind the label, when there is any. */
  detail?: string;
  thread: string;
}

export interface ActivityLane {
  thread: string;
  steps: ActivityStep[];
}

export interface ActivitySummary {
  status: 'idle' | 'running' | 'held' | 'done' | 'error';
  /** Why it stopped, when it stopped for a person. */
  heldOn: string | null;
  /**
   * Why it broke, when it broke.
   *
   * Null on every run that did not fail, so `status === 'error'` and a present
   * `failure` travel together and a caller cannot render one without the other.
   */
  failure: TurnFailure | null;
  lanes: ActivityLane[];
  steps: ActivityStep[];
  tools: string[];
  servers: string[];
  startedAt: string | null;
  endedAt: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function at(event: SessionEvent): string {
  return str(event.created_at) ?? str(event.createdAt) ?? '';
}

function thread(event: SessionEvent): string {
  return str(event.thread_id) ?? str(event.threadId) ?? 'main';
}

/** The first readable sentence of a model message, for the lane row. */
function firstLine(content: unknown): string | null {
  if (typeof content === 'string') return content.trim().split('\n')[0]?.slice(0, 140) || null;
  if (Array.isArray(content)) {
    for (const part of content) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text === 'string' && text.trim()) return text.trim().split('\n')[0]?.slice(0, 140) || null;
    }
  }
  return null;
}

function toolNames(event: SessionEvent): string[] {
  const calls = event.tool_calls ?? event.toolCalls;
  if (!Array.isArray(calls)) return [];
  return calls
    .map((call) => {
      const c = call as { name?: unknown; function?: { name?: unknown } };
      return str(c.name) ?? str(c.function?.name);
    })
    .filter((name): name is string => Boolean(name));
}

function serverNames(event: SessionEvent): string[] {
  const servers = event.mcp_servers ?? event.mcpServers;
  if (!Array.isArray(servers)) return [];
  return servers.map((s) => str((s as { name?: unknown }).name)).filter((n): n is string => Boolean(n));
}

/**
 * Did this turn stop for a human?
 *
 * A `done` turn carrying `required_actions` is **paused, not complete** — the
 * single easiest thing to get wrong against this API, and getting it wrong here
 * would make the console announce that a run finished at the exact moment it
 * started waiting for an approval.
 */
function requiredActions(event: SessionEvent): unknown[] {
  const state = event.state as { required_actions?: unknown; requiredActions?: unknown } | undefined;
  const actions = state?.required_actions ?? state?.requiredActions;
  return Array.isArray(actions) ? actions : [];
}

function statusOf(event: SessionEvent): string | null {
  const state = event.state as { status?: unknown } | undefined;
  return str(state?.status);
}

/** The upstream explanation on a failed turn, when the harness sent one. */
function messageOf(event: SessionEvent): string | null {
  const state = event.state as { message?: unknown } | undefined;
  return str(state?.message);
}

/**
 * Why a turn failed, in a form an operator can act on.
 *
 * `turn.done` carries the reason in `state.message`, and this module used to
 * throw it away and render a bare "turn failed". That is close to the least
 * useful sentence a console can print. A provider throttling us for nine
 * seconds and a real defect in the gate produced identical output, so the only
 * way to tell them apart was to go and read container logs — which is precisely
 * the errand a console exists to abolish.
 *
 * The buckets are deliberately coarse. They exist to answer one question —
 * *is this mine to fix, or do I wait?* — and any finer taxonomy would be
 * betting on provider strings that change without notice. The raw message is
 * always carried alongside, so the bucketing never costs information.
 */
export type FailureKind =
  | 'RATE_LIMITED'
  | 'MODEL_AUTH'
  | 'CONTEXT_OVERFLOW'
  | 'PROVIDER'
  | 'UNKNOWN';

export interface TurnFailure {
  kind: FailureKind;
  /** The upstream message, unedited. */
  message: string;
  /**
   * How long the provider asked us to wait, in seconds, when it said so.
   *
   * Parsed rather than assumed: OpenAI writes "Please try again in 8.764s" into
   * the body of a 429, and that number is the difference between "wait ten
   * seconds" and "something is wrong with the deployment". Null when no
   * interval was named, which is a different fact from zero and must never be
   * rendered as "retry now".
   */
  retryAfterSeconds: number | null;
}

const RETRY_AFTER = /try again in ([\d.]+)\s*(ms|s)\b/i;

/**
 * Sort an upstream failure message into a bucket.
 *
 * Order matters and is not alphabetical. A 429 body from OpenAI opens with
 * "Request failed (429)", so a `PROVIDER` test that looked for "request failed"
 * would swallow every rate limit before the rate-limit test ever ran. The
 * specific checks therefore run first and the generic one last.
 */
export function classifyFailure(message: string | null): TurnFailure | null {
  if (!message) return null;
  const text = message.toLowerCase();

  const kind: FailureKind = /\b429\b|rate limit|too many requests|quota/.test(text)
    ? 'RATE_LIMITED'
    : /\b401\b|\b403\b|api key|unauthorized|authentication/.test(text)
      ? 'MODEL_AUTH'
      : /context length|context_length_exceeded|maximum context|too many tokens/.test(text)
        ? 'CONTEXT_OVERFLOW'
        : /request failed|\b5\d\d\b|upstream|provider/.test(text)
          ? 'PROVIDER'
          : 'UNKNOWN';

  let retryAfterSeconds: number | null = null;
  const found = RETRY_AFTER.exec(message);
  if (found) {
    const value = Number(found[1]);
    if (Number.isFinite(value)) {
      retryAfterSeconds = found[2]!.toLowerCase() === 'ms' ? value / 1000 : value;
    }
  }

  return { kind, message, retryAfterSeconds };
}

/**
 * The one line to put on screen for a failure.
 *
 * Written for the person watching the run, not for the log: it names who is at
 * fault and what to do, because "turn failed" answers neither.
 */
const FAILURE_LABEL: Record<FailureKind, string> = {
  RATE_LIMITED: 'turn failed — the model provider is throttling us',
  MODEL_AUTH: 'turn failed — the model provider rejected the key',
  CONTEXT_OVERFLOW: 'turn failed — the context outgrew the model window',
  PROVIDER: 'turn failed — the model provider errored',
  UNKNOWN: 'turn failed',
};

export function describeFailure(failure: TurnFailure): string {
  const base = FAILURE_LABEL[failure.kind];
  if (failure.retryAfterSeconds === null) return base;
  return `${base}; it asked for ${failure.retryAfterSeconds}s`;
}

/**
 * Could sending the same request again plausibly work?
 *
 * Kept beside the classifier rather than in the console, because it is the one
 * judgement a retry control must not make locally: a button offered on a
 * failure that cannot succeed twice is worse than no button at all — it turns a
 * clear dead end into a loop the operator has to discover is a loop.
 *
 * `RATE_LIMITED` covers an exhausted quota as well as a throttle, because the
 * bucketing is deliberately coarse and both arrive as a 429. That is the right
 * trade for a *label*; for a retry it means the console can offer another go at
 * an account with no credit in it. The cost of being wrong that way is one
 * wasted press and the provider's own sentence on screen explaining why, which
 * is a far better outcome than the reverse: refusing to offer a retry for the
 * throttle that is the normal, expected, entirely recoverable failure of this
 * agent against a 30k-per-minute ceiling.
 *
 * `UNKNOWN` is not retryable. An error the harness declined to describe is not
 * one we should encourage anybody to repeat.
 */
export function isRetryable(failure: TurnFailure): boolean {
  return failure.kind === 'RATE_LIMITED' || failure.kind === 'PROVIDER';
}

/**
 * Get the events out of whatever `/api/v1/sessions/{id}/events` actually returns.
 *
 * Three things about that response were not guessable and all three were got
 * wrong first time, so they are handled explicitly and asserted in the tests:
 *
 *   - The body is `{ data, pagination }`, and each element of `data` is an
 *     **envelope** — `{ turn_id, event: { … } }`. The event is nested. Reading
 *     the elements directly gives `type === undefined` for every one of them,
 *     which produces a confidently empty summary rather than an error.
 *   - It comes back **newest first**. A timeline rendered in that order tells
 *     the story backwards, opening with "turn complete".
 *   - `thread_id` is absent on run-level events (`turn.created`, `turn.done`)
 *     and `"main"` on the rest.
 *
 * Also accepts a bare array, and elements that are already unwrapped, so the
 * SDK and the HTTP surface can both be fed to it.
 */
export function unwrapEvents(payload: unknown): SessionEvent[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown } | null)?.data)
      ? ((payload as { data: unknown[] }).data)
      : [];

  const events = rows
    .map((row) => {
      const inner = (row as { event?: unknown } | null)?.event;
      return (inner && typeof inner === 'object' ? inner : row) as SessionEvent;
    })
    .filter((event) => typeof event?.type === 'string');

  // Oldest first, so the feed reads forwards. `id` is a monotonic ULID, which
  // is a sounder sort key than a timestamp that can tie at millisecond
  // resolution — two events in the same millisecond is normal here.
  return events.sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

export function summariseEvents(events: readonly SessionEvent[]): ActivitySummary {
  const steps: ActivityStep[] = [];
  const tools = new Set<string>();
  const servers = new Set<string>();
  /**
   * Tool call id → the name it was called under.
   *
   * `tool.response` carries `tool_call_id` and no name, so without this the
   * feed can only ever say "tool returned" — which is the least useful thing a
   * row can say at the moment somebody is working out which call went wrong.
   */
  const calledAs = new Map<string, string>();

  let status: ActivitySummary['status'] = events.length > 0 ? 'running' : 'idle';
  let heldOn: string | null = null;
  let endedAt: string | null = null;
  let failure: TurnFailure | null = null;

  for (const event of events) {
    const kindOf = event.type ?? '';
    const when = at(event);
    const lane = thread(event);
    const push = (kind: StepKind, label: string, detail?: string) =>
      steps.push({ at: when, kind, label, thread: lane, ...(detail ? { detail } : {}) });

    switch (kindOf) {
      case 'turn.created':
        push('turn', 'turn started');
        break;

      case 'thread.created': {
        const info = (event.agent_info ?? event.agentInfo) as { name?: unknown; model?: unknown } | undefined;
        push('subagent', `subagent ${str(info?.name) ?? lane}`, str(info?.model) ?? undefined);
        break;
      }

      // Both shapes: stored events carry the calls on `model.message`, the live
      // stream only on `model.message.delta`. See `readToolCalls`.
      case 'model.message.delta':
      case 'model.message': {
        // Continuation frames repeat the id without a name; already-named calls
        // are skipped so one call produces one row.
        const calls = readToolCalls(event).filter((c) => !calledAs.has(c.id));
        for (const call of calls) {
          tools.add(call.name);
          calledAs.set(call.id, qualifyToolCall(call));
        }
        if (calls.length > 0) push('tool', calls.map(qualifyToolCall).join(', '));
        const line = firstLine(event.content);
        if (line) push('thinking', line);
        break;
      }

      case 'tool.response': {
        /*
         * Decoded rather than shown raw.
         *
         * `content` is a string whose kind the harness does not declare. Three
         * shapes turn up in a normal run and only one of them is a result: a
         * tool's own prose, an error envelope with the message nested inside a
         * JSON string, and — when the agent reads its own manual through the
         * harness's `get_tool_info` — an entire tool schema. `firstLine` showed
         * all three identically, so a refusal read exactly like a success and
         * AIRLOCK's own prompt text read like output.
         */
        const decoded = readToolResponse(event.content);
        const called = str(event.tool_call_id) ?? str(event.toolCallId);
        const named = called ? (calledAs.get(called) ?? null) : null;
        // A tool that refused is not a failed *turn* — the agent routinely
        // recovers from one — so the row is marked and the run status is not.
        push(decoded.ok ? 'tool' : 'failed', named ?? 'tool returned', labelToolResponse(decoded, named) || undefined);
        break;
      }

      case 'tool.approval_required': {
        const names = toolNames(event);
        heldOn = names[0] ?? 'a tool';
        status = 'held';
        push('held', `held for a human: ${heldOn}`);
        break;
      }

      case 'tool.response_required':
        status = 'held';
        push('asked', 'asked a human a question');
        break;

      case 'mcp.initialize': {
        const names = serverNames(event);
        for (const name of names) servers.add(name);
        if (names.length > 0) push('connectors', `connected ${names.join(', ')}`);
        break;
      }

      case 'mcp.auth_required':
        status = 'held';
        heldOn = 'mcp authorization';
        push('held', 'held for MCP authorization');
        break;

      case 'sandbox.created':
        push('sandbox', 'sandbox created');
        break;

      case 'turn.done': {
        endedAt = when;
        const pending = requiredActions(event);
        const state = statusOf(event);
        /*
         * A session holds many turns, and the summary describes where it stands
         * now — not the worst thing that ever happened in it.
         *
         * The first run this was checked against had exactly this shape: a turn
         * killed by a 429, then a second turn that succeeded. Carrying the
         * failure forward left `status: 'done'` sitting next to a populated
         * `failure`, which painted a red banner over a run that had recovered.
         * The failed turn keeps its own row in the feed, because that is
         * history and it did happen; the session-level verdict is cleared.
         */
        failure = null;
        if (pending.length > 0) {
          // Paused, not complete. See the note above.
          status = 'held';
          if (!heldOn) heldOn = 'an approval';
          push('held', 'turn paused for a human');
        } else if (state === 'error') {
          status = 'error';
          // Carry the upstream sentence through to the row. It is the whole
          // reason this branch exists, and dropping it was the bug.
          failure = classifyFailure(messageOf(event));
          push('failed', failure ? FAILURE_LABEL[failure.kind] : 'turn failed', failure?.message);
        } else if (state === 'cancelled') {
          status = 'done';
          push('done', 'turn cancelled');
        } else {
          status = 'done';
          push('done', 'turn complete');
        }
        break;
      }

      default:
        break;
    }
  }

  // Lanes are grouped from what actually appeared, because nothing announces
  // them. `main` leads; subagents follow in the order they first spoke.
  const order: string[] = [];
  const byThread = new Map<string, ActivityStep[]>();
  for (const step of steps) {
    if (!byThread.has(step.thread)) {
      byThread.set(step.thread, []);
      order.push(step.thread);
    }
    byThread.get(step.thread)!.push(step);
  }
  order.sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : 0));

  return {
    status,
    heldOn,
    failure,
    lanes: order.map((t) => ({ thread: t, steps: byThread.get(t) ?? [] })),
    steps,
    tools: [...tools],
    servers: [...servers],
    startedAt: steps[0]?.at ?? null,
    endedAt,
  };
}

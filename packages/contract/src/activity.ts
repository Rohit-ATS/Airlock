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
  | 'done';

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

export function summariseEvents(events: readonly SessionEvent[]): ActivitySummary {
  const steps: ActivityStep[] = [];
  const tools = new Set<string>();
  const servers = new Set<string>();

  let status: ActivitySummary['status'] = events.length > 0 ? 'running' : 'idle';
  let heldOn: string | null = null;
  let endedAt: string | null = null;

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

      case 'model.message': {
        const names = toolNames(event);
        for (const name of names) tools.add(name);
        if (names.length > 0) push('tool', names.join(', '));
        const line = firstLine(event.content);
        if (line) push('thinking', line);
        break;
      }

      case 'tool.response': {
        const line = firstLine(event.content);
        push('tool', 'tool returned', line ?? undefined);
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
        if (pending.length > 0) {
          // Paused, not complete. See the note above.
          status = 'held';
          if (!heldOn) heldOn = 'an approval';
          push('held', 'turn paused for a human');
        } else if (state === 'error') {
          status = 'error';
          push('done', 'turn failed');
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
    lanes: order.map((t) => ({ thread: t, steps: byThread.get(t) ?? [] })),
    steps,
    tools: [...tools],
    servers: [...servers],
    startedAt: steps[0]?.at ?? null,
    endedAt,
  };
}

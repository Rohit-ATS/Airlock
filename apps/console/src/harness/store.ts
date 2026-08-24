/**
 * The run store.
 *
 * The event tap lives outside React (it is an async generator inside the server
 * adapter), so the console keeps run state in a small external store and reads
 * it with `useSyncExternalStore`. That avoids threading a setState through the
 * server contract, and keeps a high-frequency stream from re-rendering the
 * whole console on every token delta.
 */
import { HarnessLedger, type HarnessEvent, type RawEvent } from '@airlock/contract';

export interface LaneState {
  threadId: string;
  title: string;
  model: string | null;
  status: 'running' | 'done' | 'error';
  startedAt: string;
  endedAt: string | null;
  /** Tool calls this lane has made, newest last. */
  toolCalls: Array<{ id: string; name: string; server: string | null; at: string }>;
  tokensIn: number;
  tokensOut: number;
}

export interface SandboxLine {
  at: string;
  text: string;
  kind: 'tool' | 'result' | 'system';
}

export interface RunState {
  sessionId: string | null;
  turnId: string | null;
  status: 'idle' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
  startedBy: 'ui' | 'webhook' | 'api';
  lanes: LaneState[];
  connectors: string[];
  sandboxId: string | null;
  sandboxLog: SandboxLine[];
  harnessEvents: HarnessEvent[];
  freshCapability: number | null;
  costUsd: number;
  tokens: { input: number; output: number; total: number };
  models: string[];
  /** Set when the turn ended holding for a human. */
  pausedOn: 'approval' | 'question' | 'mcp-auth' | null;
  lastEventAt: string | null;
  /** Incremented on every stream reattach, which is what failover looks like. */
  reconnects: number;
}

function emptyRun(): RunState {
  return {
    sessionId: null,
    turnId: null,
    status: 'idle',
    startedBy: 'ui',
    lanes: [],
    connectors: [],
    sandboxId: null,
    sandboxLog: [],
    harnessEvents: [],
    freshCapability: null,
    costUsd: 0,
    tokens: { input: 0, output: 0, total: 0 },
    models: [],
    pausedOn: null,
    lastEventAt: null,
    reconnects: 0,
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const pick = (e: Record<string, unknown>, camel: string, snake: string): unknown =>
  e[camel] !== undefined ? e[camel] : e[snake];

export class RunStore {
  /** The ledger is the only thing that can light a lamp. */
  readonly ledger = new HarnessLedger();
  private state: RunState = emptyRun();
  private listeners = new Set<() => void>();
  private freshTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): RunState => this.state;

  private commit(next: Partial<RunState>) {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn();
  }

  reset(startedBy: RunState['startedBy'] = 'ui') {
    this.state = { ...emptyRun(), startedBy };
    for (const fn of this.listeners) fn();
  }

  noteStreamOpen(sessionId: string, resumed: boolean) {
    this.commit({
      sessionId,
      status: 'running',
      pausedOn: null,
      reconnects: resumed ? this.state.reconnects + 1 : this.state.reconnects,
    });
  }

  noteStreamClose(error?: unknown) {
    if (error) this.commit({ status: 'error' });
  }

  /**
   * Prove a capability that is established by configuration or by observable
   * runtime behaviour rather than by a stream event. The caller must supply the
   * real evidence string — there is no default, so a lamp cannot be lit by
   * writing `proveOutOfBand(n)` and hoping nobody checks.
   */
  prove(capability: number, evidence: string, detail?: string) {
    const he = this.ledger.proveOutOfBand(capability, evidence, detail);
    if (!he) return;
    this.commit({ harnessEvents: this.ledger.events() });
    this.flash(capability);
  }

  private flash(capability: number) {
    this.state = { ...this.state, freshCapability: capability };
    for (const fn of this.listeners) fn();
    if (this.freshTimer) clearTimeout(this.freshTimer);
    this.freshTimer = setTimeout(() => {
      this.state = { ...this.state, freshCapability: null };
      for (const fn of this.listeners) fn();
    }, 700);
  }

  /** The single entry point for real harness events. */
  ingest(event: RawEvent) {
    const type = event.type;
    const at = str(pick(event, 'createdAt', 'created_at')) ?? new Date().toISOString();
    const threadId = str(pick(event, 'threadId', 'thread_id')) ?? null;
    const next: Partial<RunState> = { lastEventAt: at };

    switch (type) {
      case 'turn.created': {
        next.turnId = str(pick(event, 'turnId', 'turn_id')) ?? null;
        next.status = 'running';
        next.pausedOn = null;
        break;
      }

      case 'mcp.initialize': {
        const names = arr(pick(event, 'mcpServers', 'mcp_servers'))
          .map((s) => str(rec(s).name))
          .filter((n): n is string => Boolean(n));
        if (names.length) {
          next.connectors = [...new Set([...this.state.connectors, ...names])];
        }
        break;
      }

      case 'sandbox.created': {
        const id = str(pick(event, 'sandboxId', 'sandbox_id')) ?? null;
        next.sandboxId = id;
        next.sandboxLog = [
          ...this.state.sandboxLog,
          { at, kind: 'system', text: `sandbox provisioned${id ? ` · ${id}` : ''}` },
        ];
        break;
      }

      case 'thread.created': {
        const info = rec(pick(event, 'agentInfo', 'agent_info'));
        const model = str(info.model) ?? null;
        const lane: LaneState = {
          threadId: threadId ?? `t${this.state.lanes.length}`,
          title: str(event.title) ?? str(info.name) ?? 'subagent',
          model,
          status: 'running',
          startedAt: at,
          endedAt: null,
          toolCalls: [],
          tokensIn: 0,
          tokensOut: 0,
        };
        next.lanes = [...this.state.lanes, lane];
        if (model) next.models = [...new Set([...this.state.models, model])];
        break;
      }

      case 'thread.done': {
        const st = rec(event.state);
        const status = str(st.status) === 'error' ? 'error' : 'done';
        next.lanes = this.state.lanes.map((l) =>
          l.threadId === threadId ? { ...l, status: status as LaneState['status'], endedAt: at } : l,
        );
        break;
      }

      case 'model.message': {
        const usage = rec(event.usage);
        const inTok = num(pick(usage, 'inputTokens', 'input_tokens')) ?? 0;
        const outTok = num(pick(usage, 'outputTokens', 'output_tokens')) ?? 0;
        if (inTok || outTok) {
          next.tokens = {
            input: this.state.tokens.input + inTok,
            output: this.state.tokens.output + outTok,
            total: this.state.tokens.total + inTok + outTok,
          };
          if (threadId) {
            next.lanes = (next.lanes ?? this.state.lanes).map((l) =>
              l.threadId === threadId ? { ...l, tokensIn: l.tokensIn + inTok, tokensOut: l.tokensOut + outTok } : l,
            );
          }
        }

        const calls = arr(pick(event, 'toolCalls', 'tool_calls'));
        if (calls.length) {
          const logged: SandboxLine[] = [];
          const laneAdds: Array<{ id: string; name: string; server: string | null; at: string }> = [];
          for (const c of calls) {
            const call = rec(c);
            const fn = rec(call.function);
            const name = str(fn.name) ?? 'tool';
            const info = rec(pick(call, 'toolInfo', 'tool_info'));
            const server = str(pick(info, 'serverName', 'server_name')) ?? null;
            const id = str(call.id) ?? name;
            laneAdds.push({ id, name, server, at });
            logged.push({ at, kind: 'tool', text: `${server ? `${server}·` : ''}${name}` });
          }
          if (threadId) {
            const base = next.lanes ?? this.state.lanes;
            next.lanes = base.map((l) =>
              l.threadId === threadId ? { ...l, toolCalls: [...l.toolCalls, ...laneAdds] } : l,
            );
          }
          next.sandboxLog = [...this.state.sandboxLog, ...logged].slice(-400);
        }
        break;
      }

      case 'tool.response': {
        const content = str(event.content) ?? '';
        if (content) {
          const line: SandboxLine = {
            at,
            kind: 'result',
            text: content.length > 220 ? `${content.slice(0, 220)}…` : content,
          };
          next.sandboxLog = [...(next.sandboxLog ?? this.state.sandboxLog), line].slice(-400);
        }
        break;
      }

      case 'tool.approval_required':
        next.pausedOn = 'approval';
        break;

      case 'tool.response_required':
        next.pausedOn = 'question';
        break;

      case 'mcp.auth_required':
        next.pausedOn = 'mcp-auth';
        break;

      case 'turn.done': {
        const st = rec(event.state);
        const status = str(st.status) ?? 'done';
        const required = arr(pick(st, 'requiredActions', 'required_actions'));
        const metrics = rec(st.metrics);
        const cost = num(pick(metrics, 'totalCostInUsd', 'total_cost_in_usd'));
        if (cost !== undefined) next.costUsd = this.state.costUsd + cost;
        const total = num(pick(metrics, 'totalTokens', 'total_tokens'));
        if (total !== undefined) {
          const t = next.tokens ?? this.state.tokens;
          next.tokens = { ...t, total: Math.max(t.total, total) };
        }

        if (required.length > 0) {
          // A `done` turn carrying requiredActions is paused, not complete.
          next.status = 'paused';
          const kinds = required.map((r) => str(rec(r).type) ?? '');
          next.pausedOn = kinds.some((k) => k.includes('approval'))
            ? 'approval'
            : kinds.some((k) => k.includes('response'))
              ? 'question'
              : kinds.some((k) => k.includes('auth'))
                ? 'mcp-auth'
                : this.state.pausedOn;
        } else if (status === 'cancelled') {
          next.status = 'cancelled';
        } else if (status === 'error') {
          next.status = 'error';
        } else {
          next.status = 'done';
          next.pausedOn = null;
        }
        // Any still-open lane is finished when the turn is.
        next.lanes = (next.lanes ?? this.state.lanes).map((l) =>
          l.status === 'running' ? { ...l, status: 'done', endedAt: at } : l,
        );
        break;
      }

      default:
        break;
    }

    // Light lamps from the same event, via the ledger and nothing else.
    const fresh = this.ledger.observe(event);
    if (fresh.length > 0) {
      next.harnessEvents = this.ledger.events();
    }

    this.commit(next);
    if (fresh.length > 0) this.flash(fresh[fresh.length - 1]!.capability);
  }
}

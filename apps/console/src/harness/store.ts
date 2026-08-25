/**
 * The run store.
 *
 * The event tap lives outside React (it is an async generator inside the server
 * adapter), so the console keeps run state in a small external store and reads
 * it with `useSyncExternalStore`. That avoids threading a setState through the
 * server contract, and keeps a high-frequency stream from re-rendering the
 * whole console on every token delta.
 */
import {
  DEFAULT_POLICY,
  HarnessLedger,
  assessBudget,
  type BudgetPolicy,
  type BudgetVerdict,
  type HarnessEvent,
  type RawEvent,
  type StopCause,
} from '@airlock/contract';

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
  /**
   * The TrueForge event id this line was produced from.
   *
   * This is what makes a figure on the certificate clickable. A capability lamp
   * and a log line derived from the same event carry the same id, so pressing
   * "4.2s lock" can scroll the log to the line that produced it rather than
   * gesturing vaguely at a panel. Null when the harness sent no id — which is
   * rendered as "no anchor" rather than papered over with a guess.
   */
  stepId: string | null;
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
  /**
   * True between a human pressing ABORT and the harness confirming it.
   *
   * A cancel has to cross to whichever replica is doing the work, so there is a
   * real gap here. Showing it is the difference between a control that feels
   * broken and one that is visibly working.
   */
  aborting: boolean;
  /**
   * Why the run stopped, when it did.
   *
   * A cancelled turn is otherwise indistinguishable from one a person
   * cancelled, and those are very different facts to find in a log a week
   * later: one is an operator making a judgement call, the other is a ceiling
   * nobody has raised yet.
   */
  stopCause: StopCause | null;
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
    aborting: false,
    stopCause: null,
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
    // A new run gets the whole budget. The ceiling is per run, not per session.
    this.breached = false;
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

  /** A human pressed ABORT; the harness has not confirmed yet. */
  noteAborting(cause: StopCause = 'human') {
    this.commit({ aborting: true, stopCause: cause });
  }

  /* ------------------------------------------------------------------------ */
  /* The budget cap                                                           */
  /* ------------------------------------------------------------------------ */

  private budget: BudgetPolicy = DEFAULT_POLICY.budget;
  private onBreach: ((verdict: BudgetVerdict) => void) | null = null;
  private breached = false;

  /**
   * Install the ceiling and the thing to do about it.
   *
   * The handler is injected rather than imported because the store must not
   * know how to talk to the harness — the cancel call belongs to the shell,
   * which owns the server adapter. Keeping the store ignorant of transport is
   * also what lets the budget be tested without a network.
   */
  configureBudget(budget: BudgetPolicy, onBreach: (verdict: BudgetVerdict) => void) {
    this.budget = budget;
    this.onBreach = onBreach;
  }

  /** Where this run stands. The same computation the badge renders. */
  budgetVerdict(): BudgetVerdict {
    return assessBudget({ usd: this.state.costUsd, tokens: this.state.tokens.total }, this.budget);
  }

  /**
   * Stop the run if it has reached its ceiling.
   *
   * Fires once per run — `breached` is not a debounce but a correctness
   * requirement: cost arrives on every `turn.done`, and without it a run that
   * ends over budget would issue a cancel for each subsequent event.
   *
   * A run that is already finished is not cancelled. Reaching the ceiling on
   * the final event of a completed turn is a fact to report, not a turn to kill
   * — and issuing a cancel against a finished session would produce an error
   * that looks like the budget failing when it did exactly its job.
   */
  private enforceBudget() {
    if (this.breached) return;
    const verdict = this.budgetVerdict();
    if (!verdict.shouldStop) return;

    this.breached = true;
    const live = this.state.status === 'running' || this.state.status === 'paused';
    if (!live) return;

    this.commit({ aborting: true, stopCause: 'budget' });
    this.onBreach?.(verdict);
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
    // The same id the harness ledger stamps onto a capability proof, so a claim
    // on the certificate and the log line behind it can be joined.
    const stepId = str(event.id) ?? null;
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
          { at, kind: 'system', text: `sandbox provisioned${id ? ` · ${id}` : ''}`, stepId },
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
            logged.push({ at, kind: 'tool', text: `${server ? `${server}·` : ''}${name}`, stepId });
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
            stepId,
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
          next.aborting = false;
        } else if (status === 'error') {
          next.status = 'error';
        } else {
          next.status = 'done';
          next.pausedOn = null;
        }
        next.aborting = false;
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

    // Checked after the commit, so the ceiling is evaluated against the spend
    // the console is actually displaying rather than the one it is about to.
    this.enforceBudget();

    if (fresh.length > 0) this.flash(fresh[fresh.length - 1]!.capability);
  }
}

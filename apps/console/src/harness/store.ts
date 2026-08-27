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
  classifyFailure,
  labelToolResponse,
  qualifyToolCall,
  readToolCalls,
  readToolResponse,
  type BudgetPolicy,
  type BudgetVerdict,
  type HarnessEvent,
  type RawEvent,
  type StopCause,
  type TurnFailure,
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
  /**
   * `error` is separate from `result` because the harness does not distinguish
   * them on the wire — a refusal arrives as an ordinary `tool.response` whose
   * content happens to be an error envelope. Rendered in the same grey as a
   * success, which is what used to happen, a failing run announced itself in a
   * way nobody could see.
   */
  kind: 'tool' | 'result' | 'error' | 'system';
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
  /**
   * Why the run failed, when it did.
   *
   * The harness reports a dead turn as `turn.done` with `state.status: "error"`
   * and a message naming the cause. This used to be read for the status and
   * thrown away, which is how a run killed by a provider rate limit rendered as
   * a red dot over an unfinished transcript with nothing on screen to say so.
   * The message is the whole diagnosis; it is kept.
   *
   * Classified by the same function `/api/activity` uses, deliberately. The
   * DOING lane shows this store's view for a turn posted from this tab and the
   * polled feed's view for every other run — two panels a foot apart that
   * bucketed the same provider error differently would be a defect nobody could
   * unsee.
   */
  failure: TurnFailure | null;
  /**
   * When the harness reported the failure.
   *
   * Separate from the failure because `TurnFailure` is about the provider and
   * this is about our clock. It is what the retry countdown is measured from —
   * counting from render instead would restart the wait every time the banner
   * re-rendered and make the operator serve the sentence twice.
   */
  failureAt: string | null;
  /**
   * What the operator asked for, so a run that died for a reason nobody chose
   * can be offered back without retyping it.
   */
  prompt: string | null;
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
    failure: null,
    failureAt: null,
    prompt: null,
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

  /**
   * Tool call id → the name that call was made under.
   *
   * Outside `RunState` on purpose: it is bookkeeping for rendering, not run
   * state, and putting it in the snapshot would make every tool call a new
   * object identity for `useSyncExternalStore` to re-render on.
   */
  private toolCallNames = new Map<string, string>();

  reset(startedBy: RunState['startedBy'] = 'ui') {
    this.state = { ...emptyRun(), startedBy };
    // A new run gets the whole budget. The ceiling is per run, not per session.
    this.breached = false;
    // Ids are unique per run; keeping them would only leak.
    this.toolCallNames.clear();
    for (const fn of this.listeners) fn();
  }

  noteStreamOpen(sessionId: string, resumed: boolean, prompt?: string | null) {
    this.commit({
      sessionId,
      status: 'running',
      pausedOn: null,
      reconnects: resumed ? this.state.reconnects + 1 : this.state.reconnects,
      // A new attempt clears the last one's verdict. Leaving a stale banner up
      // over a run that is visibly working is worse than never having shown it.
      failure: null,
      failureAt: null,
      // A resume carries no request of its own, so it must not erase the one
      // the retry button is holding on behalf of the turn that failed.
      prompt: prompt ?? (resumed ? this.state.prompt : null),
    });
  }

  noteStreamClose(error?: unknown) {
    if (!error) return;
    /*
     * The stream died between here and the harness.
     *
     * Deliberately reported as the transport failure it is, in the harness's
     * own words, rather than promoted to a turn failure — the executor may well
     * still be working, and a console that announces "the run failed" when what
     * broke was this browser's connection is lying about production.
     */
    const message = error instanceof Error ? error.message : String(error);
    this.commit({
      status: 'error',
      aborting: false,
      failure: {
        kind: 'UNKNOWN',
        message: `The console lost its connection to the harness — ${message}. The run may still be going on the server.`,
        retryAfterSeconds: null,
      },
      failureAt: new Date().toISOString(),
    });
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
        next.failure = null;
        next.failureAt = null;
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

      /*
       * Both spellings of a model turn, because the two surfaces disagree.
       *
       * A streamed `model.message` carries no `tool_calls` at all — the calls
       * arrive on `model.message.delta`, whose first frame per call holds the
       * id, the name and the server. Only the *stored* events put them on
       * `model.message`. This store is fed the live stream, so for as long as
       * it watched `model.message` alone it never saw a single tool call:
       * the sandbox log showed responses with nothing above them and every lane
       * reported zero calls. Both are read, and `toolCallNames` deduplicates,
       * so folding either surface — or both — gives the same log.
       */
      case 'model.message.delta':
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

        // Continuation frames stream argument fragments under the same call id.
        // Already-seen ids are dropped so one call logs one line.
        const calls = readToolCalls(event).filter((c) => !this.toolCallNames.has(c.id));
        if (calls.length) {
          const logged: SandboxLine[] = [];
          const laneAdds: Array<{ id: string; name: string; server: string | null; at: string }> = [];
          for (const call of calls) {
            laneAdds.push({ id: call.id, name: call.name, server: call.server, at });
            // Remembered so the *response* can name the call it answers.
            // `tool.response` carries only `tool_call_id`, so a log that does
            // not keep this can never say more than "tool returned" — at
            // exactly the moment an operator is trying to work out which of
            // eight calls went wrong.
            this.toolCallNames.set(call.id, qualifyToolCall(call));
            logged.push({ at, kind: 'tool', text: qualifyToolCall(call), stepId });
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
          /*
           * Decoded, not dumped.
           *
           * `content` is a string and the harness does not say which kind: a
           * tool's own prose, an error envelope with the message nested two
           * levels down inside a JSON string, or — when the agent is reading
           * its own manual through `get_tool_info` — a whole tool schema. Shown
           * raw and clipped at 220 characters, the last of those filled the log
           * with AIRLOCK's own prompt text, which reads to anyone watching as
           * though the run is broken.
           */
          const decoded = readToolResponse(content);
          const called = str(pick(event, 'toolCallId', 'tool_call_id'));
          const line: SandboxLine = {
            at,
            kind: decoded.ok ? 'result' : 'error',
            text: labelToolResponse(decoded, called ? this.toolCallNames.get(called) : null),
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
          /*
           * Verbatim from the harness, classified only so the console knows
           * whether a retry could possibly work. Never rewritten.
           *
           * The harness is not obliged to send a message, and a missing reason
           * must not become a missing banner — that is the exact failure this
           * whole path exists to remove. So an unexplained error still gets a
           * failure, one that says plainly that no reason was given rather than
           * inventing a plausible one.
           */
          next.failure = classifyFailure(str(st.message) ?? null) ?? {
            kind: 'UNKNOWN',
            message: 'The harness ended this turn with an error and gave no reason.',
            retryAfterSeconds: null,
          };
          next.failureAt = at;
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

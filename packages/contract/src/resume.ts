/**
 * Finishing a run the provider interrupted.
 *
 * `activity.ts` answers *why did this turn die* and the console renders that
 * answer with a retry button beside it. That is the right screen for a person
 * sitting in front of the console. It is the wrong answer for the runs AIRLOCK
 * is actually about.
 *
 * The whole argument of this product is that nobody types anything: a webhook
 * opens a session on a pull request, the agent investigates, and a human is
 * asked exactly once, at the end, with evidence in hand. There is no operator
 * watching those runs, so a retry button on a screen nobody has open is not a
 * recovery path — it is a red light in an empty room. And the run dies for a
 * reason that has nothing to do with the change:
 *
 *     turn.done  state.status = "error"
 *     "Request failed (429): Rate limit reached for gpt-4.1 in organization
 *      org-… on tokens per min (TPM): Limit 30000, Used 26713, Requested 7669.
 *      Please try again in 8.764s."
 *
 * That is not an edge case, it is the expected outcome. One iteration of the
 * change-control agent costs about 8.1k input tokens — measured off a real turn
 * record: 4.4k of tool definitions, 1.9k of instructions, 1.8k of harness
 * scaffolding — and iterations run roughly a second apart. Against a rolling
 * 30k-per-minute ceiling the window is spent around the fourth iteration and
 * the provider refuses the fifth. The harness does not retry; it reports the
 * refusal as the terminal state of the turn and stops.
 *
 * What that costs is the entire product. The dossier stays sealed, no
 * certificate is ever attached, nobody is ever asked, and the change sits in
 * the queue looking like work in progress. A control plane that gives up
 * halfway and says nothing is worse than one that never started, because the
 * operator believes the change is being handled.
 *
 * So where the provider itself said "try again in 8.764s", we believe it and
 * try again. Resuming is safe and cheap here because TrueForge chains turns
 * automatically — a new turn with **empty input** continues the same
 * conversation from where it stopped, with no history resent. Verified against
 * 0.1.4 on a turn that had died mid-run: it went straight on to
 * `airlock_open_change`, then `airlock_resolve_context`, and finished.
 *
 * Three rules hold this honest, and all three are enforced here rather than in
 * the callers, because there are four callers and only one of them is watched:
 *
 *   1. **A pause is never resumed.** A turn holding for a human carries
 *      `required_actions`, and resuming it would answer on that human's behalf
 *      — the one thing AIRLOCK must never do. `readTurnState` checks this
 *      first, unconditionally, before it looks at anything else.
 *   2. **Only retryable failures are resumed**, by `isRetryable` — the same
 *      predicate the console's retry button uses. Two different answers to
 *      "could this work a second time" is a defect waiting to happen.
 *   3. **Every resume is counted and bounded.** Attempts, per-wait and total
 *      wait all have ceilings, so a provider outage costs a bounded delay and
 *      then an honest error, never an unbounded loop against a wall.
 *
 * Pure on purpose: no fetch, no timers, no harness. The driving loops live in
 * the console and in `scripts/`, and they are thin because everything worth
 * getting wrong is decided here, where it can be tested without a network.
 */
import { classifyFailure, isRetryable, type TurnFailure } from './activity.js';

/* -------------------------------------------------------------------------- */
/* How a turn ended                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The end of a turn, including the two endings that are not failures.
 *
 * `held` is a member so that no caller can accidentally treat "stopped for a
 * human" as an error condition. It is the success case this product exists to
 * produce.
 */
export type TurnOutcome =
  | { state: 'running' }
  | { state: 'complete' }
  | { state: 'cancelled' }
  | { state: 'held'; actions: string[] }
  | { state: 'failed'; failure: TurnFailure };

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Read a turn's `state`, from `turn.done` or from `GET /turns/{id}`.
 *
 * One function for both because the supervisor polls turn records and never
 * sees events, while the console sees events and never polls — and the two
 * disagreeing about what "held" means would be a bug that only appears when
 * nobody is watching.
 *
 * Both spellings of `required_actions` are read, the same way the detectors do.
 * Betting on one and silently reading `undefined` here would mean resuming a
 * run that is waiting for an approval, which is the worst outcome available.
 */
export function readTurnState(raw: unknown): TurnOutcome {
  const state = obj(raw);

  const actions = arr(state.required_actions ?? state.requiredActions)
    .map((a) => str(obj(a).type) ?? '')
    .filter(Boolean);
  if (actions.length > 0) return { state: 'held', actions };

  const status = str(state.status);
  if (status === null || status === 'running' || status === 'pending' || status === 'queued') {
    return { state: 'running' };
  }
  if (status === 'cancelled' || status === 'canceled') return { state: 'cancelled' };
  if (status !== 'error' && status !== 'failed') return { state: 'complete' };

  const message =
    str(state.message) ??
    str(obj(state.error).message) ??
    str(state.error) ??
    // Said plainly rather than dressed up. This string is what an operator
    // reads in a run log at 2am, and "no reason given" is more useful to them
    // than a plausible cause we invented. It also classifies as UNKNOWN, which
    // `isRetryable` refuses — an error nobody can name is not one to repeat.
    'The harness ended this turn with an error and gave no reason.';

  return { state: 'failed', failure: classifyFailure(message)! };
}

/* -------------------------------------------------------------------------- */
/* Whether to go again                                                        */
/* -------------------------------------------------------------------------- */

export interface ResumePolicy {
  /** How many resume turns may be created for one run. */
  maxAttempts: number;
  /** Never wait less than this, even when the provider says to try immediately. */
  minDelayMs: number;
  /** Never wait longer than this for any single attempt. */
  maxDelayMs: number;
  /** Give up once accumulated waiting reaches this, however many attempts remain. */
  maxTotalWaitMs: number;
  /**
   * Multiply the provider's own interval by this before waiting.
   *
   * Retrying at exactly the stated instant hands the same oversized request to
   * a rolling window that has only just refilled, and the second refusal costs
   * another round trip plus a log line that reads as though the fix did not
   * work. A third of the interval again is cheap insurance.
   */
  hintPadding: number;
}

/**
 * Tuned for the failure this exists to survive: an 8-to-14 second 429 against a
 * 30k-per-minute ceiling, arriving several times across one long run.
 *
 * Six attempts and five minutes of total waiting is enough to carry a normal
 * change-control run through the throttling it will meet, and little enough
 * that a genuine provider outage surfaces as an error inside a coffee break
 * rather than tying up a session for an afternoon.
 */
export const DEFAULT_RESUME_POLICY: ResumePolicy = {
  maxAttempts: 6,
  minDelayMs: 1_000,
  maxDelayMs: 60_000,
  maxTotalWaitMs: 300_000,
  hintPadding: 1.35,
};

export interface ResumeState {
  /** Resume turns already created for this run. */
  attempts: number;
  /** Milliseconds already spent waiting between them. */
  waitedMs: number;
}

export const NO_RESUMES: ResumeState = { attempts: 0, waitedMs: 0 };

export type ResumePlan =
  | { resume: true; delayMs: number; attempt: number; reason: string }
  | { resume: false; reason: string };

/**
 * How long to wait before attempt `n`.
 *
 * The provider's own interval wins wherever there is one, because it is the
 * only party that knows when its window refills; guessing with a fixed backoff
 * means either waiting far too long or spending a round trip to be refused
 * again. Where there is none, exponential backoff from `minDelayMs`.
 *
 * Jitter is added in both cases and is injectable, so the tests can assert an
 * exact number rather than a range — a backoff whose only assertion is "it
 * returned something plausible" is not tested.
 */
export function resumeDelayMs(
  failure: TurnFailure,
  attempt: number,
  policy: ResumePolicy = DEFAULT_RESUME_POLICY,
  jitter: () => number = Math.random,
): number {
  const n = Math.max(1, Math.floor(attempt));
  const hintMs = failure.retryAfterSeconds !== null ? failure.retryAfterSeconds * 1000 : null;
  const base = hintMs !== null ? hintMs * policy.hintPadding + 500 : policy.minDelayMs * 2 ** (n - 1);

  const clamped = Math.min(policy.maxDelayMs, Math.max(policy.minDelayMs, base));
  // Spread concurrent runs, so a shared quota is not re-exhausted in lockstep
  // by every session in the queue resuming on the same tick.
  const spread = Math.min(clamped * 0.25, 2_000) * jitter();
  return Math.round(Math.min(policy.maxDelayMs, clamped + spread));
}

/**
 * The single decision: go again, or stop and say why.
 *
 * Every `reason` is a finished sentence, because it is written into the run log
 * and shown in the console verbatim. An operator reading `maxAttempts` has been
 * handed a variable name; an operator reading "Gave up after 6 resumes" has
 * been told what happened.
 */
export function planResume(
  failure: TurnFailure,
  state: ResumeState = NO_RESUMES,
  policy: ResumePolicy = DEFAULT_RESUME_POLICY,
  jitter: () => number = Math.random,
): ResumePlan {
  if (!isRetryable(failure)) {
    return { resume: false, reason: `Not retryable — ${failure.message}` };
  }

  const attempt = state.attempts + 1;
  if (attempt > policy.maxAttempts) {
    return {
      resume: false,
      reason: `Gave up after ${policy.maxAttempts} resume${policy.maxAttempts === 1 ? '' : 's'}. Last failure: ${failure.message}`,
    };
  }

  const delayMs = resumeDelayMs(failure, attempt, policy, jitter);
  if (state.waitedMs + delayMs > policy.maxTotalWaitMs) {
    return {
      resume: false,
      reason: `Gave up after waiting ${Math.round(state.waitedMs / 1000)}s in total. Last failure: ${failure.message}`,
    };
  }

  return {
    resume: true,
    delayMs,
    attempt,
    reason:
      failure.kind === 'RATE_LIMITED'
        ? `Rate limited by the model provider — resuming in ${formatDelay(delayMs)} (attempt ${attempt} of ${policy.maxAttempts}).`
        : `The model provider errored — resuming in ${formatDelay(delayMs)} (attempt ${attempt} of ${policy.maxAttempts}).`,
  };
}

/** `750ms`, `8.8s`, `2m 5s` — short enough for a status line. */
export function formatDelay(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * The input that resumes a chained turn.
 *
 * Empty, and that is the entire point: TrueForge chains turns automatically
 * (`previous_turn_id` defaults to `"auto"`), so history must never be resent —
 * resending it would double the input tokens of the very request that was just
 * refused for size. Named rather than written as `[]` at three call sites,
 * because "why is this empty" is the first question every reader asks and the
 * answer belongs next to the value.
 */
export const RESUME_INPUT: readonly never[] = [];

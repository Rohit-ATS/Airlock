import {
  DEFAULT_RESUME_POLICY,
  NO_RESUMES,
  RESUME_INPUT,
  planResume,
  readTurnState,
  type ResumePolicy,
  type ResumeState,
  type TurnOutcome,
} from '@airlock/contract';
import { trueforgeBaseUrl } from '@/data/env';

/**
 * Driving a turn that nobody is watching.
 *
 * The webhook path is the one AIRLOCK's argument depends on: a pull request
 * touching `migrations/` opens a session, the agent investigates, and a human
 * is asked once, at the end, with a certificate in hand. Nobody is sitting in
 * front of the console while that happens — that is the point.
 *
 * Which is why the old shape of this was quietly fatal. `openHarnessSession`
 * posted the turn, returned the session id, and never looked again. When the
 * turn died on an OpenAI 429 — which it does, reliably, around the fourth
 * iteration against a 30k-per-minute ceiling — the dossier stayed sealed, no
 * certificate was ever attached, nobody was ever asked, and the change sat in
 * the queue looking exactly like work in progress. The console's retry button
 * is the right control for a run somebody launched by hand; for these runs it
 * is a red light in an empty room.
 *
 * So the run is supervised. The turn is polled to its terminal state, and where
 * the provider itself said "try again in 8.764s", the run is resumed with an
 * empty-input turn — which TrueForge chains onto the same conversation, no
 * history resent. Everything about *whether* to resume is decided by
 * `planResume` in the contract package, where it is tested without a network;
 * this file is only the loop and the fetches.
 *
 * Two properties matter more than anything else here:
 *
 *   - **A turn holding for a human is never resumed.** `readTurnState` reports
 *     `held` before it reports anything else, and `held` ends the supervision
 *     as a success. Resuming a run that is waiting for an approval would answer
 *     on the approver's behalf, which is the single thing this product exists
 *     to prevent.
 *   - **It cannot wedge the caller.** The supervisor is detached deliberately:
 *     the webhook answers GitHub in milliseconds, and the run continues on the
 *     server. Every await has a timeout and the whole loop has a deadline.
 */

const BASE_URL = trueforgeBaseUrl();

/** A single HTTP call to the harness must not hang a supervisor for minutes. */
const REQUEST_TIMEOUT_MS = 15_000;

/** How often to ask whether the turn has finished. */
const POLL_INTERVAL_MS = 2_000;

/**
 * The outer bound on one supervised run.
 *
 * A change-control run that has not reached a human in twenty minutes has a
 * problem no amount of retrying will fix, and a supervisor that never gives up
 * is a leak with a schedule.
 */
const RUN_DEADLINE_MS = 20 * 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function log(sessionId: string, message: string): void {
  // stdout, so it lands in `.airlock-logs/console.log` next to everything else
  // the console says about a run. An unattended recovery that leaves no trace
  // is indistinguishable from one that never happened.
  console.info(`[airlock:run ${sessionId.slice(0, 10)}] ${message}`);
}

async function call(path: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(new URL(path, BASE_URL), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch {
    // A harness that is unreachable is a state to handle, not an exception to
    // throw at a webhook handler that has already answered GitHub.
    return null;
  }
}

/** The HTTP surface wraps in `data`; the SDK does not. Read both. */
function unwrap(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as { data?: unknown };
  const inner = body.data && typeof body.data === 'object' ? body.data : payload;
  return inner as Record<string, unknown>;
}

export interface StartedTurn {
  sessionId: string;
  turnId: string | null;
}

/** Open a session against the registered agent. */
export async function openSession(agentName: string): Promise<string | null> {
  const created = unwrap(await call('/api/v1/sessions', { method: 'POST', body: JSON.stringify({ agent: { name: agentName } }) }));
  const id = created?.id;
  return typeof id === 'string' ? id : null;
}

/**
 * Post a turn and return immediately.
 *
 * Non-streaming on purpose: the caller is a webhook handler, and if this
 * blocked until the agent finished, GitHub would time the delivery out and the
 * trigger would look flaky rather than asynchronous.
 */
export async function startTurn(sessionId: string, message: string): Promise<string | null> {
  const started = unwrap(
    await call(`/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: [{ type: 'user.message', content: message }], stream: false }),
    }),
  );
  const id = started?.id;
  return typeof id === 'string' ? id : null;
}

/** Continue a chained conversation. Carries no input; see `RESUME_INPUT`. */
async function resumeTurn(sessionId: string): Promise<string | null> {
  const started = unwrap(
    await call(`/api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input: RESUME_INPUT, stream: false }),
    }),
  );
  const id = started?.id;
  return typeof id === 'string' ? id : null;
}

async function readTurn(sessionId: string, turnId: string): Promise<TurnOutcome> {
  const turn = unwrap(
    await call(`/api/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}`),
  );
  // A turn we cannot read is not a turn that failed. Reporting `running` keeps
  // the supervisor polling through a blip instead of declaring a healthy run
  // dead because one request timed out; the deadline still bounds it.
  return turn ? readTurnState(turn.state) : { state: 'running' };
}

export interface SupervisedRun {
  /** How the run actually ended. */
  outcome: TurnOutcome['state'] | 'abandoned';
  /** Resume turns created. Zero on a run that never needed one. */
  resumes: number;
  /** The last thing worth saying about it, for the log. */
  reason: string;
}

/**
 * Poll a turn to its end, resuming it where the provider asked us to.
 *
 * Returns rather than throws, always: this is called detached, and an
 * unhandled rejection in a background task is a process-level event for
 * something that is, at worst, one unfinished change.
 */
export async function superviseRun(
  sessionId: string,
  firstTurnId: string,
  policy: ResumePolicy = DEFAULT_RESUME_POLICY,
): Promise<SupervisedRun> {
  const startedAt = Date.now();
  let turnId = firstTurnId;
  let state: ResumeState = NO_RESUMES;

  while (Date.now() - startedAt < RUN_DEADLINE_MS) {
    const outcome = await readTurn(sessionId, turnId);

    if (outcome.state === 'running') {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (outcome.state === 'held') {
      // The whole product, in one branch. This is a finished run.
      log(sessionId, `held for a human (${outcome.actions.join(', ')}) after ${state.attempts} resume(s)`);
      return { outcome: 'held', resumes: state.attempts, reason: 'The run is waiting for a person.' };
    }

    if (outcome.state === 'complete' || outcome.state === 'cancelled') {
      log(sessionId, `${outcome.state} after ${state.attempts} resume(s)`);
      return { outcome: outcome.state, resumes: state.attempts, reason: `The turn ended ${outcome.state}.` };
    }

    const plan = planResume(outcome.failure, state, policy);
    if (!plan.resume) {
      log(sessionId, `giving up — ${plan.reason}`);
      return { outcome: 'failed', resumes: state.attempts, reason: plan.reason };
    }

    log(sessionId, plan.reason);
    await sleep(plan.delayMs);

    const next = await resumeTurn(sessionId);
    if (!next) {
      // The harness refused the resume itself. Reported honestly rather than
      // retried in a tighter loop against something that is already saying no.
      log(sessionId, 'the harness refused the resume turn');
      return {
        outcome: 'failed',
        resumes: state.attempts,
        reason: `The harness would not accept a resume. Last failure: ${outcome.failure.message}`,
      };
    }

    turnId = next;
    state = { attempts: plan.attempt, waitedMs: state.waitedMs + plan.delayMs };
  }

  log(sessionId, `abandoned after ${Math.round(RUN_DEADLINE_MS / 60_000)} minutes`);
  return {
    outcome: 'abandoned',
    resumes: state.attempts,
    reason: 'The run did not reach a human within the supervision window.',
  };
}

/**
 * Supervise in the background, without making the caller wait or handle it.
 *
 * The promise is deliberately kept in a module-level set. A floating promise is
 * eligible for collection in some runtimes, and a supervisor that is collected
 * mid-wait fails in the most confusing way available: intermittently, only
 * under load, and only for runs nobody was watching.
 */
const running = new Set<Promise<unknown>>();

export function superviseInBackground(sessionId: string, turnId: string): void {
  const task = superviseRun(sessionId, turnId)
    .catch((error: unknown) => {
      log(sessionId, `supervisor crashed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      running.delete(task);
    });
  running.add(task);
}

/** How many runs are being supervised right now. For the health route. */
export function supervisedCount(): number {
  return running.size;
}

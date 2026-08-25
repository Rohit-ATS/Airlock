/**
 * The budget cap.
 *
 * Every other control in AIRLOCK governs what a change may do to production.
 * This one governs what the agent may do to your invoice, which is a different
 * kind of irreversible: nobody has ever been refunded for a verification loop
 * that ran all night against a shadow branch because a retry never terminated.
 *
 * The design decision worth defending is that this is **not a new kill
 * switch**. Reaching the ceiling pulls exactly the lever a human pulls when
 * they press ABORT — the same `cancelSession` call, peered by the harness to
 * whichever executor is doing the work. A budget that stops the browser
 * rendering tokens while the run continues on a server somewhere is not a
 * budget, it is a blindfold.
 *
 * Two things this is careful about:
 *
 *   - **A cap that only warns is a budget nobody has**, so the default
 *     enforces. But `enforce: false` is a real and legitimate setting for a
 *     team introducing one, and it is named honestly rather than dressed up:
 *     the console renders a budget that cannot stop anything differently from
 *     one that can.
 *   - **The binding ceiling is named.** "Over budget" is not actionable; "over
 *     on tokens at 2.1M against a 2.0M ceiling, while spend is at 38% of $5.00"
 *     tells you which knob to turn.
 */
import type { BudgetPolicy } from './policy.js';
import { DEFAULT_POLICY } from './policy.js';

export interface Spend {
  usd: number;
  tokens: number;
}

export type BudgetState =
  /** No ceiling is set. The run is unbounded, and the console says so. */
  | 'UNCAPPED'
  /** Comfortably inside. */
  | 'WITHIN'
  /** Past `warn_at` on some ceiling, and still running. */
  | 'WARNING'
  /** A ceiling has been reached. */
  | 'EXCEEDED';

export interface BudgetVerdict {
  state: BudgetState;
  /** Which ceiling is closest to binding — the one to quote and to raise. */
  binding: 'usd' | 'tokens' | null;
  /** Fraction of the binding ceiling consumed. Can exceed 1. */
  fraction: number;
  message: string;
  /**
   * Whether the run should actually be stopped.
   *
   * Deliberately separate from `EXCEEDED`: a policy that observes without
   * enforcing still reports the overspend truthfully, and the difference
   * between noticing and acting stays visible in the type rather than being
   * folded into one boolean nobody can interrogate later.
   */
  shouldStop: boolean;
}

/** `$4.32`, `$0.0071` — small numbers matter when the ceiling is five dollars. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** `1.4M`, `812k`, `430` — token counts, at a glance. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${tokens}`;
}

/**
 * Where this run stands against its ceilings.
 *
 * Pure, so the badge on screen and the decision to cancel are the same
 * computation — which is the only way the number a human read can be the number
 * the system acted on.
 */
export function assessBudget(spend: Spend, budget: BudgetPolicy = DEFAULT_POLICY.budget): BudgetVerdict {
  const ceilings: Array<{ key: 'usd' | 'tokens'; used: number; cap: number }> = [];
  if (budget.usd !== null && budget.usd > 0) ceilings.push({ key: 'usd', used: spend.usd, cap: budget.usd });
  if (budget.tokens !== null && budget.tokens > 0) {
    ceilings.push({ key: 'tokens', used: spend.tokens, cap: budget.tokens });
  }

  if (ceilings.length === 0) {
    return {
      state: 'UNCAPPED',
      binding: null,
      fraction: 0,
      message: 'No budget ceiling is set for this run.',
      shouldStop: false,
    };
  }

  // The binding ceiling is the one furthest consumed, not the first declared —
  // otherwise a run could sail past its token ceiling while the console
  // reassured everybody about dollars.
  let binding = ceilings[0]!;
  let fraction = binding.used / binding.cap;
  for (const c of ceilings.slice(1)) {
    const f = c.used / c.cap;
    if (f > fraction) {
      binding = c;
      fraction = f;
    }
  }

  const render = (v: number): string => (binding.key === 'usd' ? formatUsd(v) : formatTokens(v));
  const used = render(binding.used);
  const cap = render(binding.cap);
  const noun = binding.key === 'usd' ? 'spend' : 'tokens';

  if (fraction >= 1) {
    return {
      state: 'EXCEEDED',
      binding: binding.key,
      fraction,
      message: budget.enforce
        ? `This run reached its ${noun} ceiling — ${used} against ${cap}. Cancelling the turn.`
        : `This run reached its ${noun} ceiling — ${used} against ${cap}. The budget is set to observe, not enforce, so the run continues.`,
      shouldStop: budget.enforce,
    };
  }

  if (fraction >= budget.warn_at) {
    return {
      state: 'WARNING',
      binding: binding.key,
      fraction,
      message: `${Math.round(fraction * 100)}% of the ${noun} ceiling — ${used} of ${cap}.`,
      shouldStop: false,
    };
  }

  return {
    state: 'WITHIN',
    binding: binding.key,
    fraction,
    message: `${used} of ${cap}.`,
    shouldStop: false,
  };
}

/**
 * Why a run stopped.
 *
 * A cancelled turn is otherwise indistinguishable from one a person cancelled,
 * and those are very different facts to find in a log a week later — one is an
 * operator making a judgement call, the other is a ceiling nobody has raised
 * yet.
 */
export type StopCause = 'human' | 'budget';

export function describeStop(cause: StopCause, verdict?: BudgetVerdict): string {
  if (cause === 'human') return 'Cancelled by an operator.';
  return verdict ? `Cancelled by the budget cap. ${verdict.message}` : 'Cancelled by the budget cap.';
}

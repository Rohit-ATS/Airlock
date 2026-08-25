/**
 * The undo window.
 *
 * Approval decides whether a change may happen. `recovery.ts` decides what to
 * do when it happens and production comes back wrong. This module covers the
 * case both of those miss, and it is by a distance the most common one: the
 * change applied perfectly, every checksum agrees, and it was still the wrong
 * thing to do.
 *
 * A migration that lands cleanly and quietly breaks a finance report is not a
 * failed change. It is a correct change nobody wanted, and no health check will
 * ever catch it — only a person will, about four minutes later.
 *
 * What makes a *safe* undo button possible here, and not in most systems, is
 * that the proof has a second life. Before the gate would open, the agent
 * executed this exact rollback against a shadow copy and checksummed the data
 * back to byte-identical. For as long as production has not moved on, that
 * inverse is still known-good. The window is how long AIRLOCK is willing to
 * vouch for that, and `expires_at` is the moment it stops.
 *
 * Three refusals are load-bearing, and each one is a case where a less careful
 * system would offer the button anyway:
 *
 *   - **No proven inverse, no undo.** The same rule as auto-rollback. A SCOPE
 *     certificate never earns one: you cannot un-send forty thousand emails,
 *     and a control that implies you can is worse than no control.
 *   - **The window is measured on the server, from `audit.applied_at`.** A
 *     countdown in a browser is decoration. A request that arrives after the
 *     window closed is refused with the clock quoted back, however good it
 *     looked on screen a second ago.
 *   - **An undo that does not restore is recorded as an undo that did not
 *     work.** Production is re-checksummed afterwards and compared against the
 *     pre-migration digest — the same equality the certificate had to satisfy.
 *     Success is never inferred from the absence of an error.
 */
import type { ChangeClass, Dossier } from './dossier.js';
import type { ClassRule, Policy } from './policy.js';
import { DEFAULT_POLICY, ruleFor } from './policy.js';

/* -------------------------------------------------------------------------- */
/* The window                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How long this change may be taken back for, in seconds. `null` means never.
 *
 * Policy grants the window; the change may waive part of it and can never
 * extend it. That direction is deliberate — a window is a promise the
 * organisation makes about how long it will keep an inverse warm, so a change
 * asking for a longer one is asking the wrong party.
 */
export function undoWindowSeconds(dossier: Dossier, rule: ClassRule): number | null {
  const granted = rule.undo_window_seconds;
  if (granted === null || granted <= 0) return null;

  const requested = dossier.magnitude.undo_window_seconds;
  if (requested === null) return granted;
  if (requested <= 0) return null;

  return Math.min(granted, requested);
}

/** Whether a proven inverse exists. The same test `assessPostApply` applies. */
export function hasProvenInverse(dossier: Dossier): boolean {
  return dossier.rollback.length > 0 && dossier.rollback.every((op) => op.proven);
}

/**
 * When the window closes, given when the change landed.
 *
 * `undo.expires_at` is written at apply time and is authoritative when present:
 * it is a fact recorded about this change, not a sum the console recomputes
 * against a policy that may have been edited since. The fallback derivation
 * exists for records applied before the field did.
 */
export function undoExpiresAt(dossier: Dossier, rule: ClassRule): string | null {
  if (dossier.undo.expires_at) return dossier.undo.expires_at;

  const appliedAt = dossier.audit.applied_at;
  if (!appliedAt) return null;

  const seconds = undoWindowSeconds(dossier, rule);
  if (seconds === null) return null;

  const landed = new Date(appliedAt).getTime();
  if (!Number.isFinite(landed)) return null;

  return new Date(landed + seconds * 1000).toISOString();
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

export type UndoState =
  /** Applied, proven, inside the window. The button is real. */
  | 'AVAILABLE'
  /** The window has elapsed. It was real, and it is not any more. */
  | 'CLOSED'
  /** No proven inverse. This change was never undoable and never claimed to be. */
  | 'UNPROVEN'
  /** Policy grants this class no window at all. */
  | 'NOT_OFFERED'
  /** Somebody already took it back. */
  | 'ALREADY_UNDONE'
  /** The automatic health check already reverted it; there is nothing left to undo. */
  | 'SUPERSEDED'
  /** Nothing has been applied. */
  | 'NOT_APPLIED';

export interface UndoAvailability {
  state: UndoState;
  /** Written for the person looking at the button, or at the space where it was. */
  message: string;
  /** ISO instant the window closes, when there is one. */
  expiresAt: string | null;
  /** Milliseconds left, floored at zero. Zero whenever the state is not AVAILABLE. */
  remainingMs: number;
  /** The full width of the window, for rendering the drain honestly. */
  windowMs: number;
}

export interface UndoOptions {
  policy?: Policy;
  /** Injected so the window is testable without waiting out a real one. */
  now?: Date;
}

function rule(dossier: Dossier, policy: Policy): ClassRule {
  return ruleFor(policy, dossier.change_class as ChangeClass);
}

/**
 * May this change be taken back, right now, by anyone?
 *
 * Pure, and deliberately says nothing about *who* is asking — that is the
 * store's question, and keeping it out of here means the countdown on screen
 * and the check on the server are the same function with the same answer.
 */
export function assessUndo(dossier: Dossier, options: UndoOptions = {}): UndoAvailability {
  const policy = options.policy ?? DEFAULT_POLICY;
  const now = options.now ?? new Date();
  const r = rule(dossier, policy);

  const none = (state: UndoState, message: string): UndoAvailability => ({
    state,
    message,
    expiresAt: null,
    remainingMs: 0,
    windowMs: 0,
  });

  if (dossier.audit.applied_at === null) {
    return none('NOT_APPLIED', 'This change has not been applied, so there is nothing to take back.');
  }

  if (dossier.undo.undone_at) {
    const who = dossier.undo.undone_by ?? 'somebody';
    const restored = dossier.undo.restored;
    return none(
      'ALREADY_UNDONE',
      restored === false
        ? `${who} took this change back, and production did not return to its starting state. This needs a human.`
        : `${who} took this change back inside the window.`,
    );
  }

  if (dossier.post_apply.rolled_back_at) {
    return none(
      'SUPERSEDED',
      'The health check already reverted this change automatically. There is nothing left to take back.',
    );
  }

  if (!hasProvenInverse(dossier)) {
    return none(
      'UNPROVEN',
      'This change has no rollback that was proven against a shadow copy, so there is no inverse AIRLOCK is willing to run against production. It was never undoable, and it did not claim to be.',
    );
  }

  const seconds = undoWindowSeconds(dossier, r);
  if (seconds === null) {
    return none('NOT_OFFERED', 'Policy grants no undo window for this class of change. It was permanent on landing.');
  }

  const expiresAt = undoExpiresAt(dossier, r);
  if (!expiresAt) {
    return none('NOT_OFFERED', 'This change carries no undo window.');
  }

  const closes = new Date(expiresAt).getTime();
  const remaining = closes - now.getTime();
  const windowMs = seconds * 1000;

  if (remaining <= 0) {
    return {
      state: 'CLOSED',
      message: `The undo window closed at ${expiresAt}. The proof this change could be reversed is no longer fresh enough to act on.`,
      expiresAt,
      remainingMs: 0,
      windowMs,
    };
  }

  return {
    state: 'AVAILABLE',
    message: 'The rollback for this change was proven before it was applied, and the window is still open.',
    expiresAt,
    remainingMs: remaining,
    windowMs,
  };
}

/* -------------------------------------------------------------------------- */
/* Executing it                                                                */
/* -------------------------------------------------------------------------- */

export type UndoRefusal =
  | 'WINDOW_CLOSED'
  | 'NOT_UNDOABLE'
  | 'ROLE_NOT_APPROVER'
  | 'ALREADY_UNDONE';

export type UndoDecision =
  | { state: 'PERMITTED'; expiresAt: string; remainingMs: number; operations: Dossier['rollback'] }
  | { state: 'REFUSED'; reason: UndoRefusal; message: string };

export interface UndoRequest {
  email: string;
  role: string;
}

/**
 * Decide whether this person may take this change back, now.
 *
 * Note what is *not* checked, and why. Self-approval does not apply: the person
 * who approved a change is very often the first to realise it was wrong, and
 * making them find a second signature to fix it optimises for the wrong risk.
 * The codebase already holds this asymmetry — a single rejection stops a change
 * while a quorum is needed to move one — and undo is on the stopping side of
 * it. Requiring an approver at all is about competence, not separation.
 */
export function requestUndo(dossier: Dossier, by: UndoRequest, options: UndoOptions = {}): UndoDecision {
  const availability = assessUndo(dossier, options);

  if (availability.state === 'ALREADY_UNDONE') {
    return { state: 'REFUSED', reason: 'ALREADY_UNDONE', message: availability.message };
  }

  if (availability.state === 'CLOSED') {
    return { state: 'REFUSED', reason: 'WINDOW_CLOSED', message: availability.message };
  }

  if (availability.state !== 'AVAILABLE') {
    return { state: 'REFUSED', reason: 'NOT_UNDOABLE', message: availability.message };
  }

  if (by.role !== 'approver') {
    return {
      state: 'REFUSED',
      reason: 'ROLE_NOT_APPROVER',
      message: 'Taking a change back runs statements against production. That needs an approver.',
    };
  }

  return {
    state: 'PERMITTED',
    expiresAt: availability.expiresAt!,
    remainingMs: availability.remainingMs,
    operations: dossier.rollback,
  };
}

/**
 * Did the undo actually restore production?
 *
 * Compared against `checksums.pre` — the state the certificate started from —
 * because that is precisely what the shadow-branch proof demonstrated the
 * rollback returns the data to. A missing digest is not success: an undo whose
 * result was never measured is recorded as unmeasured, and the console says so.
 */
export function undoRestored(dossier: Dossier, observed: string | null): boolean | null {
  const pre = dossier.certificate?.checksums?.pre ?? null;
  if (!observed || !pre) return null;
  return observed === pre;
}

/** Human-readable one-liner for the ledger and the receipt. */
export function describeUndo(dossier: Dossier): string {
  const u = dossier.undo;
  if (!u.undone_at) return 'Not taken back.';
  const who = u.undone_by ?? 'unknown';
  if (u.restored === true) return `Taken back by ${who}, and production returned to its starting state.`;
  if (u.restored === false) return `Taken back by ${who}, and production did NOT return to its starting state.`;
  return `Taken back by ${who}. The result was never checksummed.`;
}

/**
 * What happens after a change lands.
 *
 * The Undo Certificate has, until now, been a permission slip: the agent proved
 * a rollback works, and that earned it the right to ask. This is the part that
 * makes it an operational safety net.
 *
 * The moment a change is applied, production is re-checksummed and compared
 * against what the certificate said it should look like. If it does not match,
 * AIRLOCK executes the rollback it already proved — the same statements, in the
 * same order, that returned the shadow branch byte-for-byte.
 *
 * The distinction that matters, and the reason this is a separate module rather
 * than a flag on the store: **AIRLOCK will only auto-revert a rollback it has
 * proof of.** A change whose rollback was never executed against a shadow copy
 * does not get automatically reverted on a bad health check, because running an
 * unproven inverse against a production database that is already in an
 * unexpected state is how a bad afternoon becomes a bad quarter. That case
 * raises the alarm and stops, which is the honest thing for it to do.
 */
import type { Dossier, Sha256Value } from './dossier.js';

/** `sha256:<64 hex>`; the contract enforces the shape. */
export type Sha256String = Sha256Value;

export type PostApplyOutcome =
  /** Production matches what the certificate predicted. Nothing to do. */
  | { state: 'HEALTHY'; message: string }
  /** It does not match, and the rollback is proven. Revert it. */
  | { state: 'REVERT'; message: string; expected: string; observed: string }
  /**
   * It does not match and the rollback is NOT proven. Do not touch production
   * again; get a human.
   */
  | { state: 'ALARM'; reason: 'ROLLBACK_NOT_PROVEN' | 'NO_EXPECTATION'; message: string }
  /** Nothing has been applied, or no check has run. */
  | { state: 'NOT_CHECKED'; message: string };

/**
 * Decide what to do about production, given what it looks like now.
 *
 * Pure, so the decision can be tested exhaustively and so the thing that
 * *executes* a rollback is never the same thing that decides whether to.
 */
export function assessPostApply(dossier: Dossier, observed: string | null): PostApplyOutcome {
  if (dossier.audit.applied_at === null) {
    return { state: 'NOT_CHECKED', message: 'This change has not been applied, so there is nothing to check.' };
  }

  if (!observed) {
    return { state: 'NOT_CHECKED', message: 'Production has not been re-checksummed since the change landed.' };
  }

  const cert = dossier.certificate;
  const expected = cert?.checksums?.post ?? null;

  if (!expected) {
    // A SCOPE certificate makes no prediction about a post-state — it describes
    // what is destroyed, not what remains — so there is nothing to compare and
    // nothing to safely revert to.
    return {
      state: 'ALARM',
      reason: 'NO_EXPECTATION',
      message:
        'This change carries no post-migration checksum, so there is nothing to compare production against. A human has to look.',
    };
  }

  if (observed === expected) {
    return {
      state: 'HEALTHY',
      message: 'Production matches the state the certificate predicted. The change landed as proven.',
    };
  }

  // It is wrong. Whether AIRLOCK is allowed to fix it depends entirely on
  // whether it has proof the fix works.
  const rollbackProven = dossier.rollback.length > 0 && dossier.rollback.every((op) => op.proven);

  if (!rollbackProven) {
    return {
      state: 'ALARM',
      reason: 'ROLLBACK_NOT_PROVEN',
      message:
        'Production does not match the certificate, and this change has no rollback that was proven against a shadow copy. AIRLOCK will not run an unproven inverse against a database that is already in an unexpected state. Stopping, and raising this.',
    };
  }

  return {
    state: 'REVERT',
    expected,
    observed,
    message:
      'Production does not match the state the certificate predicted. Executing the rollback that was already proven to restore it byte-for-byte.',
  };
}

/** Human-readable one-liner for the console and the ledger. */
export function describePostApply(dossier: Dossier): string {
  const p = dossier.post_apply;
  if (p.rolled_back_at) {
    const took = p.duration_ms === null ? '' : ` in ${(p.duration_ms / 1000).toFixed(1)}s`;
    return `Health check failed after apply. Rolled back${took} using the proven inverse.`;
  }
  if (p.healthy === true) return 'Applied, health-checked, and matching the certificate.';
  if (p.healthy === false) return 'Applied, and production does not match the certificate. Not reverted.';
  if (dossier.audit.applied_at) return 'Applied. No health check has run yet.';
  return 'Not applied.';
}

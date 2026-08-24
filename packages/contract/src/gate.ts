/**
 * THE AIRLOCK GATE.
 *
 *   certificate.status !== "PROVEN"  ->  the approval gate is never offered.
 *
 * This rule is not a conditional in a component. It is enforced by the type
 * system: the Approve control accepts only an `ApprovalGrant`, and an
 * `ApprovalGrant` carries a unique symbol that no code outside this module can
 * produce. `openGate` is the sole constructor, and it refuses to build one
 * unless the certificate proves itself.
 *
 * The practical consequence: a developer cannot render an Approve button for an
 * unproven dossier even by mistake. There is no value they could pass to it.
 */
import type { Certificate, Dossier } from './dossier.js';

/**
 * The witness. Module-private and never exported, so no other file can name it
 * — which is what makes `ApprovalGrant` unforgeable at compile time. It is a
 * real symbol rather than a `declare`d one, so the guarantee also holds at
 * runtime: `isGrant` below can verify a value genuinely came from `openGate`.
 */
const GATE_WITNESS: unique symbol = Symbol('airlock.gate.witness');

/**
 * Proof that a dossier earned the right to ask. Only `openGate` can mint one.
 * The private symbol makes the type unforgeable from any other module: an
 * object literal cannot satisfy it, and neither can a cast from `unknown`
 * without deliberately importing this file's internals.
 */
export interface ApprovalGrant {
  readonly [GATE_WITNESS]: true;
  readonly dossier_id: string;
  readonly kind: Certificate['kind'];
  /** True only for SCOPE grants: this change cannot be undone. */
  readonly irreversible: boolean;
  readonly approver: string;
  readonly verified_at: string | undefined;
}

export type SealReason =
  | 'NO_CERTIFICATE'
  | 'CERTIFICATE_PENDING'
  | 'CERTIFICATE_FAILED'
  | 'CHECKSUM_MISSING'
  | 'CHECKSUM_MISMATCH'
  | 'SCOPE_NOT_COMPUTED'
  | 'SCOPE_UNBOUNDED'
  | 'ROLLBACK_NOT_PROVEN'
  | 'ROLE_NOT_APPROVER'
  | 'ALREADY_DECIDED'
  | 'ALREADY_APPLIED';

/** Copy shown on the sealed door. Written for a stranger, not for us. */
export const SEAL_COPY: Record<SealReason, string> = {
  NO_CERTIFICATE: 'No certificate was produced. The agent has not proven anything about this change yet.',
  CERTIFICATE_PENDING: 'Verification is still running in the sandbox. The gate opens only on a finished proof.',
  CERTIFICATE_FAILED: 'Verification ran and failed. This change cannot be approved from this dossier.',
  CHECKSUM_MISSING: 'An undo certificate was claimed without a checksum triple. There is nothing to verify.',
  CHECKSUM_MISMATCH:
    'The data did not return to its starting state after rollback. The pre-migration and post-rollback checksums differ.',
  SCOPE_NOT_COMPUTED: 'A scope certificate was claimed without a computed blast radius.',
  SCOPE_UNBOUNDED: 'The scope certificate lists no records and no exclusions, so its blast radius is unbounded.',
  ROLLBACK_NOT_PROVEN: 'At least one rollback operation was never executed against the shadow branch.',
  ROLE_NOT_APPROVER: 'You are signed in as a requester. Separation of duties requires an approver to open the gate.',
  ALREADY_DECIDED: 'This change has already been decided.',
  ALREADY_APPLIED: 'This change has already been applied to production.',
};

export type GateDecision =
  | { state: 'OPEN'; grant: ApprovalGrant }
  | { state: 'SEALED'; reason: SealReason; message: string };

export interface Viewer {
  email: string;
  role: (typeof import('./dossier.js'))['ROLES'][number] | string;
}

const sealed = (reason: SealReason): GateDecision => ({
  state: 'SEALED',
  reason,
  message: SEAL_COPY[reason],
});

/**
 * The only way to obtain an `ApprovalGrant`.
 *
 * Order matters: certificate integrity is checked before role. A requester
 * looking at a failed certificate is told the change is unprovable, not that
 * they lack permission — the more important fact wins.
 */
export function openGate(dossier: Dossier, viewer: Viewer): GateDecision {
  if (dossier.audit.applied_at !== null) return sealed('ALREADY_APPLIED');
  if (dossier.approval.decision !== null) return sealed('ALREADY_DECIDED');

  const cert = dossier.certificate;
  if (!cert) return sealed('NO_CERTIFICATE');
  if (cert.status === 'PENDING') return sealed('CERTIFICATE_PENDING');
  if (cert.status === 'FAILED') return sealed('CERTIFICATE_FAILED');

  if (cert.kind === 'UNDO') {
    const c = cert.checksums;
    if (!c) return sealed('CHECKSUM_MISSING');
    // Never trust the verifier's own `match` flag. Recompute it here.
    if (c.pre !== c.post_rollback) return sealed('CHECKSUM_MISMATCH');
    if (!c.match) return sealed('CHECKSUM_MISMATCH');
    if (dossier.rollback.length === 0) return sealed('ROLLBACK_NOT_PROVEN');
    if (!dossier.rollback.every((op) => op.proven)) return sealed('ROLLBACK_NOT_PROVEN');
  }

  if (cert.kind === 'SCOPE') {
    const scope = cert.scope;
    if (!scope) return sealed('SCOPE_NOT_COMPUTED');
    if (scope.records.length === 0 && scope.exclusions.length === 0) return sealed('SCOPE_UNBOUNDED');
  }

  if (viewer.role !== 'approver') return sealed('ROLE_NOT_APPROVER');

  const grant: ApprovalGrant = {
    [GATE_WITNESS]: true,
    dossier_id: dossier.dossier_id,
    kind: cert.kind,
    irreversible: cert.kind === 'SCOPE',
    approver: viewer.email,
    verified_at: cert.verified_at,
  };

  return { state: 'OPEN', grant };
}

/**
 * Runtime counterpart to the type-level guarantee. The API route that actually
 * applies a change calls this before touching production, so a forged grant
 * cannot get through even from a caller that bypassed TypeScript entirely.
 */
export function isGrant(value: unknown): value is ApprovalGrant {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[GATE_WITNESS] === true;
}

/**
 * The verdict banner. Derived from the same decision that gates the button, so
 * the banner and the button can never disagree.
 */
export type Verdict =
  | { tone: 'proven'; label: string; sub: string }
  | { tone: 'irreversible'; label: string; sub: string }
  | { tone: 'blocked'; label: string; sub: string };

export function verdictOf(dossier: Dossier, decision: GateDecision): Verdict {
  if (decision.state === 'SEALED') {
    if (decision.reason === 'ROLE_NOT_APPROVER') {
      // The certificate is fine; only this viewer cannot act on it.
      return dossier.certificate?.kind === 'SCOPE'
        ? { tone: 'irreversible', label: 'IRREVERSIBLE — SCOPE VERIFIED', sub: decision.message }
        : { tone: 'proven', label: 'PROVEN — ROLLBACK VERIFIED', sub: decision.message };
    }
    return { tone: 'blocked', label: 'BLOCKED — NO CERTIFICATE', sub: decision.message };
  }
  return decision.grant.irreversible
    ? {
        tone: 'irreversible',
        label: 'IRREVERSIBLE — SCOPE VERIFIED',
        sub: 'This cannot be undone. The agent has proven exactly what it destroys, and what it leaves alone.',
      }
    : {
        tone: 'proven',
        label: 'PROVEN — ROLLBACK VERIFIED',
        sub: 'Applied and rolled back on a shadow branch. The data returned byte-identical.',
      };
}

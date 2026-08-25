/**
 * THE AIRLOCK GATE.
 *
 *   certificate.status !== "PROVEN"  ->  the approval gate is never offered.
 *
 * This rule is not a conditional in a component. It is enforced by the type
 * system: the Approve control accepts only an `ApprovalGrant`, and an
 * `ApprovalGrant` carries a unique symbol that no code outside this module can
 * produce. `openGate` is the sole constructor, and it refuses to build one
 * unless the certificate proves itself *and* policy permits the change.
 *
 * The practical consequence: a developer cannot render an Approve button for an
 * unproven change even by mistake. There is no value they could pass to it.
 *
 * The gate asks eight questions, in this order, and stops at the first "no":
 *
 *   1. Has this already been decided?        — an audit question
 *   2. Was anything it read steering it?     — prompt injection
 *   3. Do we know what this is even about?   — resolved context
 *   4. Is there a finished proof?            — a certificate question
 *   5. Does the proof actually hold?         — recomputed, never trusted
 *   6. Has anyone reviewed the code?         — the other half of the change
 *   7. Is the proof still true of today?     — freshness and drift, of both
 *                                              production and the resolved facts
 *   8. Is this permitted, by whom, now?      — policy
 *
 * Questions 2 and 3 sit ahead of the certificate for the same reason: a proof
 * is about a set of operations, and neither the proof nor the checksums can
 * tell you whether an attacker chose those operations or whether anybody
 * established which rows they point at.
 *
 * Only then does it ask whether *you* may act, because being told "you lack
 * permission" when the real answer is "this change is unprovable" wastes the
 * more important fact.
 */
import type { Certificate, CertificateKind, Dossier } from './dossier.js';
import { approversFor } from './dossier.js';
import { reviewBlocks } from './review.js';
import { contextDrifted, contextRecheckMissing, contextUnresolved } from './resolve.js';
import {
  DEFAULT_POLICY,
  evaluatePolicy,
  ruleFor,
  type Policy,
  type PolicyCode,
  type PolicyFinding,
  type PolicyVerdict,
} from './policy.js';

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
  readonly kind: CertificateKind;
  /** True only for SCOPE grants: this change cannot be undone. */
  readonly irreversible: boolean;
  readonly approver: string;
  readonly verified_at: string | undefined;
  /** Distinct approvers policy demands before this may be applied. */
  readonly seals_required: number;
  /** Distinct approvers already collected, not counting this one. */
  readonly seals_held: number;
  /**
   * True when this signature is the one that applies the change. False means
   * the viewer is countersigning and somebody else still has to arrive.
   */
  readonly final: boolean;
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
  | 'REVIEW_OUTSTANDING'
  | 'PRODUCTION_DRIFTED'
  | 'INJECTION_DETECTED'
  | 'CONTEXT_UNRESOLVED'
  | 'CONTEXT_DRIFTED'
  | 'CONTEXT_UNVERIFIED'
  | 'CERTIFICATE_STALE'
  | 'POLICY_WRONG_CERTIFICATE'
  | 'POLICY_RECORD_CEILING'
  | 'POLICY_PEOPLE_CEILING'
  | 'POLICY_AMOUNT_CEILING'
  | 'POLICY_LOCK_CEILING'
  | 'POLICY_BLACKOUT'
  | 'GRANT_WITHOUT_EXPIRY'
  | 'SELF_APPROVAL'
  | 'ROLE_NOT_APPROVER'
  | 'ALREADY_DECIDED'
  | 'ALREADY_APPLIED';

/**
 * Copy shown on the sealed door. Written for a stranger, not for us.
 *
 * Policy-sourced seals override these with the specific finding — a ceiling
 * should say which ceiling and by how much — so these are the fallbacks.
 */
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
  REVIEW_OUTSTANDING:
    'This change carries code the agent wrote, and an independent reviewer has either not looked at it or raised findings nobody has addressed. A migration proven reversible, attached to code that still dereferences the column it removes, is a proof of the wrong thing.',
  PRODUCTION_DRIFTED:
    'Production has changed since this proof was taken. The certificate describes a database that no longer exists.',
  INJECTION_DETECTED:
    'Content this change read was trying to give the agent instructions. Until a person has looked at it, nothing here can be trusted to be the change it claims to be.',
  CONTEXT_UNRESOLVED:
    'Something this change needs to know is still ambiguous or missing. A proof about an unidentified subject is a proof of the wrong thing, so the gate does not open until every required fact resolves to exactly one answer.',
  CONTEXT_DRIFTED:
    'A fact this change was planned against has changed since the proof was taken. The certificate is about a different set of facts from the ones true right now.',
  CONTEXT_UNVERIFIED:
    'This proof pinned the facts it was taken against, and nobody re-checked them before the gate. An absent check is not a passed check.',
  CERTIFICATE_STALE: 'This certificate has expired. Re-run verification against production as it is now.',
  POLICY_WRONG_CERTIFICATE: 'Policy requires a different kind of certificate for this class of change.',
  POLICY_RECORD_CEILING: 'This change touches more records than policy permits without a capacity review.',
  POLICY_PEOPLE_CEILING: 'This change affects more people than policy permits for this class.',
  POLICY_AMOUNT_CEILING: 'This moves more money than AIRLOCK is authorised to move.',
  POLICY_LOCK_CEILING: 'This operation holds a lock for longer than policy permits.',
  POLICY_BLACKOUT: 'A change freeze is in effect for this class of change.',
  GRANT_WITHOUT_EXPIRY: 'Policy forbids access that does not expire. Every grant must carry an expiry.',
  SELF_APPROVAL: 'You cannot approve a change you asked for, and you cannot sign one twice.',
  ROLE_NOT_APPROVER: 'You are signed in as a requester. Separation of duties requires an approver to open the gate.',
  ALREADY_DECIDED: 'This change has already been decided.',
  ALREADY_APPLIED: 'This change has already been applied to production.',
};

export type GateDecision =
  | { state: 'OPEN'; grant: ApprovalGrant; policy: PolicyVerdict }
  | {
      state: 'SEALED';
      reason: SealReason;
      message: string;
      /** Present when policy sealed the door, carrying the limit and the observed value. */
      finding?: PolicyFinding;
      policy: PolicyVerdict;
    };

export interface Viewer {
  email: string;
  role: 'requester' | 'approver' | (string & {});
}

export interface GateOptions {
  policy?: Policy;
  /** Injected so freshness and change freezes are testable without waiting. */
  now?: Date;
}

/** Policy codes that are facts about the *viewer* rather than about the change. */
const VIEWER_LEVEL_CODES: ReadonlySet<PolicyCode> = new Set<PolicyCode>(['SELF_APPROVAL']);

const POLICY_SEAL: Record<PolicyCode, SealReason> = {
  WRONG_CERTIFICATE_KIND: 'POLICY_WRONG_CERTIFICATE',
  CERTIFICATE_STALE: 'CERTIFICATE_STALE',
  RECORD_CEILING: 'POLICY_RECORD_CEILING',
  PEOPLE_CEILING: 'POLICY_PEOPLE_CEILING',
  AMOUNT_CEILING: 'POLICY_AMOUNT_CEILING',
  LOCK_CEILING: 'POLICY_LOCK_CEILING',
  GRANT_WITHOUT_EXPIRY: 'GRANT_WITHOUT_EXPIRY',
  BLACKOUT_WINDOW: 'POLICY_BLACKOUT',
  SELF_APPROVAL: 'SELF_APPROVAL',
};

/**
 * The only way to obtain an `ApprovalGrant`.
 *
 * Order matters: certificate integrity is checked before policy, and policy
 * before role. A requester looking at a failed certificate is told the change
 * is unprovable, not that they lack permission — the more important fact wins.
 */
export function openGate(dossier: Dossier, viewer: Viewer, options: GateOptions = {}): GateDecision {
  const policy = options.policy ?? DEFAULT_POLICY;
  const now = options.now ?? new Date();
  const verdict = evaluatePolicy(dossier, { policy, viewerEmail: viewer.email, now });

  const sealed = (reason: SealReason, finding?: PolicyFinding): GateDecision => ({
    state: 'SEALED',
    reason,
    message: finding?.message ?? SEAL_COPY[reason],
    ...(finding ? { finding } : {}),
    policy: verdict,
  });

  /* --- 1. has this already been decided? --------------------------------- */
  if (dossier.audit.applied_at !== null) return sealed('ALREADY_APPLIED');
  if (dossier.approval.decision !== null) return sealed('ALREADY_DECIDED');

  /* --- 2. was anything the agent read trying to steer it? ----------------
   *
   * Deliberately checked BEFORE the certificate, which looks like the wrong
   * order until you ask what a certificate proves. It proves that a particular
   * set of operations is reversible — it says nothing about who chose those
   * operations. If an attacker influenced the choice through a poisoned row,
   * the proof is impeccable and it is proving the wrong thing.
   *
   * A proof whose subject was picked by the attacker is not reassuring, so this
   * has to seal ahead of it.
   */
  if (hasUnclearedInjection(dossier)) return sealed('INJECTION_DETECTED');

  /* --- 3. do we actually know what this change is about? -----------------
   *
   * Same argument as the step above, one layer out. The certificate proves a
   * set of operations reversible; it cannot tell you those operations were
   * aimed at the right rows. If the agent never pinned down *which* customer,
   * *which* account, *which* table, then the proof is impeccable and it is
   * about something nobody identified.
   *
   * This is also the rule that keeps auto-resolution honest. Resolving facts
   * automatically is only an improvement if a failure to resolve is louder
   * than asking would have been — otherwise it is a system that quietly
   * guesses. An unresolved required field seals the door.
   */
  if (contextUnresolved(dossier.change_class, dossier.resolved_context)) {
    return sealed('CONTEXT_UNRESOLVED');
  }

  /* --- 4. is there a finished proof? ------------------------------------- */
  const cert = dossier.certificate;
  if (!cert) return sealed('NO_CERTIFICATE');
  if (cert.status === 'PENDING') return sealed('CERTIFICATE_PENDING');
  if (cert.status === 'FAILED') return sealed('CERTIFICATE_FAILED');

  /* --- 5. does the proof actually hold? ---------------------------------- */
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

  /* --- 6. has anybody looked at the code the agent wrote? ----------------
   *
   * The migration being reversible is not the whole change. If the agent also
   * wrote the application changes that go with it — the expand/contract edits
   * across every call site the blast radius turned up — then a proof attached
   * to unreviewed code is a proof of half a thing.
   */
  if (reviewBlocks(dossier)) return sealed('REVIEW_OUTSTANDING');

  /* --- 7. is the proof still true of the world as it is now? -------------
   *
   * Two ways it can stop being true, and they are separate questions:
   * production itself moved, or a fact the change was *planned against* moved.
   * A refund proven correct against a Stripe account in USD is not proven
   * correct once that account reports EUR, even though the database is
   * untouched and every checksum still matches.
   *
   * The unverified case is deliberately its own refusal rather than being
   * folded into "no drift". A proof that pinned its facts and was never
   * re-checked has not passed the check; it has skipped it, and reporting
   * a skipped check as a clean one is the failure this whole system exists to
   * make impossible.
   */
  if (hasDrifted(dossier)) return sealed('PRODUCTION_DRIFTED');
  if (contextRecheckMissing(cert.context_fingerprint, dossier.resolved_context)) {
    return sealed('CONTEXT_UNVERIFIED');
  }
  if (contextDrifted(cert.context_fingerprint, dossier.resolved_context?.recheck_fingerprint)) {
    return sealed('CONTEXT_DRIFTED');
  }

  /* --- 8. is this permitted at all? -------------------------------------- */
  const changeLevel = verdict.findings.filter((f) => !VIEWER_LEVEL_CODES.has(f.code));
  const firstChangeLevel = changeLevel[0];
  if (firstChangeLevel) return sealed(POLICY_SEAL[firstChangeLevel.code], firstChangeLevel);

  /* --- and may *you* act? ------------------------------------------------ */
  if (viewer.role !== 'approver') return sealed('ROLE_NOT_APPROVER');

  const viewerLevel = verdict.findings.filter((f) => VIEWER_LEVEL_CODES.has(f.code));
  const firstViewerLevel = viewerLevel[0];
  if (firstViewerLevel) return sealed(POLICY_SEAL[firstViewerLevel.code], firstViewerLevel);

  const held = verdict.sealsHeld;
  const required = verdict.sealsRequired;

  const grant: ApprovalGrant = {
    [GATE_WITNESS]: true,
    dossier_id: dossier.dossier_id,
    kind: cert.kind,
    irreversible: cert.kind === 'SCOPE',
    approver: viewer.email,
    verified_at: cert.verified_at,
    seals_required: required,
    seals_held: held,
    final: held + 1 >= required,
  };

  return { state: 'OPEN', grant, policy: verdict };
}

/**
 * Has production moved out from under this proof?
 *
 * The asymmetry here is deliberate and is the same one that governs
 * `checksums.match`: a *positive* claim of danger is believed without argument,
 * a *negative* claim of safety is recomputed. So `drifted: true` seals the gate
 * on the checker's word alone, while `drifted: false` proves nothing — the
 * digests are compared directly.
 */
/**
 * Did the agent read something that was trying to steer it, and has nobody
 * looked at it yet?
 *
 * The same asymmetry that governs drift and `checksums.match`, applied to a
 * third thing: a finding is believed on sight, and only an explicit, attributed
 * human clearance dismisses it. There is deliberately no "confidence" score and
 * no threshold to tune. A detector that decides for itself which attacks are
 * serious enough to mention is a detector that will one day decide wrongly, and
 * quietly.
 *
 * Clearing exists because every detector over natural language has false
 * positives, and a control plane that can be permanently bricked by someone
 * writing "ignore previous instructions" in their bio is a control plane that
 * gets switched off. What clearing is not is quiet: it is attributed,
 * timestamped, reason-bearing, and sealed into the receipt with everything else.
 */
export function hasUnclearedInjection(dossier: Dossier): boolean {
  if (dossier.untrusted.findings.length === 0) return false;
  return dossier.untrusted.cleared_at === null;
}

export function hasDrifted(dossier: Dossier): boolean {
  const { drift, certificate } = dossier;
  if (drift.drifted === true) return true;

  const observed = drift.production_checksum;
  if (!observed) return false;

  const expected = certificate?.checksums?.pre;
  if (!expected) return false;

  return observed !== expected;
}

/**
 * Runtime counterpart to the type-level guarantee. The API route that actually
 * applies a change calls this before touching production, so a forged grant
 * cannot get through even from a caller that bypassed TypeScript entirely.
 */
export function isGrant(value: unknown): value is ApprovalGrant {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[GATE_WITNESS] === true;
}

/* -------------------------------------------------------------------------- */
/* Break glass                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A second, separate witness — deliberately not the gate's.
 *
 * Break-glass does not open the airlock. It cannot: `BreakGlassOverride` is a
 * different type, and no function accepts both. What it does is record that a
 * named human, in an incident, chose to go around a sealed door — with a
 * written reason, permanently, in the same ledger.
 *
 * The argument for having it at all: people do this anyway. In every
 * organisation there is a moment where the safe path is not available and
 * somebody opens a psql session instead. A control plane that pretends
 * otherwise does not prevent the override, it only ensures there is no record
 * of it. AIRLOCK would rather own the ugly path than lose the audit trail.
 *
 * It is off by default in the policy (per class) and off by default in the
 * deployment (an explicit environment variable). Both must say yes.
 */
const GLASS_WITNESS: unique symbol = Symbol('airlock.gate.breakglass');

export interface BreakGlassOverride {
  readonly [GLASS_WITNESS]: true;
  readonly dossier_id: string;
  readonly operator: string;
  readonly justification: string;
  /** The seal that was overridden. Written into the ledger verbatim. */
  readonly bypassed: SealReason;
  readonly at: string;
}

export type BreakGlassRefusal =
  | 'NOT_SEALED'
  | 'DISABLED'
  | 'FORBIDDEN_FOR_CLASS'
  | 'ALREADY_DECIDED'
  | 'NOT_APPROVER'
  | 'NO_JUSTIFICATION';

export type BreakGlassDecision =
  | { state: 'AVAILABLE'; override: BreakGlassOverride }
  | { state: 'UNAVAILABLE'; reason: BreakGlassRefusal; message: string };

/** An override with no written reason is not an override; it is an outage with extra steps. */
export const MIN_JUSTIFICATION = 40;

export const BREAK_GLASS_COPY: Record<BreakGlassRefusal, string> = {
  NOT_SEALED: 'The gate is open. Use it — break-glass exists for doors that will not open, not for doors you are impatient with.',
  DISABLED: 'Break-glass is switched off in this deployment. Set AIRLOCK_BREAK_GLASS=1 to enable it, deliberately.',
  FORBIDDEN_FOR_CLASS:
    'Policy forbids break-glass for this class of change. There is no emergency here that fifteen minutes of care makes worse.',
  ALREADY_DECIDED: 'This change has already been decided. There is nothing left to override.',
  NOT_APPROVER: 'Only an approver can break the glass, and their name goes on it permanently.',
  NO_JUSTIFICATION: `Write down why. At least ${MIN_JUSTIFICATION} characters, in your own words, in a record that outlives the incident.`,
};

/**
 * Offer the break-glass path, if it exists for this change and this person.
 *
 * Note it never inspects whether the certificate is good — that is the whole
 * point. What it does insist on: the door is genuinely sealed, the class allows
 * it, the deployment allows it, the viewer can approve, and there is a written
 * reason.
 */
export function openBreakGlass(
  dossier: Dossier,
  viewer: Viewer,
  justification: string,
  options: GateOptions & { enabled?: boolean } = {},
): BreakGlassDecision {
  const refuse = (reason: BreakGlassRefusal): BreakGlassDecision => ({
    state: 'UNAVAILABLE',
    reason,
    message: BREAK_GLASS_COPY[reason],
  });

  if (options.enabled !== true) return refuse('DISABLED');

  const rule = ruleFor(options.policy ?? DEFAULT_POLICY, dossier.change_class);
  if (!rule.break_glass) return refuse('FORBIDDEN_FOR_CLASS');

  if (dossier.audit.applied_at !== null || dossier.approval.decision !== null) return refuse('ALREADY_DECIDED');
  if (viewer.role !== 'approver') return refuse('NOT_APPROVER');

  const gate = openGate(dossier, viewer, options);
  if (gate.state === 'OPEN') return refuse('NOT_SEALED');

  const reason = justification.trim();
  if (reason.length < MIN_JUSTIFICATION) return refuse('NO_JUSTIFICATION');

  return {
    state: 'AVAILABLE',
    override: {
      [GLASS_WITNESS]: true,
      dossier_id: dossier.dossier_id,
      operator: viewer.email,
      justification: reason,
      bypassed: gate.reason,
      at: (options.now ?? new Date()).toISOString(),
    },
  };
}

export function isBreakGlass(value: unknown): value is BreakGlassOverride {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[GLASS_WITNESS] === true;
}

/* -------------------------------------------------------------------------- */
/* Derived readings                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The verdict banner. Derived from the same decision that gates the button, so
 * the banner and the button can never disagree.
 */
export type Verdict =
  | { tone: 'proven'; label: string; sub: string }
  | { tone: 'irreversible'; label: string; sub: string }
  | { tone: 'blocked'; label: string; sub: string };

/**
 * The headline for each way the gate can refuse.
 *
 * Deliberately specific. "Blocked" tells a reader nothing they cannot see from
 * the colour; what they need is which of the five questions the gate asks was
 * answered no, in four words, before they read the sentence underneath.
 */
const BLOCKED_LABEL: Record<SealReason, string> = {
  NO_CERTIFICATE: 'BLOCKED — NO CERTIFICATE',
  CERTIFICATE_PENDING: 'PENDING — VERIFICATION STILL RUNNING',
  CERTIFICATE_FAILED: 'FAILED — VERIFICATION DID NOT PASS',
  CHECKSUM_MISSING: 'BLOCKED — NOTHING TO VERIFY',
  CHECKSUM_MISMATCH: 'BLOCKED — THE DATA DID NOT COME BACK',
  ROLLBACK_NOT_PROVEN: 'BLOCKED — ROLLBACK NEVER EXECUTED',
  REVIEW_OUTSTANDING: 'BLOCKED — THE CODE HAS NOT BEEN REVIEWED',
  SCOPE_NOT_COMPUTED: 'BLOCKED — SCOPE NOT COMPUTED',
  SCOPE_UNBOUNDED: 'BLOCKED — BLAST RADIUS UNBOUNDED',
  PRODUCTION_DRIFTED: 'STALE — PRODUCTION HAS MOVED',
  INJECTION_DETECTED: 'QUARANTINED — THE DATA TRIED TO GIVE ORDERS',
  CONTEXT_UNRESOLVED: 'ASKING — A FACT IS STILL AMBIGUOUS',
  CONTEXT_DRIFTED: 'STALE — A RESOLVED FACT HAS MOVED',
  CONTEXT_UNVERIFIED: 'BLOCKED — THE FACTS WERE NEVER RE-CHECKED',
  CERTIFICATE_STALE: 'EXPIRED — PROOF OUT OF DATE',
  POLICY_WRONG_CERTIFICATE: 'REFUSED — WRONG KIND OF PROOF',
  POLICY_RECORD_CEILING: 'REFUSED — OVER THE RECORD CEILING',
  POLICY_PEOPLE_CEILING: 'REFUSED — OVER THE PEOPLE CEILING',
  POLICY_AMOUNT_CEILING: 'REFUSED — OVER THE AMOUNT CEILING',
  POLICY_LOCK_CEILING: 'REFUSED — THE LOCK IS TOO LONG',
  POLICY_BLACKOUT: 'REFUSED — CHANGE FREEZE IN EFFECT',
  GRANT_WITHOUT_EXPIRY: 'REFUSED — THE GRANT NEVER EXPIRES',
  SELF_APPROVAL: 'HELD — SEPARATION OF DUTIES',
  ROLE_NOT_APPROVER: 'HELD — WAITING ON AN APPROVER',
  ALREADY_DECIDED: 'DECIDED — RECORDED IN THE LEDGER',
  ALREADY_APPLIED: 'APPLIED — RECORDED IN THE LEDGER',
};

/** Seals that mean "the proof is fine, something else is in the way". */
const NON_PROOF_SEALS: ReadonlySet<SealReason> = new Set<SealReason>([
  'ROLE_NOT_APPROVER',
  'SELF_APPROVAL',
  'POLICY_BLACKOUT',
]);

export function verdictOf(dossier: Dossier, decision: GateDecision): Verdict {
  if (decision.state === 'SEALED') {
    if (NON_PROOF_SEALS.has(decision.reason)) {
      // The certificate is fine; only this viewer, or this moment, cannot act.
      return dossier.certificate?.kind === 'SCOPE'
        ? { tone: 'irreversible', label: 'IRREVERSIBLE — SCOPE VERIFIED', sub: decision.message }
        : { tone: 'proven', label: 'PROVEN — ROLLBACK VERIFIED', sub: decision.message };
    }
    if (decision.reason === 'ALREADY_APPLIED') {
      return {
        tone: 'proven',
        label: 'APPLIED — RECORDED IN THE LEDGER',
        sub: decision.message,
      };
    }
    // Each seal gets its own headline. A banner reading "no certificate" over a
    // change that has one and whose digests merely disagree is a small lie, and
    // this component exists to make a reader trust what is on the screen.
    return { tone: 'blocked', label: BLOCKED_LABEL[decision.reason], sub: decision.message };
  }

  const { grant } = decision;
  if (!grant.final) {
    return {
      tone: grant.irreversible ? 'irreversible' : 'proven',
      label: `AWAITING QUORUM — ${grant.seals_held} OF ${grant.seals_required} SIGNATURES`,
      sub: 'Policy requires a second approver for this class. Your signature counts one; the change does not move until another person signs.',
    };
  }

  return grant.irreversible
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

/**
 * Every reason this change is not currently applicable, in one list.
 *
 * `openGate` stops at the first problem, which is right for a decision and
 * wrong for a status board: an operator triaging a queue wants to know that a
 * change needs a second signature *and* is over the record ceiling, not to
 * discover the second thing after fixing the first. The control room uses this.
 */
export function allBlockers(dossier: Dossier, viewer: Viewer, options: GateOptions = {}): SealReason[] {
  const decision = openGate(dossier, viewer, options);
  const out: SealReason[] = [];
  if (decision.state === 'SEALED') out.push(decision.reason);
  for (const finding of decision.policy.findings) {
    const reason = POLICY_SEAL[finding.code];
    if (!out.includes(reason)) out.push(reason);
  }
  if (decision.state === 'OPEN' && !decision.grant.final && !out.includes('ROLE_NOT_APPROVER')) {
    // Not a seal — the gate is genuinely open — but it is why nothing has moved.
    return out;
  }
  return out;
}

/** How many more distinct people must sign. Zero when the change can be applied. */
export function sealsOutstanding(dossier: Dossier, options: GateOptions = {}): number {
  const rule = ruleFor(options.policy ?? DEFAULT_POLICY, dossier.change_class);
  return Math.max(0, rule.quorum - approversFor(dossier).length);
}

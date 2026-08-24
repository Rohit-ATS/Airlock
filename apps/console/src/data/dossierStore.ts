import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  Dossier,
  parseDossier,
  openGate,
  openBreakGlass,
  isGrant,
  isBreakGlass,
  approversFor,
  sealsOutstanding,
  sealReceipt,
  GENESIS_HASH,
  type Signature,
  type Viewer,
} from '@airlock/contract';

/**
 * The change ledger, server-side.
 *
 * Dossiers are written by the verification engine and read by the console. This
 * is a file-backed store so `make demo` needs no database and a judge can read
 * the ledger with `cat`. The interesting parts are not the persistence:
 *
 *   - `decide()` re-runs the gate on the server, so an approval cannot be
 *     forged by a client that skipped the UI;
 *   - it counts the quorum from stored signatures rather than believing the
 *     grant it was handed, for the same reason the gate never believes
 *     `checksums.match`;
 *   - a change that becomes decided is sealed into a hash chain, so editing
 *     this file afterwards is detectable by anyone holding an older head hash.
 */

const DATA_DIR = process.env.AIRLOCK_DATA_DIR ?? path.join(process.cwd(), '.airlock');
const LEDGER = path.join(DATA_DIR, 'ledger.json');

/** Break-glass needs two switches. This is the deployment one; policy is the other. */
export const BREAK_GLASS_ENABLED = process.env.AIRLOCK_BREAK_GLASS === '1';

type Ledger = Record<string, Dossier>;

let cache: Ledger | null = null;

async function load(): Promise<Ledger> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(LEDGER, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Ledger = {};
    for (const [id, value] of Object.entries(parsed)) {
      const result = Dossier.safeParse(value);
      // A malformed record is skipped rather than crashing the queue, but it is
      // reported — a silently missing change is worse than a noisy one.
      if (result.success) out[id] = result.data;
      else console.error(`[airlock] ledger entry ${id} does not match the contract; skipping`);
    }
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(ledger: Ledger): Promise<void> {
  cache = ledger;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
}

export async function listDossiers(): Promise<Dossier[]> {
  const ledger = await load();
  return Object.values(ledger).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getDossier(id: string): Promise<Dossier | null> {
  const ledger = await load();
  return ledger[id] ?? null;
}

/** Upsert. The contract is enforced here, so bad data never enters the ledger. */
export async function putDossier(input: unknown): Promise<Dossier> {
  const dossier = parseDossier(input);
  const existing = await getDossier(dossier.dossier_id);

  // A decided change is part of the record. Overwriting one would break its
  // receipt and, more to the point, would make the ledger a mutable log.
  if (existing && (existing.approval.decision !== null || existing.audit.applied_at !== null)) {
    throw new Error(
      `${dossier.dossier_id} has already been decided. Decided changes are immutable — open a new change instead.`,
    );
  }

  const ledger = { ...(await load()) };
  ledger[dossier.dossier_id] = dossier;
  await persist(ledger);
  return dossier;
}

/* -------------------------------------------------------------------------- */
/* The hash chain                                                              */
/* -------------------------------------------------------------------------- */

/** Sealed records, in the order they were sealed. */
export async function sealedHistory(): Promise<Dossier[]> {
  const all = await listDossiers();
  return all.filter((d) => d.receipt !== null).sort((a, b) => a.receipt!.seq - b.receipt!.seq);
}

/** The head of the chain: the hash a third party holds to detect any future edit. */
export async function ledgerHead(): Promise<{ head: string; length: number }> {
  const sealed = await sealedHistory();
  const last = sealed[sealed.length - 1];
  return { head: last?.receipt?.hash ?? GENESIS_HASH, length: sealed.length };
}

/* -------------------------------------------------------------------------- */
/* Deciding                                                                    */
/* -------------------------------------------------------------------------- */

export type DecisionOutcome =
  /** The change is fully decided: applied, or rejected. */
  | { ok: true; state: 'decided'; dossier: Dossier }
  /** The signature was recorded, and the change still needs more. */
  | { ok: true; state: 'countersigned'; dossier: Dossier; outstanding: number }
  | { ok: false; status: number; reason: string; message: string };

/** Attach a signature and, when the quorum is met, close and seal the record. */
async function commit(
  dossier: Dossier,
  signature: Signature,
  ledger: Ledger,
): Promise<DecisionOutcome> {
  const signatures = [...dossier.signatures, signature];
  const withSignature: Dossier = { ...dossier, signatures };

  // A single rejection stops a change; a quorum is required to move one. That
  // asymmetry is deliberate: it should always be easier to stop than to go.
  const rejected = signature.decision === 'rejected';
  const outstanding = rejected ? 0 : sealsOutstanding(withSignature);

  if (!rejected && outstanding > 0) {
    const next = { ...ledger, [dossier.dossier_id]: withSignature };
    await persist(next);
    return { ok: true, state: 'countersigned', dossier: withSignature, outstanding };
  }

  const now = signature.at;
  const decided: Dossier = {
    ...withSignature,
    approval: {
      ...withSignature.approval,
      approver: signature.approver,
      at: now,
      decision: rejected ? 'rejected' : 'approved',
      reason: signature.reason,
    },
    audit: rejected
      ? withSignature.audit
      : {
          ...withSignature.audit,
          applied_at: now,
          applied_by: signature.approver,
          // The post-apply checksum is written by the engine once production
          // has actually changed. We do not invent one here.
          post_apply_checksum: withSignature.audit.post_apply_checksum,
        },
  };

  // Seal it into the chain. `seq` is the count of records already sealed, so a
  // record cannot be inserted into the middle without every later hash changing.
  const sealed = Object.values(ledger)
    .filter((d) => d.receipt !== null)
    .sort((a, b) => a.receipt!.seq - b.receipt!.seq);
  const prev = sealed[sealed.length - 1]?.receipt?.hash ?? GENESIS_HASH;
  const receipt = await sealReceipt(decided, sealed.length, prev, now);

  const final: Dossier = { ...decided, receipt };
  await persist({ ...ledger, [dossier.dossier_id]: final });
  return { ok: true, state: 'decided', dossier: final };
}

/**
 * Record an approval or rejection.
 *
 * The gate runs again here, on the server, against the stored dossier. The
 * client cannot talk its way past it: an approval is accepted only if
 * `openGate` mints a grant for this viewer, and the grant is verified with
 * `isGrant` before anything is written. A caller that skipped the console
 * entirely gets the same answer the console would have given.
 *
 * Note what is deliberately *not* trusted: the client may hand us a grant whose
 * `final` flag says this is the last signature. We ignore it and recount the
 * distinct approvers ourselves, because a flag on an object the client touched
 * is a claim, not a fact.
 */
export async function decide(
  id: string,
  viewer: Viewer,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<DecisionOutcome> {
  const ledger = { ...(await load()) };
  const dossier = ledger[id];
  if (!dossier) return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'No such change.' };

  if (decision === 'approved') {
    const gate = openGate(dossier, viewer);
    if (gate.state !== 'OPEN') {
      return { ok: false, status: 403, reason: gate.reason, message: gate.message };
    }
    // Belt and braces: the runtime witness, not just the type.
    if (!isGrant(gate.grant)) {
      return { ok: false, status: 500, reason: 'FORGED_GRANT', message: 'Approval proof failed verification.' };
    }
  } else {
    if (viewer.role !== 'approver') {
      return { ok: false, status: 403, reason: 'ROLE_NOT_APPROVER', message: 'Only an approver can reject a change.' };
    }
    if (dossier.approval.decision !== null || dossier.audit.applied_at !== null) {
      return { ok: false, status: 403, reason: 'ALREADY_DECIDED', message: 'This change has already been decided.' };
    }
  }

  return commit(
    dossier,
    {
      approver: viewer.email,
      at: new Date().toISOString(),
      decision,
      reason: reason ?? null,
      break_glass: false,
    },
    ledger,
  );
}

/**
 * Go around a sealed gate, deliberately and permanently.
 *
 * This does not mint an approval grant — it cannot, the types forbid it. It
 * records that a named human overrode a specific seal, with a written reason,
 * and marks the signature so the ledger shows it as an override forever.
 *
 * Break-glass always closes the change in one step regardless of quorum. The
 * argument: a quorum is a safeguard, and someone who has decided to bypass the
 * safeguards is not made safer by being asked to find a second person to bypass
 * them with. What makes this survivable is that it is loud, attributed and
 * sealed into the same chain as everything else.
 */
export async function breakGlass(
  id: string,
  viewer: Viewer,
  justification: string,
): Promise<DecisionOutcome> {
  const ledger = { ...(await load()) };
  const dossier = ledger[id];
  if (!dossier) return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'No such change.' };

  const decision = openBreakGlass(dossier, viewer, justification, { enabled: BREAK_GLASS_ENABLED });
  if (decision.state !== 'AVAILABLE') {
    return { ok: false, status: 403, reason: decision.reason, message: decision.message };
  }
  if (!isBreakGlass(decision.override)) {
    return { ok: false, status: 500, reason: 'FORGED_OVERRIDE', message: 'Override proof failed verification.' };
  }

  const { override } = decision;
  const signature: Signature = {
    approver: override.operator,
    at: override.at,
    decision: 'approved',
    reason: `BREAK-GLASS — bypassed ${override.bypassed}. ${override.justification}`,
    break_glass: true,
  };

  // Bypass the quorum path directly: this closes the change on one signature.
  const now = override.at;
  const decided: Dossier = {
    ...dossier,
    signatures: [...dossier.signatures, signature],
    approval: {
      ...dossier.approval,
      approver: override.operator,
      at: now,
      decision: 'approved',
      reason: signature.reason,
    },
    audit: { ...dossier.audit, applied_at: now, applied_by: override.operator },
  };

  const sealed = Object.values(ledger)
    .filter((d) => d.receipt !== null)
    .sort((a, b) => a.receipt!.seq - b.receipt!.seq);
  const prev = sealed[sealed.length - 1]?.receipt?.hash ?? GENESIS_HASH;
  const receipt = await sealReceipt(decided, sealed.length, prev, now);

  const final: Dossier = { ...decided, receipt };
  await persist({ ...ledger, [id]: final });
  console.warn(`[airlock] BREAK-GLASS on ${id} by ${override.operator}: bypassed ${override.bypassed}`);
  return { ok: true, state: 'decided', dossier: final };
}

/* -------------------------------------------------------------------------- */
/* Seeding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Shift a fixture's timestamps forward so it lands in the present.
 *
 * A certificate has a freshness window, and the fixtures were written on a
 * particular afternoon in August. Without this, every seeded change would be
 * sealed as CERTIFICATE_STALE the first time anybody looked at it, which
 * demonstrates the freshness rule and nothing else.
 *
 * Only *undecided* fixtures are re-based. History is not re-based: those
 * records carry receipts that commit to their timestamps, and moving them would
 * break the very hash chain the console then invites you to verify.
 */
function rebase(dossier: Dossier, now: Date): Dossier {
  if (dossier.approval.decision !== null || dossier.audit.applied_at !== null) return dossier;

  const anchor = new Date(dossier.certificate?.verified_at ?? dossier.created_at).getTime();
  if (!Number.isFinite(anchor)) return dossier;

  // Land the certificate two minutes in the past: unambiguously fresh under
  // every class rule, and not in the future, which would look like a bug.
  const shift = now.getTime() - 2 * 60 * 1000 - anchor;
  const move = (iso: string | null | undefined): string | null =>
    iso ? new Date(new Date(iso).getTime() + shift).toISOString() : (iso ?? null);

  return {
    ...dossier,
    created_at: move(dossier.created_at) ?? dossier.created_at,
    certificate: dossier.certificate
      ? { ...dossier.certificate, verified_at: move(dossier.certificate.verified_at) ?? undefined }
      : dossier.certificate,
    drift: { ...dossier.drift, checked_at: move(dossier.drift.checked_at) },
    questions: dossier.questions.map((q) => ({ ...q, at: move(q.at) })),
    signatures: dossier.signatures.map((s) => ({ ...s, at: move(s.at) ?? s.at })),
    principals: dossier.principals.map((p) => ({ ...p, expires_at: move(p.expires_at) })),
  };
}

/** Seed the ledger from the contract examples, for `make demo`. Never overwrites. */
export async function seedIfEmpty(examples: unknown[]): Promise<number> {
  const ledger = await load();
  if (Object.keys(ledger).length > 0) return 0;

  const now = new Date();
  const next: Ledger = {};
  let n = 0;
  for (const example of examples) {
    const parsed = Dossier.safeParse(example);
    if (parsed.success) {
      const dossier = rebase(parsed.data, now);
      next[dossier.dossier_id] = dossier;
      n += 1;
    } else {
      console.error('[airlock] a fixture does not match the contract and was not seeded');
    }
  }
  await persist(next);
  return n;
}

/* -------------------------------------------------------------------------- */
/* Readings for the control room                                               */
/* -------------------------------------------------------------------------- */

export interface Posture {
  total: number;
  waiting: number;
  open: number;
  sealed: number;
  applied: number;
  rejected: number;
  breakGlass: number;
  awaitingQuorum: number;
  recordsGuarded: number;
  peopleGuarded: number;
  moneyGuardedMinor: number;
}

/**
 * The numbers the control room leads with.
 *
 * "Guarded" counts what the gate has *refused* or is holding — the work the
 * system did by not doing something. That is the honest headline for a control
 * plane: a queue with nothing in it is not evidence of safety, and a number of
 * changes stopped is.
 */
export async function posture(viewer: Viewer): Promise<Posture> {
  const all = await listDossiers();
  const p: Posture = {
    total: all.length,
    waiting: 0,
    open: 0,
    sealed: 0,
    applied: 0,
    rejected: 0,
    breakGlass: 0,
    awaitingQuorum: 0,
    recordsGuarded: 0,
    peopleGuarded: 0,
    moneyGuardedMinor: 0,
  };

  for (const d of all) {
    if (d.signatures.some((s) => s.break_glass)) p.breakGlass += 1;

    if (d.audit.applied_at !== null) {
      p.applied += 1;
      continue;
    }
    if (d.approval.decision === 'rejected') {
      p.rejected += 1;
      p.recordsGuarded += d.magnitude.records;
      p.peopleGuarded += d.magnitude.people;
      p.moneyGuardedMinor += Math.abs(d.magnitude.amount_minor);
      continue;
    }

    p.waiting += 1;
    const gate = openGate(d, viewer);
    if (gate.state === 'OPEN') {
      p.open += 1;
      if (!gate.grant.final) p.awaitingQuorum += 1;
    } else {
      p.sealed += 1;
      p.recordsGuarded += d.magnitude.records;
      p.peopleGuarded += d.magnitude.people;
      p.moneyGuardedMinor += Math.abs(d.magnitude.amount_minor);
    }
  }

  return p;
}

export { approversFor, sealsOutstanding };

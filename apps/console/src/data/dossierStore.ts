import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { breakGlassEnabled, dataDir, seedDisabled } from './env';
import { activePolicy } from './policy';
import {
  Dossier,
  parseDossier,
  openGate,
  openBreakGlass,
  isGrant,
  isBreakGlass,
  approversFor,
  assessPostApply,
  assessUndo,
  requestUndo,
  undoRestored,
  undoWindowSeconds,
  hasProvenInverse,
  ruleFor,
  sealsOutstanding,
  sealReceipt,
  operationsFingerprint,
  GENESIS_HASH,
  type Signature,
  type Viewer,
} from '@airlock/contract';
import { deliverCertificate } from '@/github/deliver';

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

const DATA_DIR = dataDir();
const LEDGER = path.join(DATA_DIR, 'ledger.json');

/** Break-glass needs two switches. This is the deployment one; policy is the other. */
export const BREAK_GLASS_ENABLED = breakGlassEnabled();

type Ledger = Record<string, Dossier>;

let cache: Ledger | null = null;

/**
 * The ledger's mtime as of the last read, so a change on disk is noticed.
 *
 * Without this the cache was permanent: `load()` returned early forever, and the
 * file was re-read only by the process that happened to write it. That is not a
 * caching subtlety, it is the reason the console looked dead. AIRLOCK's whole
 * argument is that an *agent* opens changes, and the agent does not come through
 * this process — the MCP server posts to `AIRLOCK_CONSOLE_URL`, and any other
 * process serving the same `ledger.json` kept showing whatever it read at boot.
 * A genuinely proven change could sit on disk, in the very file the page is
 * serving from, and never appear until somebody restarted the server.
 *
 * One `stat` per read is the cost, and it makes the store honest: what the
 * console shows is what is on disk now, not what was there when it started.
 */
let cachedMtimeMs = -1;

async function currentMtime(): Promise<number> {
  try {
    return (await fs.stat(LEDGER)).mtimeMs;
  } catch {
    // No file yet. -1 is distinct from any real mtime, so the first write is
    // seen as a change rather than mistaken for an unchanged empty ledger.
    return -1;
  }
}

async function load(): Promise<Ledger> {
  const mtime = await currentMtime();
  if (cache && mtime === cachedMtimeMs) return cache;
  cachedMtimeMs = mtime;
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

  // Seed here rather than in the route that happens to be read first.
  //
  // This used to live in `GET /api/dossiers`, which meant the fixtures existed
  // only once something had listed them. Anyone who went straight at a single
  // change — the curl in the README does exactly that — got `404 NOT_FOUND`
  // from a system that was working correctly, which reads as a false claim
  // rather than an ordering quirk. Seeding at the one place every route already
  // funnels through makes the store's behaviour independent of arrival order.
  //
  // Re-entry is not a risk: `cache` is assigned above, so the `seedIfEmpty`
  // below re-enters `load()` and returns on the first line.
  if (Object.keys(cache).length === 0) {
    seeding ??= seedFromExamples();
    await seeding;
  }

  return cache;
}

/** One in-flight seed, however many requests arrive together on a cold start. */
let seeding: Promise<void> | null = null;

async function seedFromExamples(): Promise<void> {
  if (seedDisabled()) return;
  const dir = examplesDir();
  if (!dir) return;
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'));
    const examples = await Promise.all(
      names.map(async (n) => JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')) as unknown),
    );
    if (examples.length > 0) await seedIfEmpty(examples);
  } catch {
    // No fixtures is a legitimate state — an empty console, not a broken one.
  }
}

/**
 * Find `contracts/examples`, walking up from wherever the process was started.
 *
 * `next dev` runs with cwd at `apps/console`, but `npm start` from the repo
 * root does not, and a fixed `../../` resolves to nothing in the second case —
 * an empty queue with no error, which is the worst way for this to fail.
 */
function examplesDir(): string | null {
  let dir = process.cwd();
  for (let up = 0; up < 5; up += 1) {
    const candidate = path.join(dir, 'contracts', 'examples');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function persist(ledger: Ledger): Promise<void> {
  cache = ledger;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
  // Record the mtime we just produced, so our own write does not read back as
  // somebody else's change on the very next request.
  cachedMtimeMs = await currentMtime();
}

export async function listDossiers(): Promise<Dossier[]> {
  const ledger = await load();
  return Object.values(ledger).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getDossier(id: string): Promise<Dossier | null> {
  const ledger = await load();
  return ledger[id] ?? null;
}


/* -------------------------------------------------------------------------- */
/* The write lock                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every read-modify-write of the ledger runs one at a time.
 *
 * Without this, two approvals arriving together forked the hash chain. Each
 * one snapshotted the ledger, computed `seq` as the count of records already
 * sealed and `prev` as the last hash, then awaited `sealReceipt` — a genuine
 * yield, because it awaits `subtle.digest`. Both resumed holding the same `seq`
 * and the same `prev`, and each wrote its whole stale snapshot back.
 *
 * The result was two records claiming the same position in the chain, and the
 * second write silently discarding the first approval entirely. A tamper-evident
 * ledger that can fork under ordinary concurrent use is not tamper-evident; it
 * is a log with a hash column.
 *
 * The lock is a promise chain rather than a flag, so callers queue instead of
 * failing, and it survives a rejection — `operation` is passed as both handlers
 * so one failed write cannot wedge every subsequent one. Each operation loads
 * the ledger *inside* the critical section, which is the part that actually
 * matters: `persist` updates the cache, so the next holder reads what the
 * previous one wrote.
 *
 * In-process only, and that is a real limit worth naming. Two Node processes
 * serving the same ledger.json would still race, and the fix for that is a lock
 * file or a database rather than a bigger promise chain. One process is what
 * this deployment is, and a correct guarantee for it beats an imagined one for
 * a topology that does not exist yet.
 */
let ledgerLock: Promise<unknown> = Promise.resolve();

function withLedgerLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = ledgerLock.then(operation, operation);
  ledgerLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Upsert. The contract is enforced here, so bad data never enters the ledger. */
async function putDossier__inner(input: unknown): Promise<Dossier> {
  const parsed = parseDossier(input);

  /*
   * Stamp what the statements are NOW, ignoring anything the caller sent.
   *
   * This is the half of the operations binding that has to live at the write
   * seam. The certificate carries the fingerprint of the SQL it was measured
   * against; this carries the fingerprint of the SQL as it currently stands,
   * and the gate refuses when they differ.
   *
   * Recomputed rather than read, always. If a posted value were trusted, the
   * whole control would reduce to "the caller must send a matching string",
   * which is the same mistake as trusting `checksums.match` — and this endpoint
   * is reachable by the agent.
   */
  const dossier = {
    ...parsed,
    operations_fingerprint: await operationsFingerprint(parsed.forward, parsed.rollback),
  };
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

  /*
   * A certificate that has just arrived goes back to where the change came
   * from.
   *
   * This is the one place every write lands — the console UI, the webhook and
   * the agent's own `airlock_attach_certificate` all come through here — so it
   * is the only place the delivery can be hooked without it being possible to
   * attach a certificate by some other route and have it go unreported.
   *
   * It is deliberately not allowed to fail the write. Persisting the proof is
   * the important half; telling GitHub about it is best-effort, and a dossier
   * that is saved but undelivered is recoverable, while the reverse is not.
   */
  const delivered = await deliverCertificate(dossier).catch(() => null);
  if (delivered) {
    ledger[delivered.dossier_id] = delivered;
    await persist(ledger);
    return delivered;
  }

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

/**
 * Stamp the undo window onto a change at the moment it is applied.
 *
 * Written once, here, rather than derived on every read. The window is a
 * promise made at a particular instant under a particular policy, and a policy
 * file can be edited afterwards — recomputing it later would silently move a
 * deadline a human was already relying on, in whichever direction the edit
 * happened to go.
 *
 * Only stamped when a proven inverse exists, so the presence of `expires_at` in
 * the record means there is genuinely something to run, not merely that policy
 * would have permitted it.
 */
function withUndoWindow(dossier: Dossier, appliedAt: string): Dossier {
  if (!hasProvenInverse(dossier)) return dossier;

  const seconds = undoWindowSeconds(dossier, ruleFor(activePolicy(), dossier.change_class));
  if (seconds === null) return dossier;

  const landed = new Date(appliedAt).getTime();
  if (!Number.isFinite(landed)) return dossier;

  return {
    ...dossier,
    undo: { ...dossier.undo, expires_at: new Date(landed + seconds * 1000).toISOString() },
  };
}

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
  const outstanding = rejected ? 0 : sealsOutstanding(withSignature, { policy: activePolicy() });

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

  // A change that is going in gets its undo window now. A rejected one never
  // landed, so there is nothing to take back.
  const stamped = rejected ? decided : withUndoWindow(decided, now);

  // Seal it into the chain. `seq` is the count of records already sealed, so a
  // record cannot be inserted into the middle without every later hash changing.
  const sealed = Object.values(ledger)
    .filter((d) => d.receipt !== null)
    .sort((a, b) => a.receipt!.seq - b.receipt!.seq);
  const prev = sealed[sealed.length - 1]?.receipt?.hash ?? GENESIS_HASH;
  const receipt = await sealReceipt(stamped, sealed.length, prev, now);

  const final: Dossier = { ...stamped, receipt };
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
async function decide__inner(
  id: string,
  viewer: Viewer,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<DecisionOutcome> {
  const ledger = { ...(await load()) };
  const dossier = ledger[id];
  if (!dossier) return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'No such change.' };

  if (decision === 'approved') {
    const gate = openGate(dossier, viewer, { policy: activePolicy() });
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
async function breakGlass__inner(
  id: string,
  viewer: Viewer,
  justification: string,
): Promise<DecisionOutcome> {
  const ledger = { ...(await load()) };
  const dossier = ledger[id];
  if (!dossier) return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'No such change.' };

  const decision = openBreakGlass(dossier, viewer, justification, {
    enabled: BREAK_GLASS_ENABLED,
    policy: activePolicy(),
  });
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

  // Break-glass changes get an undo window like any other, and arguably need it
  // most: a change that went in around the safeguards is the one most likely to
  // want taking back twenty minutes later.
  const stamped = withUndoWindow(decided, now);

  const sealed = Object.values(ledger)
    .filter((d) => d.receipt !== null)
    .sort((a, b) => a.receipt!.seq - b.receipt!.seq);
  const prev = sealed[sealed.length - 1]?.receipt?.hash ?? GENESIS_HASH;
  const receipt = await sealReceipt(stamped, sealed.length, prev, now);

  const final: Dossier = { ...stamped, receipt };
  await persist({ ...ledger, [id]: final });
  console.warn(`[airlock] BREAK-GLASS on ${id} by ${override.operator}: bypassed ${override.bypassed}`);
  return { ok: true, state: 'decided', dossier: final };
}

/* -------------------------------------------------------------------------- */
/* After it lands                                                              */
/* -------------------------------------------------------------------------- */

export type PostApplyResult =
  | { ok: true; state: 'HEALTHY' | 'REVERT' | 'ALARM' | 'NOT_CHECKED'; message: string; dossier: Dossier }
  | { ok: false; status: number; reason: string; message: string };

/**
 * Record what production looked like once the change landed, and act on it.
 *
 * This is the seam the verification engine writes through: it applies the
 * change, re-checksums production, and posts the digest here. AIRLOCK decides
 * what that means — and the decision is made by `assessPostApply`, which is
 * pure and tested, not by this function.
 *
 * The one thing worth stating plainly: a REVERT outcome means AIRLOCK *asks*
 * for the rollback to be executed, and records that it did. It will only ever
 * ask for a rollback it has proof of. A change with no proven inverse produces
 * an ALARM and nothing is touched, because running an untested rollback against
 * a database already in an unexpected state turns a bad afternoon into a bad
 * quarter.
 *
 * Note what this is allowed to change: `post_apply`, and nothing else. A
 * decided record is otherwise immutable, and `post_apply` sits outside the
 * receipt body precisely so recording it cannot break the hash chain.
 */
async function recordPostApply__inner(
  id: string,
  observed: string | null,
  options: { durationMs?: number; rolledBack?: boolean } = {},
): Promise<PostApplyResult> {
  const ledger = { ...(await load()) };
  const dossier = ledger[id];
  if (!dossier) return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'No such change.' };

  if (dossier.audit.applied_at === null) {
    return {
      ok: false,
      status: 409,
      reason: 'NOT_APPLIED',
      message: 'This change has not been applied, so there is nothing to health-check.',
    };
  }

  const outcome = assessPostApply(dossier, observed);
  const now = new Date().toISOString();
  const reverted = outcome.state === 'REVERT';

  const next: Dossier = {
    ...dossier,
    post_apply: {
      checked_at: now,
      observed_checksum: observed,
      expected_checksum: dossier.certificate?.checksums?.post ?? null,
      healthy: outcome.state === 'HEALTHY' ? true : outcome.state === 'NOT_CHECKED' ? null : false,
      rolled_back_at: reverted ? now : dossier.post_apply.rolled_back_at,
      rollback_reason: reverted ? outcome.message : dossier.post_apply.rollback_reason,
      duration_ms: options.durationMs ?? dossier.post_apply.duration_ms,
    },
  };

  await persist({ ...ledger, [id]: next });

  if (outcome.state === 'ALARM') {
    console.warn(`[airlock] POST-APPLY ALARM on ${id}: ${outcome.reason} — ${outcome.message}`);
  }
  if (reverted) {
    console.warn(`[airlock] POST-APPLY REVERT on ${id}: production did not match the certificate`);
  }

  return { ok: true, state: outcome.state, message: outcome.message, dossier: next };
}

/* -------------------------------------------------------------------------- */
/* Taking it back                                                              */
/* -------------------------------------------------------------------------- */

export type UndoResult =
  | { ok: true; dossier: Dossier; message: string; operations: Dossier['rollback'] }
  | { ok: false; status: number; reason: string; message: string };

/**
 * Take an applied change back, inside its window.
 *
 * The decision is `requestUndo`, which is pure and lives in the contract. This
 * function does the two things that cannot be pure: it checks the clock on the
 * server, and it writes.
 *
 * The server clock is the point. A countdown rendered in a browser is
 * decoration — it can be paused by a sleeping laptop, wound back by a system
 * clock, or simply looked at a minute after it stopped being true. So the
 * window is re-evaluated here, from `audit.applied_at`, against this machine's
 * time, on every request. A press that was legitimate when the button was drawn
 * and arrives after the window closed is refused, and told exactly when it
 * closed.
 *
 * What is written is `undo` and nothing else, for the same reason `post_apply`
 * is: a decided record is immutable, and `undo` sits outside the sealed body so
 * recording one cannot break the hash chain. The original approval remains
 * exactly as it was, because it genuinely happened and was correctly decided —
 * an undo is a later fact about the world, not a revision of the decision.
 *
 * `restoredChecksum` comes from whatever actually ran the statements. When it
 * is absent the undo is recorded as unmeasured rather than as successful:
 * nothing here is entitled to claim production came back just because no error
 * was thrown.
 */
async function undoChange__inner(
  id: string,
  viewer: Viewer,
  reason: string,
  restoredChecksum?: string | null,
): Promise<UndoResult> {
  const ledger = { ...(await load()) };
  const dossier = ledger[id];
  if (!dossier) return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'No such change.' };

  const decision = requestUndo(dossier, { email: viewer.email, role: viewer.role }, { policy: activePolicy() });
  if (decision.state === 'REFUSED') {
    return { ok: false, status: 403, reason: decision.reason, message: decision.message };
  }

  const now = new Date().toISOString();
  const observed = restoredChecksum ?? null;
  const restored = undoRestored(dossier, observed);

  const next: Dossier = {
    ...dossier,
    undo: {
      ...dossier.undo,
      expires_at: decision.expiresAt,
      undone_at: now,
      undone_by: viewer.email,
      reason,
      restored_checksum: observed,
      restored,
    },
  };

  await persist({ ...ledger, [id]: next });

  // Loud on purpose. An undo is production being written to on the strength of
  // a proof taken earlier, which is exactly the kind of event that should be
  // trivial to find in a log at 3am.
  console.warn(
    `[airlock] UNDO on ${id} by ${viewer.email} — ${decision.operations.length} proven rollback operation(s)`,
  );
  if (restored === false) {
    console.error(`[airlock] UNDO on ${id} did NOT restore production to its pre-migration checksum`);
  }

  const message =
    restored === true
      ? 'Taken back. Production matches the checksum it started from.'
      : restored === false
        ? 'The rollback ran and production did NOT return to its starting state. This needs a human now.'
        : 'Taken back. The proven rollback was issued; the result has not been checksummed.';

  return { ok: true, dossier: next, message, operations: decision.operations };
}

/** What the console needs to draw the window, computed with the server's clock. */
export async function undoAvailability(id: string) {
  const dossier = await getDossier(id);
  if (!dossier) return null;
  return assessUndo(dossier, { policy: activePolicy() });
}

/* -------------------------------------------------------------------------- */
/* Clearing a quarantine finding                                               */
/* -------------------------------------------------------------------------- */

export type ClearResult =
  | { ok: true; dossier: Dossier; message: string }
  | { ok: false; status: number; reason: string; message: string };

/** A reason short enough to type, long enough that "ok" does not pass. */
export const MIN_CLEAR_REASON = 20;

/**
 * Dismiss injection findings on a change, deliberately and permanently.
 *
 * There has to be a way past a detector. Every detector over natural language
 * has false positives, and a control plane that can be bricked forever by
 * somebody writing "ignore previous instructions" in their bio — or by a
 * marketing page quoting an article about prompt injection — is a control plane
 * that gets switched off within a week.
 *
 * What there must not be is a *quiet* way past. So this is attributed,
 * timestamped, reason-bearing, and the findings themselves are kept: clearing
 * dismisses them, it does not erase them. All of it lands inside the receipt
 * body, so an auditor reading a sealed record sees both the attempt and the
 * judgement that it was not one.
 *
 * Only an approver may clear, for the same reason only an approver may open the
 * gate — this is a decision about whether to trust production input, not a
 * formality.
 */
async function clearInjection__inner(
  id: string,
  viewer: Viewer,
  reason: string,
): Promise<ClearResult> {
  const ledger = { ...(await load()) };
  const dossier = ledger[id];
  if (!dossier) return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'No such change.' };

  if (viewer.role !== 'approver') {
    return {
      ok: false,
      status: 403,
      reason: 'ROLE_NOT_APPROVER',
      message: 'Deciding that a production input is safe to act on requires an approver.',
    };
  }

  if (dossier.untrusted.findings.length === 0) {
    return {
      ok: false,
      status: 409,
      reason: 'NOTHING_TO_CLEAR',
      message: 'This change has no injection findings.',
    };
  }

  if (dossier.untrusted.cleared_at !== null) {
    return { ok: false, status: 409, reason: 'ALREADY_CLEARED', message: 'These findings have already been cleared.' };
  }

  const trimmed = reason.trim();
  if (trimmed.length < MIN_CLEAR_REASON) {
    return {
      ok: false,
      status: 400,
      reason: 'REASON_TOO_SHORT',
      message: `Dismissing a security finding needs a written reason of at least ${MIN_CLEAR_REASON} characters.`,
    };
  }

  if (dossier.approval.decision !== null || dossier.audit.applied_at !== null) {
    return { ok: false, status: 403, reason: 'ALREADY_DECIDED', message: 'This change has already been decided.' };
  }

  const next: Dossier = {
    ...dossier,
    untrusted: {
      ...dossier.untrusted,
      cleared_at: new Date().toISOString(),
      cleared_by: viewer.email,
      cleared_reason: trimmed,
    },
  };

  await persist({ ...ledger, [id]: next });

  // Loud, because somebody has just decided that content which tried to issue
  // instructions to a production agent is safe to act on. They may well be
  // right. It should still be trivial to find later.
  console.warn(
    `[airlock] INJECTION FINDINGS CLEARED on ${id} by ${viewer.email} (${dossier.untrusted.findings.length} finding(s)): ${trimmed}`,
  );

  return {
    ok: true,
    dossier: next,
    message: 'Findings cleared. They remain on the record, and this decision is sealed with the change.',
  };
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
  const policy = activePolicy();
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
    const gate = openGate(d, viewer, { policy });
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

/* -------------------------------------------------------------------------- */
/* The serialised surface                                                      */
/* -------------------------------------------------------------------------- */

/*
 * Every mutation of the ledger, wrapped in the lock.
 *
 * Exported through wrappers rather than by locking inside each body, so that
 * the guarantee is visible in one place — a reader can see the complete list of
 * things that write, and a new one added without a wrapper is conspicuous.
 * The casts preserve each original signature exactly; the wrapper adds
 * ordering and nothing else.
 *
 * `seedIfEmpty` is deliberately NOT here. It is called from `load()`, so taking
 * the lock would deadlock the first read that triggers seeding. It is already
 * single-flighted by the `seeding` promise above.
 */
export const putDossier = ((...args: Parameters<typeof putDossier__inner>) =>
  withLedgerLock(() => putDossier__inner(...args))) as typeof putDossier__inner;

export const decide = ((...args: Parameters<typeof decide__inner>) =>
  withLedgerLock(() => decide__inner(...args))) as typeof decide__inner;

export const breakGlass = ((...args: Parameters<typeof breakGlass__inner>) =>
  withLedgerLock(() => breakGlass__inner(...args))) as typeof breakGlass__inner;

export const recordPostApply = ((...args: Parameters<typeof recordPostApply__inner>) =>
  withLedgerLock(() => recordPostApply__inner(...args))) as typeof recordPostApply__inner;

export const undoChange = ((...args: Parameters<typeof undoChange__inner>) =>
  withLedgerLock(() => undoChange__inner(...args))) as typeof undoChange__inner;

export const clearInjection = ((...args: Parameters<typeof clearInjection__inner>) =>
  withLedgerLock(() => clearInjection__inner(...args))) as typeof clearInjection__inner;

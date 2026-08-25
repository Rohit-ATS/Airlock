/**
 * Resolved context — the facts the agent looked up instead of asking you for.
 *
 * The division this module exists to enforce:
 *
 *   A FACT lives in a system of record. The currency on a Stripe account, a
 *   user's country code, a row's created_at, the number of rows an index
 *   covers. There is exactly one correct answer and a machine can go and get
 *   it. An agent that asks a human for one of these is not integrated — it is
 *   making a person be the integration, and calling the result an agent.
 *
 *   A DECISION lives nowhere. Should statutory invoices survive the erasure?
 *   Is this the right cohort? Do you approve? No connector holds these, and an
 *   agent that infers them is doing the precise thing AIRLOCK exists to stop.
 *
 * So: resolve everything resolvable, and ask exactly one class of question.
 * That makes the questions AIRLOCK does ask louder rather than quieter. When a
 * country code and a statutory retention judgement arrive as the same kind of
 * event, neither reads as important. Delete the first and the second becomes
 * unmistakable — the only thing the system ever stops for is judgement.
 *
 * ---------------------------------------------------------------------------
 * Why this is a safety feature and not a convenience layer
 *
 * Auto-filled facts feeding an irreversible action is exactly where
 * time-of-check/time-of-use bites. A `country_code` read at 14:02 and approved
 * at 14:40 is an assumption by 14:40, not a measurement — and worse, a value
 * read out of a user-writable column is attacker-controlled input arriving at
 * an agent that holds production credentials.
 *
 * Both are handled the same way the rest of AIRLOCK handles this class of
 * problem, rather than with a new mechanism:
 *
 *   - every resolved value is pinned into the certificate as a fingerprint, so
 *     what was proven is proven *about a specific set of facts*;
 *   - the set is re-resolved before the gate opens and the two fingerprints
 *     compared, so a fact that moved underneath the proof seals the door — the
 *     same shape as the production-drift check;
 *   - a value from a user-writable source is marked as such and goes through
 *     the existing injection scanner, not a second one.
 *
 * A fact nobody re-checked is a claim. This module is what turns it back into
 * a measurement at the moment it matters.
 */
import { canonicalJson, sha256 } from './receipt.js';
import { scanUntrusted, type InjectionFinding } from './quarantine.js';
import type { ChangeClass } from './dossier.js';

/* -------------------------------------------------------------------------- */
/* The shape of a resolved fact                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a value came from, in terms of who could have written it.
 *
 * `SYSTEM` is a fact the platform itself produced — a Stripe account currency,
 * a Postgres column type, a row count. Nobody types these.
 *
 * `USER_WRITABLE` is a fact that is *also* a text box somebody filled in. A
 * display name, a bio, a support ticket body, a PR description. The value is
 * still a fact about the record; it is just not a fact anyone should trust the
 * *contents* of, because letting people type into a field is the point of the
 * field. These are scanned before they are believed.
 */
export const RESOLUTION_TRUST = ['SYSTEM', 'USER_WRITABLE'] as const;
export type ResolutionTrust = (typeof RESOLUTION_TRUST)[number];

/**
 * `RESOLVED` — one answer, and it is in `value`.
 * `AMBIGUOUS` — more than one answer, and `candidates` lists them. This is the
 *   only state that legitimately becomes a question, and it must be asked with
 *   the candidates shown rather than as an empty box.
 * `UNRESOLVED` — no answer. The connector is missing, the record is not there,
 *   or the lookup failed. Never quietly defaulted.
 */
export const RESOLUTION_STATUSES = ['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED'] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

/**
 * Structural, not the zod type.
 *
 * The schema lives in dossier.ts with every other schema, and this module holds
 * the logic — the same split quarantine.ts and review.ts already use. It also
 * means these functions can be handed a plain object in a test without building
 * a whole dossier to get at them.
 */
export interface ResolvedFact {
  /** Machine name, e.g. `currency`. Stable — the fingerprint is keyed on it. */
  field: string;
  /** What to call it in the console, e.g. "Currency". */
  label: string;
  status: ResolutionStatus;
  /** The answer. Null unless status is RESOLVED — an unresolved fact has no value. */
  value: string | null;
  /** Which system answered: `stripe`, `postgres`, `github`… */
  system: string;
  /**
   * Where in that system, precisely enough to go and look: `acct_1Nx…`,
   * `users.country_code`, `orders.created_at`. This is the difference between
   * provenance and a logo.
   */
  locator: string;
  /**
   * The harness event that produced it, when there was one. Present means the
   * value is MEASURED in the provenance sense and the console can link the
   * chip to the tool call that fetched it.
   */
  event_id: string | null;
  trust: ResolutionTrust;
  /** Populated only when AMBIGUOUS. The options a human is being shown. */
  candidates: string[];
  resolved_at: string | null;
}

/**
 * The resolved set, plus the two fingerprints that make it load-bearing.
 *
 * `fingerprint` is taken when the facts are resolved. `recheck_fingerprint` is
 * taken again immediately before the gate is evaluated. The gate compares them
 * — it does not recompute either, for the same reason it never recomputes a
 * checksum: the comparison has to be cheap and synchronous at the door, and
 * the expensive part belongs to whoever did the work.
 */
export interface ResolvedContext {
  facts: ResolvedFact[];
  fingerprint: string | null;
  rechecked_at: string | null;
  recheck_fingerprint: string | null;
}

export const EMPTY_RESOLVED_CONTEXT: ResolvedContext = {
  facts: [],
  fingerprint: null,
  rechecked_at: null,
  recheck_fingerprint: null,
};

/* -------------------------------------------------------------------------- */
/* What each class of change needs to know before it can be planned            */
/* -------------------------------------------------------------------------- */

/**
 * The fields a change class cannot proceed without.
 *
 * This is deliberately a short list per class rather than an exhaustive one.
 * Every entry here is a fact the gate will refuse to open without, so adding a
 * field is a promise that it is genuinely required and genuinely resolvable —
 * a required field nobody can resolve is a permanently sealed door.
 */
export const REQUIRED_FIELDS: Record<ChangeClass, readonly string[]> = {
  SCHEMA_MIGRATION: ['target_table', 'row_count'],
  DATA_OPERATION: ['target_table', 'row_count'],
  ERASURE: ['subject_id', 'systems_holding'],
  ACCESS_GRANT: ['principal_id', 'expires_at'],
  MONEY_MOVEMENT: ['account_id', 'currency'],
  COMMS_BLAST: ['audience_id', 'recipient_count'],
  INFRA_MUTATION: ['resource_id'],
};

/**
 * Whether this dossier participates in resolution at all.
 *
 * Resolution is opt-in per dossier, for the same reason the code review gate is
 * opt-in per dossier: `reviewBlocks` only blocks a change that actually carries
 * code the agent wrote. A verifier that predates this feature, or a change with
 * nothing to look up, produces an empty set — and a gate that sealed every one
 * of those would not be strict, it would be broken.
 *
 * Once a dossier opts in, it is held to the whole rule. That asymmetry is the
 * point: the cost of resolving one fact is that you must resolve all of them.
 */
export function usesResolution(context: ResolvedContext | null | undefined): boolean {
  return (context?.facts ?? []).length > 0;
}

/**
 * Everything standing between this change and a plan: required fields that
 * never resolved, plus any fact the agent did produce that came back ambiguous
 * or empty.
 *
 * Both halves matter. The first catches an agent that skipped a lookup; the
 * second catches one that tried, got two customers back, and carried on.
 */
export function outstandingFields(
  changeClass: ChangeClass,
  context: ResolvedContext | null | undefined,
): string[] {
  if (!usesResolution(context)) return [];

  const facts = context?.facts ?? [];
  const byField = new Map(facts.map((f) => [f.field, f]));
  const required = REQUIRED_FIELDS[changeClass] ?? [];

  const missing = required.filter((name) => byField.get(name)?.status !== 'RESOLVED');
  const unfinished = facts.filter((f) => f.status !== 'RESOLVED').map((f) => f.field);

  return [...new Set([...missing, ...unfinished])];
}

/**
 * True when the change cannot be planned yet, because something it needs is
 * ambiguous or missing.
 *
 * The gate treats this the same way it treats a detected injection: it seals
 * *before* looking at the certificate. The reasoning is identical. A
 * certificate proves a set of operations reversible; it says nothing about
 * whether those operations were aimed at the right rows. A proof about an
 * unidentified subject is impeccable and irrelevant.
 */
export function contextUnresolved(
  changeClass: ChangeClass,
  context: ResolvedContext | null | undefined,
): boolean {
  return outstandingFields(changeClass, context).length > 0;
}

/** The ambiguous facts, which are the only ones that should become questions. */
export function ambiguousFacts(context: ResolvedContext | null | undefined): ResolvedFact[] {
  return (context?.facts ?? []).filter((f) => f.status === 'AMBIGUOUS');
}

/* -------------------------------------------------------------------------- */
/* Fingerprinting                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The canonical form a fingerprint is taken over.
 *
 * Only the parts whose change would mean the proof is about something else:
 * which field, what it resolved to, and where that came from. Deliberately
 * NOT `resolved_at` or `event_id` — re-resolving the same fact a minute later
 * produces a new timestamp and a new event id, and if those were in the
 * fingerprint every recheck would report drift and the check would be turned
 * off within a day. A drift alarm that always fires is an alarm nobody hears.
 *
 * Sorted by field, so the order the agent happened to resolve things in does
 * not change the answer.
 */
export function canonicalResolution(facts: readonly ResolvedFact[]): string {
  const rows = facts
    .filter((f) => f.status === 'RESOLVED')
    .map((f) => ({ field: f.field, value: f.value, system: f.system, locator: f.locator }))
    .sort((a, b) => a.field.localeCompare(b.field));
  return canonicalJson(rows);
}

/** `sha256:…` over the canonical form. */
export function resolutionFingerprint(facts: readonly ResolvedFact[]): Promise<string> {
  return sha256(canonicalResolution(facts));
}

/**
 * Did the facts move between the proof and the door?
 *
 * Only ever answers `true` on evidence. A missing recheck is not drift — it is
 * an *absent check*, and those are two different failures that must not be
 * reported as one. `contextRecheckMissing` is the one that catches the second,
 * so neither can hide inside the other.
 */
export function contextDrifted(
  pinned: string | null | undefined,
  recheck: string | null | undefined,
): boolean {
  if (!pinned || !recheck) return false;
  return pinned !== recheck;
}

/**
 * A proof that pinned a fingerprint, on a dossier that never re-checked it.
 *
 * Treated as a refusal rather than a pass, because the whole point of pinning
 * was to compare later. Silence here means the comparison did not happen, and
 * "we did not look" must never render as "we looked and it was fine" — the
 * same rule the post-apply health check follows.
 */
export function contextRecheckMissing(
  pinned: string | null | undefined,
  context: ResolvedContext | null | undefined,
): boolean {
  if (!pinned) return false;
  return !context?.recheck_fingerprint;
}

/* -------------------------------------------------------------------------- */
/* Untrusted values                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Run the user-writable facts through the injection scanner.
 *
 * The existing one, deliberately. A second detector with its own rules would
 * drift from the first, and then a payload caught in a `users.bio` read through
 * one path would sail through the other — which is worse than having only one
 * of them, because the coverage looks doubled.
 */
export function scanResolvedFacts(facts: readonly ResolvedFact[]): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const fact of facts) {
    if (fact.trust !== 'USER_WRITABLE' || !fact.value) continue;
    findings.push(...scanUntrusted(fact.value, 'db_row', `${fact.system}:${fact.locator}`));
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Readings for the console                                                    */
/* -------------------------------------------------------------------------- */

export interface ResolutionSummary {
  total: number;
  resolved: number;
  asking: number;
  missing: number;
  /** How many of the resolved values came from a source a person can write to. */
  untrusted: number;
}

export function summariseResolution(context: ResolvedContext | null | undefined): ResolutionSummary {
  const facts = context?.facts ?? [];
  return {
    total: facts.length,
    resolved: facts.filter((f) => f.status === 'RESOLVED').length,
    asking: facts.filter((f) => f.status === 'AMBIGUOUS').length,
    missing: facts.filter((f) => f.status === 'UNRESOLVED').length,
    untrusted: facts.filter((f) => f.status === 'RESOLVED' && f.trust === 'USER_WRITABLE').length,
  };
}

/** One line for the card: "11 of 12 resolved · 1 asking". */
export function describeResolution(context: ResolvedContext | null | undefined): string {
  const s = summariseResolution(context);
  if (s.total === 0) return 'Nothing was looked up for this change.';

  const parts = [`${s.resolved} of ${s.total} resolved`];
  if (s.asking > 0) parts.push(`${s.asking} asking`);
  if (s.missing > 0) parts.push(`${s.missing} unresolved`);
  return parts.join(' · ');
}

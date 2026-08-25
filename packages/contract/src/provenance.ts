/**
 * Where each number came from.
 *
 * A change dossier is dense with figures — three checksums, a lock estimate, a
 * record count, a blast radius, a cost. Every one of them is asking a human to
 * believe something, and on most dashboards they are all rendered identically:
 * same weight, same colour, same implied authority. That is the problem this
 * module exists to fix, because those figures are emphatically *not* equally
 * well founded.
 *
 * A checksum was measured, by a sandbox, at a recorded instant, and the harness
 * event that produced it can be pointed at. A record count was very often
 * simply asserted by the agent in the text of its own dossier. Both look like
 * evidence. Only one is.
 *
 * So every claim carries its source, and the console makes it clickable: press
 * the lock estimate and you land on the sandbox log line that produced it.
 * Press the record count and you are told, in as many words, that the agent
 * asserted it and nothing measured it.
 *
 * The rule that makes this worth having is the same one the capability lamps
 * follow: **an unsourced claim must say it is unsourced.** It would be trivial
 * to default to "derived from the dossier" and have every number look
 * accounted for. A provenance system that never says "nothing backs this" is
 * decoration.
 */
import type { Dossier, HarnessEvent } from './dossier.js';
import { formatMoney } from './dossier.js';

/* -------------------------------------------------------------------------- */
/* Claims                                                                      */
/* -------------------------------------------------------------------------- */

export const CLAIM_KEYS = [
  'checksum_pre',
  'checksum_post',
  'checksum_post_rollback',
  'lock_ms',
  'records',
  'people',
  'amount',
  'scope',
  'drift',
  'undo_window',
  'post_apply',
  'cost',
  'approval',
] as const;

export type ClaimKey = (typeof CLAIM_KEYS)[number];

/**
 * How much weight a figure can bear.
 *
 * Ordered deliberately, worst first, because the interesting question a reader
 * has is "is this weaker than it looks" rather than "is this as good as it
 * gets".
 */
export type Grade =
  /** Nothing in the record backs this. The console must say so. */
  | 'UNSOURCED'
  /** The agent asserted it. No independent process checked it. */
  | 'DECLARED'
  /** AIRLOCK computed it from other fields, and the computation is inspectable. */
  | 'COMPUTED'
  /** A harness event produced it, and that event can be pointed at. */
  | 'MEASURED';

export interface Trace {
  claim: ClaimKey;
  /** What to call it on screen. */
  label: string;
  /** The figure, already formatted for display. Empty when there is no value. */
  value: string;
  grade: Grade;
  /** One sentence, written for a stranger, saying how this number came to exist. */
  explains: string;
  /**
   * The harness event this is anchored to, when one exists. This is what makes
   * the figure clickable: the console scrolls the sandbox log to this step.
   */
  stepId: string | null;
  /** The raw harness event type — `sandbox.created`, `tool.response`. */
  evidence: string | null;
  capability: number | null;
  /** When it was established. */
  at: string | null;
}

/* -------------------------------------------------------------------------- */
/* Anchors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which capability's evidence backs a measured claim.
 *
 * Capability 5 is the sandbox, and it is the anchor for everything the shadow
 * branch established: the checksum triple and the lock estimate were all
 * produced by statements executed in there. Capability 13 is the approval
 * checkpoint, which is what makes a signature a fact about the harness rather
 * than about our own database.
 */
const CLAIM_CAPABILITY: Partial<Record<ClaimKey, number>> = {
  checksum_pre: 5,
  checksum_post: 5,
  checksum_post_rollback: 5,
  lock_ms: 5,
  approval: 13,
};

/** The most recent harness event proving a capability, or null. */
function anchorFor(dossier: Dossier, capability: number | undefined): HarnessEvent | null {
  if (capability === undefined) return null;
  const matches = dossier.harness_events.filter((e) => e.capability === capability);
  return matches.length > 0 ? matches[matches.length - 1]! : null;
}

/** Short digest form: `sha256:11ab…7f20`. Full value stays available on the trace. */
export function shortDigest(digest: string): string {
  const hex = digest.replace(/^sha256:/, '');
  if (hex.length <= 12) return digest;
  return `sha256:${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

/* -------------------------------------------------------------------------- */
/* Tracing                                                                     */
/* -------------------------------------------------------------------------- */

interface Draft {
  label: string;
  value: string;
  grade: Grade;
  explains: string;
}

/**
 * Trace one claim back to whatever produced it.
 *
 * Never throws and never invents: a claim with no value and no source comes
 * back UNSOURCED with an empty value, which is a perfectly good thing for the
 * console to render and a terrible thing to hide.
 */
export function traceClaim(dossier: Dossier, claim: ClaimKey): Trace {
  const cert = dossier.certificate;
  const checksums = cert?.checksums;

  const unsourced = (label: string, why: string): Draft => ({
    label,
    value: '',
    grade: 'UNSOURCED',
    explains: why,
  });

  let draft: Draft;

  switch (claim) {
    case 'checksum_pre':
      draft = checksums
        ? {
            label: 'Pre-migration checksum',
            value: shortDigest(checksums.pre),
            grade: 'MEASURED',
            explains:
              'The affected tables, digested in the sandbox before the change was applied to the shadow branch.',
          }
        : unsourced('Pre-migration checksum', 'This change carries no checksum triple, so nothing was measured before it.');
      break;

    case 'checksum_post':
      draft = checksums
        ? {
            label: 'Post-migration checksum',
            value: shortDigest(checksums.post),
            grade: 'MEASURED',
            explains: 'The same tables, digested again after the forward statements ran against the shadow branch.',
          }
        : unsourced('Post-migration checksum', 'No checksum triple was produced for this change.');
      break;

    case 'checksum_post_rollback':
      draft = checksums
        ? {
            label: 'Post-rollback checksum',
            value: shortDigest(checksums.post_rollback),
            grade: 'MEASURED',
            explains:
              'The tables digested a third time, after the rollback ran. The gate opens only when this equals the pre-migration digest — and it recomputes that equality itself rather than believing the verifier’s own match flag.',
          }
        : unsourced('Post-rollback checksum', 'No rollback was executed against a shadow copy, so there is nothing to compare.');
      break;

    case 'lock_ms':
      draft =
        cert?.lock_ms_estimate !== undefined
          ? {
              label: 'Lock estimate',
              value: ms(cert.lock_ms_estimate),
              grade: 'MEASURED',
              explains:
                'How long the forward statements held a lock when they ran against the shadow branch. Policy caps this per class, because a lock is a duration during which every other query queues behind yours.',
            }
          : unsourced('Lock estimate', 'No lock duration was recorded for this change.');
      break;

    case 'records':
      draft =
        dossier.magnitude.records > 0
          ? {
              label: 'Records',
              value: dossier.magnitude.records.toLocaleString('en-GB'),
              grade: cert?.scope ? 'COMPUTED' : 'DECLARED',
              explains: cert?.scope
                ? 'Summed from the scope certificate, which enumerated the affected records across every connected system.'
                : 'Asserted by the agent in its own dossier. No independent process counted these rows — policy ceilings apply to the number, but the number itself is a claim.',
            }
          : unsourced('Records', 'This change reports no affected records.');
      break;

    case 'people':
      draft =
        dossier.magnitude.people > 0
          ? {
              label: 'People',
              value: dossier.magnitude.people.toLocaleString('en-GB'),
              grade: cert?.scope ? 'COMPUTED' : 'DECLARED',
              explains: cert?.scope
                ? 'Derived from the scope certificate’s enumeration of affected subjects.'
                : 'Asserted by the agent. Kept separate from the record count deliberately: forty thousand rows in an audit table is a Tuesday, forty thousand people is an incident.',
            }
          : unsourced('People', 'This change reports no affected people.');
      break;

    case 'amount':
      draft =
        dossier.magnitude.amount_minor !== 0
          ? {
              label: 'Amount',
              value: formatMoney(dossier.magnitude.amount_minor, dossier.magnitude.currency),
              grade: cert?.scope ? 'COMPUTED' : 'DECLARED',
              explains: cert?.scope
                ? 'Totalled from the scope certificate’s transfer records.'
                : 'Asserted by the agent, in minor units, and checked against the policy ceiling for this class.',
            }
          : unsourced('Amount', 'No money moves in this change.');
      break;

    case 'scope':
      draft = cert?.scope
        ? {
            label: 'Scope',
            value: `${cert.scope.records.length} records · ${cert.scope.exclusions.length} exclusions`,
            grade: 'MEASURED',
            explains:
              'Enumerated across every connected system, together with what is deliberately being kept and the obligation justifying each exclusion.',
          }
        : unsourced('Scope', 'No scope certificate was produced, so the blast radius was never enumerated.');
      break;

    case 'drift':
      draft = dossier.drift.production_checksum
        ? {
            label: 'Production drift',
            value: shortDigest(dossier.drift.production_checksum),
            grade: 'COMPUTED',
            explains:
              'Production re-checksummed and compared against the state the certificate was taken from. AIRLOCK does this comparison itself — the checker’s own “not drifted” claim is never trusted, because a claim of safety is recomputed while a claim of danger is believed.',
          }
        : unsourced('Production drift', 'Production has not been re-checksummed since the proof was taken.');
      break;

    case 'undo_window':
      draft =
        dossier.undo.expires_at !== null
          ? {
              label: 'Undo window',
              value: dossier.undo.expires_at,
              grade: 'COMPUTED',
              explains:
                'Granted by policy for this class and written when the change was applied. It is how long AIRLOCK is willing to vouch for the proven inverse, not a guess about how long the rollback would work.',
            }
          : unsourced('Undo window', 'This change carries no undo window.');
      break;

    case 'post_apply':
      draft = dossier.post_apply.observed_checksum
        ? {
            label: 'Post-apply health',
            value: shortDigest(dossier.post_apply.observed_checksum),
            grade: 'MEASURED',
            explains:
              'Production, digested once the change actually landed, and compared against what the certificate predicted it would become.',
          }
        : unsourced('Post-apply health', 'No health check has run since this change was applied.');
      break;

    case 'cost':
      draft =
        dossier.cost.usd > 0 || dossier.cost.tokens.total > 0
          ? {
              label: 'Run cost',
              value: `$${dossier.cost.usd.toFixed(4)}`,
              grade: 'MEASURED',
              explains:
                'Reported by the harness in the turn metrics, summed across every model this run used, including subagents.',
            }
          : unsourced('Run cost', 'The harness reported no cost for this run.');
      break;

    case 'approval':
      draft = dossier.approval.at
        ? {
            label: 'Approval',
            value: `${dossier.approval.approver ?? 'unknown'} · ${dossier.approval.decision ?? 'undecided'}`,
            grade: 'MEASURED',
            explains:
              'Held by the harness as a required action until a human answered. The gate then re-ran server-side against the stored dossier before the signature was written.',
          }
        : unsourced('Approval', 'Nobody has decided this change yet.');
      break;
  }

  const capability = CLAIM_CAPABILITY[claim];
  // An anchor is only attached to a claim the harness actually established. A
  // DECLARED figure gets no step link however many harness events happen to be
  // lying around, because linking it would imply something measured it.
  const anchor = draft.grade === 'MEASURED' ? anchorFor(dossier, capability) : null;

  return {
    claim,
    label: draft.label,
    value: draft.value,
    grade: draft.grade,
    explains: draft.explains,
    stepId: anchor?.step_id ?? null,
    evidence: anchor?.evidence ?? null,
    capability: anchor?.capability ?? null,
    at: anchor?.at ?? dossier.certificate?.verified_at ?? null,
  };
}

/** Every claim in a dossier, in a stable order. For the docs and the drawer. */
export function traceAll(dossier: Dossier): Trace[] {
  return CLAIM_KEYS.map((claim) => traceClaim(dossier, claim));
}

/**
 * How well-evidenced this dossier is overall.
 *
 * Counts only claims that have a value — a change with no money in it is not
 * badly evidenced for failing to source an amount.
 */
export function evidenceSummary(dossier: Dossier): {
  measured: number;
  computed: number;
  declared: number;
  present: number;
} {
  let measured = 0;
  let computed = 0;
  let declared = 0;
  let present = 0;
  for (const t of traceAll(dossier)) {
    if (t.grade === 'UNSOURCED') continue;
    present += 1;
    if (t.grade === 'MEASURED') measured += 1;
    else if (t.grade === 'COMPUTED') computed += 1;
    else declared += 1;
  }
  return { measured, computed, declared, present };
}

export const GRADE_COPY: Record<Grade, string> = {
  MEASURED: 'Measured by the harness. The event that produced it is linked.',
  COMPUTED: 'Computed by AIRLOCK from fields you can inspect.',
  DECLARED: 'Asserted by the agent. Nothing independent checked it.',
  UNSOURCED: 'Nothing in this record backs this figure.',
};

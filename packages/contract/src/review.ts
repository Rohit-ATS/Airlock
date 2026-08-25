/**
 * Code review, as a gate condition.
 *
 * A schema migration is only half a change. Dropping `users.plan_name` is not
 * finished when the column is gone — it is finished when the fourteen places
 * that read it no longer do. AIRLOCK already computes that blast radius, which
 * means it already knows precisely what code has to change, and leaving that as
 * a list for a human to work through afterwards is leaving the job half done.
 *
 * So the agent writes the expand/contract changes, opens a pull request, and
 * **an independent reviewer reviews the agent's code before the certificate is
 * allowed to complete.** Not the agent reviewing itself with a second prompt —
 * a different system, with different training and no stake in the change
 * looking finished.
 *
 * ## Why this is a gate condition rather than a nice-to-have
 *
 * The rest of AIRLOCK refuses to let an agent ask for approval on an unproven
 * change. This is the same rule applied one layer out: it refuses to let an
 * agent ask for approval on a change whose *code* nobody has looked at. A
 * migration proven reversible, attached to application code that dereferences a
 * column that is about to vanish, is a proof of the wrong thing.
 *
 * ## The symmetry that keeps the privilege model intact
 *
 * The agent may **open** a pull request. It may not **merge** one. That is
 * exactly the shape of the airlock itself — propose, never apply — and it means
 * adding GitHub write scope does not add a route to production. A PR is a
 * proposal sitting in front of a human, which is the same place the change
 * dossier ends up.
 *
 * ## What is not trusted
 *
 * The review's own claim that a finding is resolved. Same asymmetry as
 * `checksums.match` and `drifted: false`: a positive claim of a problem is
 * believed on sight, a claim that it went away is recomputed. A finding counts
 * as addressed only when a commit landed *after* it was raised, or when a human
 * waived it in writing.
 */
import type { Dossier } from './dossier.js';

/* -------------------------------------------------------------------------- */
/* Who reviewed it                                                             */
/* -------------------------------------------------------------------------- */

export const REVIEW_PROVIDERS = ['qodo', 'human', 'other'] as const;
export type ReviewProvider = (typeof REVIEW_PROVIDERS)[number];

export const REVIEW_SEVERITIES = ['blocker', 'major', 'minor', 'nit'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

/**
 * Which severities must be dealt with before the gate opens.
 *
 * Nits do not block. A system that refuses to ship a migration over a naming
 * preference is a system whose reviews get skipped, and a skipped review is
 * worth less than no review because it looks like one happened.
 */
export const BLOCKING_SEVERITIES: ReadonlySet<ReviewSeverity> = new Set<ReviewSeverity>(['blocker', 'major']);

export type ReviewStatus =
  /** No code changes accompany this dossier, so no review is owed. */
  | 'NOT_REQUIRED'
  /** Code changes exist and nobody has reviewed them. */
  | 'NOT_REQUESTED'
  /** Submitted; the reviewer has not answered yet. */
  | 'PENDING'
  /** Reviewed, and it found nothing that blocks. */
  | 'CLEAN'
  /** Reviewed, found blocking findings, and every one has been addressed. */
  | 'ADDRESSED'
  /** Reviewed, and blocking findings are still open. */
  | 'OUTSTANDING';

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export interface ReviewFindingShape {
  id: string;
  severity: ReviewSeverity;
  title: string;
  file?: string;
  line?: number;
  /** When the reviewer raised it. Used to decide whether a later commit fixed it. */
  raised_at: string;
  /** The commit that addressed it. Recomputed against `raised_at`, never trusted alone. */
  addressed_by?: string;
  addressed_at?: string;
  /** A human decided it does not apply. Requires a reason; recorded permanently. */
  waived_reason?: string;
  waived_by?: string;
}

export interface CodeChangesShape {
  repo: string;
  branch: string;
  pr_url?: string;
  pr_number?: number;
  files_changed: number;
  /** Head commit of the PR branch at the time the certificate was assembled. */
  head_sha?: string;
}

export interface CodeReviewShape {
  provider: ReviewProvider;
  status: ReviewStatus;
  reviewed_at?: string;
  findings: ReviewFindingShape[];
  /** The reviewer's own summary line, verbatim. */
  summary?: string;
}

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

/** Does this change carry code that somebody has to look at? */
export function hasCodeChanges(dossier: Dossier): boolean {
  const c = dossier.code_changes;
  return c !== null && c !== undefined && c.files_changed > 0;
}

/**
 * Has this finding actually been dealt with?
 *
 * A finding is addressed when a commit landed after it was raised, or when a
 * human waived it in writing. The reviewer saying "resolved" is not on that
 * list, deliberately — an automated reviewer that resolves its own findings
 * when the diff changes shape will mark things fixed that were merely moved.
 */
export function isAddressed(finding: ReviewFindingShape): boolean {
  if (finding.waived_reason && finding.waived_by) return true;
  if (!finding.addressed_by || !finding.addressed_at) return false;

  const raised = new Date(finding.raised_at).getTime();
  const fixed = new Date(finding.addressed_at).getTime();
  if (!Number.isFinite(raised) || !Number.isFinite(fixed)) return false;

  // The commit has to come *after* the finding. A fix that predates the
  // complaint is a fix for something else.
  return fixed >= raised;
}

/** Blocking findings that are still open. */
export function outstandingFindings(review: CodeReviewShape | null | undefined): ReviewFindingShape[] {
  if (!review) return [];
  return review.findings.filter((f) => BLOCKING_SEVERITIES.has(f.severity) && !isAddressed(f));
}

/**
 * The status AIRLOCK computes, as opposed to the one the record claims.
 *
 * Called by the gate rather than reading `review.status`, for the same reason
 * the gate recomputes `pre === post_rollback` instead of believing `match`.
 */
export function reviewStatus(dossier: Dossier): ReviewStatus {
  if (!hasCodeChanges(dossier)) return 'NOT_REQUIRED';

  const review = dossier.code_review;
  if (!review) return 'NOT_REQUESTED';
  if (review.status === 'PENDING') return 'PENDING';

  const outstanding = outstandingFindings(review);
  if (outstanding.length > 0) return 'OUTSTANDING';

  const hadBlocking = review.findings.some((f) => BLOCKING_SEVERITIES.has(f.severity));
  return hadBlocking ? 'ADDRESSED' : 'CLEAN';
}

/** True when the gate must stay sealed on account of the code review. */
export function reviewBlocks(dossier: Dossier): boolean {
  const status = reviewStatus(dossier);
  return status === 'NOT_REQUESTED' || status === 'PENDING' || status === 'OUTSTANDING';
}

export const REVIEW_STATUS_COPY: Record<ReviewStatus, string> = {
  NOT_REQUIRED: 'This change carries no code, so there is nothing to review.',
  NOT_REQUESTED:
    'This change modifies application code and nobody has reviewed it. The migration may be proven; the code that has to change with it is not.',
  PENDING: 'The code review is still running. The gate opens on a finished review, not a submitted one.',
  CLEAN: 'Reviewed, with nothing blocking found.',
  ADDRESSED: 'Reviewed, and every blocking finding has been addressed by a later commit or waived in writing.',
  OUTSTANDING:
    'The reviewer raised findings on the agent’s own code that have not been addressed. Fix them, or waive them with a reason.',
};

/**
 * The line the approval card carries.
 *
 * Written to be read aloud, because it is the sentence that makes the loop
 * legible in a demo: the agent wrote code, something else reviewed it, and the
 * findings were dealt with before anybody was asked to approve anything.
 */
export function describeReview(dossier: Dossier): string {
  const status = reviewStatus(dossier);
  const review = dossier.code_review;
  const changes = dossier.code_changes;

  if (status === 'NOT_REQUIRED') return 'No code changes.';
  if (!changes) return 'No code changes.';

  const files = `${changes.files_changed} file${changes.files_changed === 1 ? '' : 's'}`;

  if (!review) return `Code changes prepared · ${files} · not reviewed`;

  const who = review.provider === 'qodo' ? 'Qodo' : review.provider === 'human' ? 'a reviewer' : 'an external reviewer';
  const blocking = review.findings.filter((f) => BLOCKING_SEVERITIES.has(f.severity));
  const open = outstandingFindings(review);

  if (status === 'PENDING') return `Code changes prepared · ${files} · review running`;
  if (status === 'OUTSTANDING') {
    return `Code changes prepared · reviewed by ${who} · ${open.length} of ${blocking.length} findings outstanding`;
  }
  if (status === 'ADDRESSED') {
    return `Code changes prepared · reviewed by ${who} · ${blocking.length} finding${
      blocking.length === 1 ? '' : 's'
    } addressed`;
  }
  return `Code changes prepared · reviewed by ${who} · nothing blocking`;
}

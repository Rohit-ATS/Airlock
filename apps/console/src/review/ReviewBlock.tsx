'use client';

import {
  BLOCKING_SEVERITIES,
  REVIEW_STATUS_COPY,
  describeReview,
  isAddressed,
  reviewStatus,
  type Dossier,
  type ReviewFinding,
} from '@airlock/contract';
import { Chip, Evidence, Legend, cx } from '@/design/primitives';

/**
 * The other half of the change.
 *
 * A schema migration proven reversible, attached to application code that still
 * dereferences the column it removes, is a proof of the wrong thing. AIRLOCK
 * already computes the blast radius, so it already knows what has to change —
 * and the agent writes it, opens a pull request, and an independent reviewer
 * reads the agent's code before the certificate is allowed to complete.
 *
 * The headline line is the one that makes the loop legible in three seconds:
 *
 *     Code changes prepared · reviewed by Qodo · 2 findings addressed
 *
 * Findings are shown individually rather than counted, because the interesting
 * question a reader has is not "how many" but "what kind, and did anyone
 * actually fix them". A count is a claim; a list with commit references is
 * evidence.
 */

function SeverityChip({ severity }: { severity: ReviewFinding['severity'] }) {
  const tone =
    severity === 'blocker' ? 'fault' : severity === 'major' ? 'hazard' : severity === 'minor' ? 'neutral' : 'neutral';
  return (
    <Chip tone={tone} mono className="!text-[9px]">
      {severity}
    </Chip>
  );
}

function FindingRow({ finding }: { finding: ReviewFinding }) {
  const blocking = BLOCKING_SEVERITIES.has(finding.severity);
  const done = isAddressed(finding);
  const waived = Boolean(finding.waived_reason);

  return (
    <div className="border-t border-hairline px-2.5 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityChip severity={finding.severity} />
        {blocking ? (
          <Chip tone={done ? 'seal' : 'fault'} mono className="!text-[9px]">
            {waived ? 'waived' : done ? 'addressed' : 'open'}
          </Chip>
        ) : null}
        {finding.file ? (
          <Evidence size="xs" className="text-ink-3">
            {finding.file}
            {finding.line ? `:${finding.line}` : ''}
          </Evidence>
        ) : null}
      </div>

      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{finding.title}</p>

      {done && !waived && finding.addressed_by ? (
        <p className="mt-1 text-[10px] text-ink-4">
          fixed by{' '}
          <Evidence size="xs" className="text-ink-3">
            {finding.addressed_by}
          </Evidence>
          {' — a commit that landed after the finding was raised, which is what AIRLOCK checks rather than'}
          {' believing a resolved flag'}
        </p>
      ) : null}

      {waived ? (
        <p className="mt-1 text-[10px] leading-relaxed text-ink-4">
          waived by <span className="evidence text-ink-3">{finding.waived_by}</span> — “{finding.waived_reason}”
        </p>
      ) : null}
    </div>
  );
}

export function ReviewBlock({ dossier }: { dossier: Dossier }) {
  const status = reviewStatus(dossier);
  if (status === 'NOT_REQUIRED') return null;

  const changes = dossier.code_changes;
  const review = dossier.code_review;
  const good = status === 'CLEAN' || status === 'ADDRESSED';

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <Legend>The other half of the change</Legend>
        <Evidence size="xs" className={good ? 'text-seal' : 'text-fault'}>
          {status.toLowerCase().replace(/_/g, ' ')}
        </Evidence>
      </div>

      <div className={cx('overflow-hidden rounded-[5px] border bg-void', good ? 'border-seal/30' : 'border-fault/35')}>
        {/* The sentence the demo is built around. */}
        <p className={cx('px-2.5 py-2 text-[12px] leading-relaxed', good ? 'text-ink' : 'text-fault')}>
          {describeReview(dossier)}
        </p>

        {changes ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline px-2.5 py-2">
            <Legend className="!text-[9px]">pull request</Legend>
            {changes.pr_url ? (
              <a
                href={changes.pr_url}
                target="_blank"
                rel="noreferrer"
                className="evidence text-[11px] text-ice transition-colors hover:underline"
              >
                {changes.repo}#{changes.pr_number ?? '—'}
              </a>
            ) : (
              <Evidence size="xs" className="text-ink-2">
                {changes.repo} · {changes.branch}
              </Evidence>
            )}
            {changes.head_sha ? (
              <Evidence size="xs" dim>
                {changes.head_sha}
              </Evidence>
            ) : null}
          </div>
        ) : null}

        {review?.summary ? (
          <p className="border-t border-hairline px-2.5 py-2 text-[11px] leading-relaxed text-ink-3">
            “{review.summary}”
          </p>
        ) : null}

        {review && review.findings.length > 0 ? (
          <div className="border-t border-hairline">
            {review.findings.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </div>
        ) : null}

        <p className="border-t border-hairline bg-panel px-2.5 py-2 text-[10px] leading-relaxed text-ink-4">
          {status === 'NOT_REQUESTED' || status === 'PENDING' || status === 'OUTSTANDING'
            ? REVIEW_STATUS_COPY[status]
            : 'The agent may open a pull request and may not merge one — the same rule as the rest of AIRLOCK. Nits do not block: a system that refuses to ship a migration over a naming preference is a system whose reviews get skipped.'}
        </p>
      </div>
    </div>
  );
}

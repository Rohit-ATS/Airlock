'use client';

import { useState } from 'react';
import {
  openGate,
  verdictOf,
  type ApprovalGrant,
  type Dossier,
  type GateDecision,
  type Viewer,
} from '@airlock/contract';
import { Button, Chip, Divider, Evidence, Legend, Panel, Readout, cx } from '@/design/primitives';
import { ChecksumTriple } from './ChecksumTriple';

/**
 * The Certificate card — the approval surface, and the whole argument of the
 * product in one component.
 *
 * The ordering is fixed and deliberate: verdict, then the change, then the
 * evidence, then the cost, then the decision. A reader should reach the buttons
 * having already seen everything they need to press one.
 */

/* -------------------------------------------------------------------------- */
/* The gated control                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The Approve control.
 *
 * It takes an `ApprovalGrant`, not a boolean and not a dossier. `ApprovalGrant`
 * carries a module-private symbol minted only by `openGate`, so this component
 * is unrenderable unless a certificate actually proved itself. That is the
 * invariant, expressed as a function signature rather than as a comment.
 */
function ApproveControl({
  grant,
  onApprove,
  busy,
}: {
  grant: ApprovalGrant;
  onApprove: (grant: ApprovalGrant) => void;
  busy?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  // An irreversible change gets a second, deliberate action. Not a modal —
  // a modal trains people to click through. The button changes what it says.
  if (grant.irreversible && !armed) {
    return (
      <Button tone="hazard" size="lg" full onClick={() => setArmed(true)} disabled={busy}>
        This cannot be undone — arm approval
      </Button>
    );
  }

  return (
    <Button
      tone={grant.irreversible ? 'hazard' : 'seal'}
      size="lg"
      full
      disabled={busy}
      onClick={() => onApprove(grant)}
    >
      {busy ? 'Applying…' : grant.irreversible ? 'Approve — destroy the listed records' : 'Approve — apply to production'}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* The sealed door                                                             */
/* -------------------------------------------------------------------------- */

function SealedDoor({ decision }: { decision: Extract<GateDecision, { state: 'SEALED' }> }) {
  const roleOnly = decision.reason === 'ROLE_NOT_APPROVER';
  return (
    <div
      className={cx(
        'rounded-[5px] border px-3.5 py-3',
        roleOnly ? 'border-hairline-2 bg-raised' : 'border-fault/35 bg-fault-bg/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cx(
            'mt-[3px] size-2 shrink-0 rotate-45 rounded-[1px]',
            roleOnly ? 'bg-ink-3' : 'bg-fault',
          )}
        />
        <div className="min-w-0">
          <p className={cx('text-[12px] font-medium', roleOnly ? 'text-ink-2' : 'text-fault')}>
            {roleOnly ? 'Gate closed for your role' : 'Gate sealed'}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{decision.message}</p>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-4">
            No approval control is rendered here — not disabled, not hidden. The component that would draw it requires
            a grant, and no grant exists.{' '}
            <Evidence size="xs" className="text-ink-3">
              {decision.reason}
            </Evidence>
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

function VerdictBanner({ dossier, decision }: { dossier: Dossier; decision: GateDecision }) {
  const v = verdictOf(dossier, decision);
  const tones = {
    proven: 'border-seal/40 bg-seal-bg text-seal',
    irreversible: 'border-hazard/45 bg-hazard-bg text-hazard',
    blocked: 'border-fault/40 bg-fault-bg text-fault',
  } as const;
  return (
    <div className={cx('relative overflow-hidden rounded-[5px] border px-3.5 py-3', tones[v.tone])}>
      {v.tone === 'irreversible' ? <div className="hazard-hatch absolute inset-0 opacity-60" aria-hidden /> : null}
      <div className="relative">
        <p className="evidence text-[13px] font-semibold tracking-[0.06em]">{v.label}</p>
        <p className="mt-1.5 max-w-[70ch] text-[11.5px] leading-relaxed text-ink-2">{v.sub}</p>
      </div>
    </div>
  );
}

function SqlDiff({ dossier }: { dossier: Dossier }) {
  if (dossier.forward.length === 0) return null;
  return (
    <div>
      <Legend className="mb-2">Operations</Legend>
      <div className="grid gap-2 md:grid-cols-2">
        <OpColumn title="Forward" tone="ice" ops={dossier.forward} />
        <OpColumn
          title="Rollback"
          tone={dossier.rollback.length ? 'seal' : 'fault'}
          ops={dossier.rollback}
          emptyNote="No rollback exists. This change is not reversible."
        />
      </div>
    </div>
  );
}

function OpColumn({
  title,
  tone,
  ops,
  emptyNote,
}: {
  title: string;
  tone: 'ice' | 'seal' | 'fault';
  ops: Dossier['forward'];
  emptyNote?: string;
}) {
  const accent = { ice: 'text-ice', seal: 'text-seal', fault: 'text-fault' }[tone];
  return (
    <div className="overflow-hidden rounded-[5px] border border-hairline bg-void">
      <div className="flex items-center justify-between border-b border-hairline px-2.5 py-1.5">
        <span className={cx('text-[10px] font-semibold tracking-[0.12em] uppercase', accent)}>{title}</span>
        <Evidence size="xs" dim>
          {ops.length} op{ops.length === 1 ? '' : 's'}
        </Evidence>
      </div>
      {ops.length === 0 ? (
        <p className="px-2.5 py-3 text-[11px] text-fault">{emptyNote}</p>
      ) : (
        <ul>
          {ops.map((op, i) => (
            <li key={i} className={cx('px-2.5 py-2', i > 0 && 'border-t border-hairline')}>
              <div className="mb-1 flex items-center gap-1.5">
                <Chip tone="neutral" className="!py-0.5 !text-[9.5px]">
                  {op.system}
                </Chip>
                {op.proven ? (
                  <Chip tone="seal" className="!py-0.5 !text-[9.5px]">
                    executed on shadow
                  </Chip>
                ) : null}
              </div>
              <Evidence size="xs" className="block leading-relaxed break-words whitespace-pre-wrap text-ink">
                {op.op}
              </Evidence>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AffectedTables({ dossier }: { dossier: Dossier }) {
  if (dossier.affected_tables.length === 0) return null;
  const total = dossier.affected_tables.reduce((n, t) => n + t.rows, 0);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <Legend>Affected tables</Legend>
        <Evidence size="xs" dim>
          {total.toLocaleString()} rows total
        </Evidence>
      </div>
      <div className="overflow-hidden rounded-[5px] border border-hairline bg-void">
        {dossier.affected_tables.map((t, i) => (
          <div
            key={`${t.system}.${t.name}`}
            className={cx('flex items-center gap-3 px-2.5 py-1.5', i > 0 && 'border-t border-hairline')}
          >
            <Evidence size="sm" className="min-w-0 flex-1 truncate text-ink">
              {t.name}
            </Evidence>
            <span className="truncate text-[10.5px] text-ink-3">{t.operation}</span>
            <Evidence size="sm" className="w-24 shrink-0 text-right text-ink">
              {t.rows.toLocaleString()}
            </Evidence>
          </div>
        ))}
      </div>
    </div>
  );
}

function LockProfile({ dossier }: { dossier: Dossier }) {
  const c = dossier.certificate;
  if (!c || (c.lock_ms_estimate === undefined && c.table_rewrite === undefined)) return null;
  const rewrite = c.table_rewrite === true;
  return (
    <div className="rounded-[5px] border border-hairline bg-void px-3 py-2">
      <Readout label="Estimated lock" tone={(c.lock_ms_estimate ?? 0) > 2000 ? 'hazard' : 'seal'}>
        {c.lock_ms_estimate !== undefined ? `${(c.lock_ms_estimate / 1000).toFixed(2)} s` : '—'}
      </Readout>
      <Divider />
      <Readout label="Table rewrite" tone={rewrite ? 'hazard' : 'seal'}>
        {rewrite ? 'YES — full rewrite' : 'no'}
      </Readout>
      {rewrite ? (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-hazard">
          Postgres rewrites the whole table for this operation, holding an ACCESS EXCLUSIVE lock for the duration.
          Consider the expand/contract alternative below.
        </p>
      ) : null}
    </div>
  );
}

function ScopeBlock({ dossier }: { dossier: Dossier }) {
  const scope = dossier.certificate?.scope;
  if (!scope) return null;
  const destroyed = scope.records.reduce((n, r) => n + r.count, 0);
  const retained = scope.exclusions.reduce((n, e) => n + e.count, 0);

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Legend>Blast radius — will be destroyed</Legend>
          <Evidence size="xs" className="text-hazard">
            {destroyed.toLocaleString()} records
          </Evidence>
        </div>
        <div className="overflow-hidden rounded-[5px] border border-hazard/25 bg-void">
          {scope.records.map((r, i) => (
            <div key={i} className={cx('flex items-center gap-3 px-2.5 py-1.5', i > 0 && 'border-t border-hairline')}>
              <Chip tone="hazard" className="!py-0.5 !text-[9.5px]">
                {r.system}
              </Chip>
              <Evidence size="xs" className="min-w-0 flex-1 truncate text-ink-2">
                {r.table ? `${r.table} · ` : ''}
                {r.id}
              </Evidence>
              <span className="text-[10px] tracking-wider text-hazard uppercase">{r.action}</span>
              <Evidence size="xs" className="w-12 shrink-0 text-right text-ink">
                {r.count.toLocaleString()}
              </Evidence>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <Legend>Exclusions — deliberately retained</Legend>
          <Evidence size="xs" className="text-seal">
            {retained.toLocaleString()} records
          </Evidence>
        </div>
        <div className="overflow-hidden rounded-[5px] border border-hairline bg-void">
          {scope.exclusions.map((e, i) => (
            <div key={i} className={cx('px-2.5 py-2', i > 0 && 'border-t border-hairline')}>
              <div className="flex items-center gap-2">
                <Chip tone="seal" className="!py-0.5 !text-[9.5px]">
                  {e.system}
                </Chip>
                <Evidence size="xs" className="flex-1 truncate text-ink-2">
                  {e.table ?? '—'}
                </Evidence>
                <Evidence size="xs" dim>
                  {e.count.toLocaleString()}
                </Evidence>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{e.reason}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BlastRadius({ dossier }: { dossier: Dossier }) {
  if (dossier.blast_radius.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <Legend>Code references</Legend>
        <Evidence size="xs" dim>
          {dossier.blast_radius.length} sites
        </Evidence>
      </div>
      <div className="scroll-thin max-h-44 overflow-y-auto rounded-[5px] border border-hairline bg-void">
        {dossier.blast_radius.map((hit, i) => (
          <div key={i} className={cx('flex items-baseline gap-2 px-2.5 py-1.5', i > 0 && 'border-t border-hairline')}>
            <Evidence size="xs" className="min-w-0 flex-1 truncate text-ink-2">
              {hit.file}
            </Evidence>
            <Evidence size="xs" className="shrink-0 text-ice">
              :{hit.line}
            </Evidence>
            {hit.symbol ? (
              <Evidence size="xs" className="w-32 shrink-0 truncate text-right text-ink-3">
                {hit.symbol}
              </Evidence>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function CostBlock({ dossier }: { dossier: Dossier }) {
  const models = Object.entries(dossier.cost.by_model);
  return (
    <div className="rounded-[5px] border border-hairline bg-void px-3 py-2">
      <Readout label="Run cost">${dossier.cost.usd.toFixed(4)}</Readout>
      {models.length > 0 ? (
        <>
          <Divider />
          <div className="pt-1">
            {models.map(([model, usd]) => (
              <div key={model} className="flex items-baseline justify-between gap-4 py-1">
                <Evidence size="xs" className="min-w-0 flex-1 truncate text-ink-3">
                  {model}
                </Evidence>
                <Evidence size="xs" className="text-ink-2">
                  ${usd.toFixed(4)}
                </Evidence>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {dossier.cost.tokens.total > 0 ? (
        <>
          <Divider />
          <Readout label="Tokens">{dossier.cost.tokens.total.toLocaleString()}</Readout>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The card                                                                    */
/* -------------------------------------------------------------------------- */

export function CertificateCard({
  dossier,
  viewer,
  onApprove,
  onReject,
  busy,
  className,
}: {
  dossier: Dossier;
  viewer: Viewer;
  onApprove: (grant: ApprovalGrant) => void;
  onReject: (reason: string) => void;
  busy?: boolean;
  className?: string;
}) {
  const decision = openGate(dossier, viewer);
  const cert = dossier.certificate;

  return (
    <Panel className={cx('flex min-h-0 flex-col overflow-hidden', className)}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <Legend>Change certificate</Legend>
        <Evidence size="xs" dim>
          {dossier.dossier_id}
        </Evidence>
        <div className="flex-1" />
        <Chip tone="neutral" mono>
          {dossier.change_class}
        </Chip>
        {cert ? (
          <Chip tone={cert.kind === 'SCOPE' ? 'hazard' : 'seal'} mono>
            {cert.kind}
          </Chip>
        ) : null}
        {dossier.started_by !== 'ui' ? (
          <Chip tone="ice" mono title="This run was opened without a human typing anything">
            started by: {dossier.started_by}
          </Chip>
        ) : null}
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5">
        <VerdictBanner dossier={dossier} decision={decision} />

        <div>
          <Legend className="mb-1.5">Request</Legend>
          <p className="text-[12.5px] leading-relaxed text-ink">{dossier.request}</p>
          <p className="mt-1.5 text-[10.5px] text-ink-3">
            requested by <span className="evidence text-ink-2">{dossier.requested_by}</span>
            {dossier.target.branch_ref ? (
              <>
                {' · verified on shadow branch '}
                <span className="evidence text-ink-2">{dossier.target.branch_ref}</span>
              </>
            ) : null}
          </p>
        </div>

        {cert?.failure_reason ? (
          <div className="rounded-[5px] border border-fault/35 bg-fault-bg/40 px-3 py-2.5">
            <Legend className="mb-1 !text-fault">Verification failure</Legend>
            <Evidence size="xs" className="block leading-relaxed whitespace-pre-wrap text-ink-2">
              {cert.failure_reason}
            </Evidence>
          </div>
        ) : null}

        <SqlDiff dossier={dossier} />
        <AffectedTables dossier={dossier} />
        <LockProfile dossier={dossier} />

        {cert?.checksums ? <ChecksumTriple triple={cert.checksums} /> : null}
        <ScopeBlock dossier={dossier} />
        <BlastRadius dossier={dossier} />

        {dossier.questions.length > 0 ? (
          <div>
            <Legend className="mb-2">Resolved with the requester</Legend>
            <div className="space-y-2">
              {dossier.questions.map((q, i) => (
                <div key={i} className="rounded-[5px] border border-hairline bg-void px-2.5 py-2">
                  <p className="text-[11.5px] leading-relaxed text-ink-2">{q.asked}</p>
                  {q.answer ? (
                    <p className="mt-1.5 flex items-baseline gap-2 text-[11.5px]">
                      <span className="text-ice">↳</span>
                      <span className="text-ink">{q.answer}</span>
                      {q.answered_by ? <span className="evidence text-[10px] text-ink-4">{q.answered_by}</span> : null}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {dossier.risk_notes.length > 0 ? (
          <div>
            <Legend className="mb-2">Risk notes</Legend>
            <ul className="space-y-1.5">
              {dossier.risk_notes.map((n, i) => (
                <li key={i} className="text-[11.5px] leading-relaxed text-ink-2">
                  <span className="mr-1.5 text-ink-4">—</span>
                  {n.note}
                  {n.source_url ? (
                    <a
                      href={n.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1.5 text-ice hover:underline"
                    >
                      {n.source_title ?? 'source'}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <CostBlock dossier={dossier} />
      </div>

      {/* ---- the decision ---- */}
      <footer className="shrink-0 space-y-2 border-t border-hairline bg-panel px-3.5 py-3">
        {decision.state === 'OPEN' ? (
          <>
            <ApproveControl grant={decision.grant} onApprove={onApprove} busy={busy} />
            <Button tone="neutral" size="md" full disabled={busy} onClick={() => onReject('rejected by approver')}>
              Reject and tear down the shadow branch
            </Button>
            <p className="pt-0.5 text-center text-[10px] text-ink-4">
              Approving as <span className="evidence text-ink-3">{viewer.email}</span> · this decision is written to the
              immutable ledger
            </p>
          </>
        ) : (
          <SealedDoor decision={decision} />
        )}
      </footer>
    </Panel>
  );
}

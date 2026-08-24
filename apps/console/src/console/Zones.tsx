'use client';

import { useEffect, useState } from 'react';
import type { Dossier, Viewer } from '@airlock/contract';
import { approversFor, formatMoney, openGate, sealsOutstanding } from '@airlock/contract';
import { Chip, Dot, Empty, Evidence, Legend, cx } from '@/design/primitives';

/* -------------------------------------------------------------------------- */
/* WAITING — the approval queue                                                */
/* -------------------------------------------------------------------------- */

/** How long a change has been holding for a human, live. */
function useAge(iso: string | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function QueueRow({
  dossier,
  viewer,
  selected,
  onSelect,
}: {
  dossier: Dossier;
  viewer: Viewer;
  selected: boolean;
  onSelect: () => void;
}) {
  const decision = openGate(dossier, viewer);
  const age = useAge(dossier.certificate?.verified_at ?? dossier.created_at);
  const cert = dossier.certificate;

  const tone = !cert
    ? 'neutral'
    : cert.status === 'FAILED'
      ? 'fault'
      : cert.status === 'PENDING'
        ? 'ice'
        : cert.kind === 'SCOPE'
          ? 'hazard'
          : 'seal';

  const signed = approversFor(dossier).length;
  const outstanding = sealsOutstanding(dossier);
  const quorum = signed + outstanding;

  // What is actually in the way, said in one line. The sealed reason is used
  // verbatim rather than summarised, so this row and the certificate card can
  // never tell a reader two different stories about the same change.
  const blockedOn =
    cert?.status === 'PENDING'
      ? 'verifying in the sandbox'
      : decision.state === 'OPEN'
        ? decision.grant.final
          ? 'ready for your decision'
          : `needs ${outstanding} more signature${outstanding === 1 ? '' : 's'}`
        : decision.reason === 'ROLE_NOT_APPROVER'
          ? 'waiting on an approver'
          : decision.reason;

  const magnitude = (() => {
    const m = dossier.magnitude;
    if (m.amount_minor !== 0) return formatMoney(Math.abs(m.amount_minor), m.currency);
    if (m.people > 0) return `${m.people.toLocaleString()} ${m.people === 1 ? 'person' : 'people'}`;
    if (m.records > 0) return `${m.records.toLocaleString()} records`;
    return null;
  })();

  return (
    <button
      onClick={onSelect}
      className={cx(
        'flex w-full items-start gap-3 border-b border-hairline px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-raised-2' : 'hover:bg-raised',
      )}
    >
      <div className="pt-1">
        <Dot tone={tone as 'neutral'} pulse={cert?.status === 'PENDING'} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] leading-snug text-ink">{dossier.request}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip tone="neutral" mono className="!text-[9.5px]">
            {dossier.change_class}
          </Chip>
          {cert ? (
            <Chip tone={tone as 'seal'} mono className="!text-[9.5px]">
              {cert.kind} · {cert.status}
            </Chip>
          ) : (
            <Chip tone="neutral" className="!text-[9.5px]">
              no certificate
            </Chip>
          )}
          {dossier.started_by !== 'ui' ? (
            <Chip tone="ice" mono className="!text-[9.5px]">
              {dossier.started_by}
            </Chip>
          ) : null}
          {magnitude ? (
            <Evidence size="xs" className={dossier.magnitude.people > 0 ? 'text-hazard' : 'text-ink-3'}>
              {magnitude}
            </Evidence>
          ) : null}
          {quorum > 1 ? (
            <span className="flex items-center gap-1" title={`${signed} of ${quorum} signatures`}>
              {Array.from({ length: quorum }, (_, i) => (
                <span key={i} className={cx('h-1.5 w-3 rounded-[1px]', i < signed ? 'bg-seal' : 'bg-hairline-3')} />
              ))}
            </span>
          ) : null}
        </div>
        <p
          className={cx(
            'mt-1.5 text-[10.5px] leading-relaxed',
            decision.state === 'OPEN' ? 'text-seal' : 'text-ink-3',
          )}
        >
          {blockedOn}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <Evidence size="xs" className="block text-ink-2">
          {age}
        </Evidence>
        <Evidence size="xs" className="mt-1 block text-ink-4">
          held
        </Evidence>
      </div>
    </button>
  );
}

export function WaitingZone({
  dossiers,
  viewer,
  selectedId,
  onSelect,
}: {
  dossiers: Dossier[];
  viewer: Viewer;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const queue = dossiers.filter((d) => d.approval.decision === null && d.audit.applied_at === null);

  if (queue.length === 0) {
    return (
      <Empty
        title="Nothing is holding for a human."
        hint="Changes appear here the moment a run produces a certificate and stops at the gate. An approver works this queue."
      />
    );
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Legend>Approval queue</Legend>
        <div className="h-px flex-1 bg-hairline" />
        <Evidence size="xs" dim>
          {queue.length} held
        </Evidence>
      </div>
      {queue.map((d) => (
        <QueueRow
          key={d.dossier_id}
          dossier={d}
          viewer={viewer}
          selected={selectedId === d.dossier_id}
          onSelect={() => onSelect(d.dossier_id)}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DID — the immutable change ledger                                           */
/* -------------------------------------------------------------------------- */

export function DidZone({
  dossiers,
  onSelect,
  selectedId,
}: {
  dossiers: Dossier[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const decided = dossiers
    .filter((d) => d.approval.decision !== null || d.audit.applied_at !== null)
    .sort((a, b) => (b.approval.at ?? b.created_at).localeCompare(a.approval.at ?? a.created_at));

  if (decided.length === 0) {
    return (
      <Empty
        title="No change has passed through the airlock yet."
        hint="Every applied or rejected change is recorded here permanently: who asked, who approved, which certificate, and the checksums it was approved on."
      />
    );
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Legend>Change ledger</Legend>
        <div className="h-px flex-1 bg-hairline" />
        <Evidence size="xs" dim>
          {decided.length} recorded
        </Evidence>
      </div>

      {decided.map((d) => {
        const applied = d.audit.applied_at !== null;
        const rejected = d.approval.decision === 'rejected';
        return (
          <button
            key={d.dossier_id}
            onClick={() => onSelect(d.dossier_id)}
            className={cx(
              'block w-full border-b border-hairline px-3 py-2.5 text-left transition-colors',
              selectedId === d.dossier_id ? 'bg-raised-2' : 'hover:bg-raised',
            )}
          >
            <div className="flex items-start gap-3">
              <div className="pt-1">
                <Dot tone={rejected ? 'fault' : applied ? 'seal' : 'neutral'} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] leading-snug text-ink">{d.request}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-3">
                  <span>
                    requested <span className="evidence text-ink-2">{d.requested_by}</span>
                  </span>
                  {d.approval.approver ? (
                    <span>
                      {rejected ? 'rejected' : 'approved'} by{' '}
                      <span className="evidence text-ink-2">{d.approval.approver}</span>
                    </span>
                  ) : null}
                  {d.audit.applied_at ? (
                    <span className="evidence">{new Date(d.audit.applied_at).toLocaleString('en-GB')}</span>
                  ) : null}
                </div>
                {d.certificate?.checksums ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Legend className="!text-[9px]">approved on</Legend>
                    <Evidence size="xs" className="truncate text-ink-4">
                      {d.certificate.checksums.pre.slice(0, 20)}…
                    </Evidence>
                  </div>
                ) : null}
              </div>
              <Chip tone={rejected ? 'fault' : applied ? 'seal' : 'neutral'} mono className="!text-[9.5px]">
                {rejected ? 'REJECTED' : applied ? 'APPLIED' : 'DECIDED'}
              </Chip>
            </div>
          </button>
        );
      })}
    </div>
  );
}

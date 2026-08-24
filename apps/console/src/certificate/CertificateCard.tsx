'use client';

import { useState } from 'react';
import {
  MIN_JUSTIFICATION,
  approversFor,
  breakGlassAvailable,
  formatMoney,
  openGate,
  sealsOutstanding,
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
 * The ordering is fixed and deliberate: verdict, then the change, then what it
 * costs the world, then the evidence, then what policy makes of it, then the
 * decision. A reader should reach the buttons having already seen everything
 * they need to press one.
 */

/* -------------------------------------------------------------------------- */
/* The gated control                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The Approve control.
 *
 * It takes an `ApprovalGrant`, not a boolean and not a dossier. `ApprovalGrant`
 * carries a module-private symbol minted only by `openGate`, so this component
 * is unrenderable unless a certificate actually proved itself and policy
 * permitted the change. That is the invariant, expressed as a function
 * signature rather than as a comment.
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

  // A signature that is not the last one does not move anything, and the button
  // must not imply that it does.
  if (!grant.final) {
    return (
      <Button tone="primary" size="lg" full disabled={busy} onClick={() => onApprove(grant)}>
        {busy ? 'Recording…' : `Countersign — ${grant.seals_held} of ${grant.seals_required} signatures`}
      </Button>
    );
  }

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

function SealedDoor({
  dossier,
  decision,
  viewer,
  breakGlassEnabled,
  onBreakGlass,
  busy,
}: {
  dossier: Dossier;
  decision: Extract<GateDecision, { state: 'SEALED' }>;
  viewer: Viewer;
  breakGlassEnabled: boolean;
  onBreakGlass: (justification: string) => void;
  busy?: boolean;
}) {
  const roleOnly = decision.reason === 'ROLE_NOT_APPROVER' || decision.reason === 'SELF_APPROVAL';
  const canBreak =
    viewer.role === 'approver' && breakGlassAvailable(dossier, { enabled: breakGlassEnabled }) && !roleOnly;

  return (
    <div className="space-y-2">
      <div
        className={cx(
          'rounded-[5px] border px-3.5 py-3',
          roleOnly ? 'border-hairline-2 bg-raised' : 'border-fault/35 bg-fault-bg/40',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className={cx('mt-[3px] size-2 shrink-0 rotate-45 rounded-[1px]', roleOnly ? 'bg-ink-3' : 'bg-fault')} />
          <div className="min-w-0">
            <p className={cx('text-[12px] font-medium', roleOnly ? 'text-ink-2' : 'text-fault')}>
              {roleOnly ? 'Gate closed for your role' : 'Gate sealed'}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{decision.message}</p>

            {decision.finding?.limit ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10.5px]">
                <dt className="text-ink-4">policy limit</dt>
                <dd className="evidence text-ink-2">{decision.finding.limit}</dd>
                <dt className="text-ink-4">observed</dt>
                <dd className="evidence text-fault">{decision.finding.observed}</dd>
              </dl>
            ) : null}

            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-4">
              No approval control is rendered here — not disabled, not hidden. The component that would draw it
              requires a grant, and no grant exists.{' '}
              <Evidence size="xs" className="text-ink-3">
                {decision.reason}
              </Evidence>
            </p>
          </div>
        </div>
      </div>

      {canBreak ? <BreakGlass onSubmit={onBreakGlass} busy={busy} reason={decision.reason} /> : null}
    </div>
  );
}

/**
 * The other door.
 *
 * Break-glass cannot mint a grant — it is a different type carrying a different
 * witness, so the Approve control above could not accept it even if this
 * component tried to hand it over. What it does is record that a named human,
 * during an incident, chose to go around a sealed door, with a written reason,
 * permanently, in the same ledger as everything else.
 */
function BreakGlass({
  onSubmit,
  busy,
  reason,
}: {
  onSubmit: (justification: string) => void;
  busy?: boolean;
  reason: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const short = text.trim().length < MIN_JUSTIFICATION;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-[4px] border border-dashed border-hazard/35 px-3 py-2 text-[11px] text-hazard/80 transition-colors hover:border-hazard/60 hover:text-hazard"
      >
        Break the glass — override this seal on the record
      </button>
    );
  }

  return (
    <div className="hazard-hatch rounded-[5px] border border-hazard/45 bg-hazard-bg/60 p-3">
      <div className="rounded-[4px] bg-panel/85 p-3">
        <Legend className="!text-hazard">Break-glass override</Legend>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">
          This does not open the gate. It records that you went around it, bypassing{' '}
          <Evidence size="xs" className="text-hazard">
            {reason}
          </Evidence>
          , with your name on it, in the ledger, permanently.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Why are you doing this? At least 40 characters, in your own words, in a record that outlives the incident."
          className="scroll-thin mt-2.5 w-full resize-none rounded-[4px] border border-hairline-2 bg-void px-2.5 py-2 text-[11.5px] leading-relaxed text-ink placeholder:text-ink-4"
        />

        <div className="mt-1.5 flex items-center justify-between gap-3">
          <Evidence size="xs" className={short ? 'text-ink-4' : 'text-seal'}>
            {text.trim().length}/{MIN_JUSTIFICATION}
          </Evidence>
          <div className="flex gap-2">
            <Button tone="neutral" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button tone="hazard" size="sm" disabled={short || busy} onClick={() => onSubmit(text.trim())}>
              {busy ? 'Recording…' : 'Break the glass'}
            </Button>
          </div>
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

/**
 * How big this change is, in the one shape that works for every class.
 *
 * `people` is rendered in the alarm colour when it is non-zero, and `records`
 * never is. That is not inconsistency — forty thousand rows in an audit table
 * is a Tuesday, and forty thousand people is an incident.
 */
function MagnitudeBlock({ dossier }: { dossier: Dossier }) {
  const m = dossier.magnitude;
  if (m.records === 0 && m.people === 0 && m.amount_minor === 0) return null;

  return (
    <div>
      <Legend className="mb-2">What this costs the world</Legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {m.records > 0 ? <MagnitudeCell label="records" value={m.records.toLocaleString()} /> : null}
        {m.people > 0 ? (
          <MagnitudeCell
            label={m.people === 1 ? 'person' : 'people'}
            value={m.people.toLocaleString()}
            tone="hazard"
          />
        ) : null}
        {m.amount_minor !== 0 ? (
          <MagnitudeCell
            label={m.amount_minor > 0 ? 'leaving' : 'arriving'}
            value={formatMoney(Math.abs(m.amount_minor), m.currency)}
            tone="hazard"
          />
        ) : null}
        <MagnitudeCell
          label="undo window"
          value={
            m.undo_window_seconds === null
              ? 'none'
              : m.undo_window_seconds === 0
                ? 'immediate'
                : `${Math.round(m.undo_window_seconds / 3600)} h`
          }
          tone={m.undo_window_seconds === null ? 'hazard' : 'seal'}
        />
      </div>
      {m.undo_window_seconds === null ? (
        <p className="mt-2 text-[10.5px] leading-relaxed text-hazard">
          There is no undo window. The moment this is applied it is permanent.
        </p>
      ) : null}
    </div>
  );
}

function MagnitudeCell({
  label,
  value,
  tone = 'ink',
}: {
  label: string;
  value: string;
  tone?: 'ink' | 'hazard' | 'seal';
}) {
  const tones = { ink: 'text-ink', hazard: 'text-hazard', seal: 'text-seal' } as const;
  return (
    <div className="rounded-[5px] border border-hairline bg-void px-2.5 py-2">
      <Evidence size="md" className={cx('block leading-none', tones[tone])}>
        {value}
      </Evidence>
      <Legend className="mt-1.5 !text-[9px]">{label}</Legend>
    </div>
  );
}

/** For ACCESS_GRANT: who receives what power, over what, until when. */
function PrincipalsBlock({ dossier }: { dossier: Dossier }) {
  if (dossier.principals.length === 0) return null;
  return (
    <div>
      <Legend className="mb-2">Who receives power</Legend>
      <div className="space-y-2">
        {dossier.principals.map((p) => (
          <div key={p.subject} className="overflow-hidden rounded-[5px] border border-hairline bg-void">
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-2.5 py-2">
              <Evidence size="sm" className="min-w-0 flex-1 truncate text-ink">
                {p.subject}
              </Evidence>
              <Chip tone={p.expires_at ? 'seal' : 'hazard'} mono className="!text-[9.5px]">
                {p.expires_at
                  ? `expires ${new Date(p.expires_at).toLocaleString('en-GB', { hour12: false })}`
                  : 'never expires'}
              </Chip>
            </div>
            <div className="px-2.5 py-2">
              <Legend className="!text-[9px]">Grants</Legend>
              <ul className="mt-1 space-y-0.5">
                {p.grants.map((g) => (
                  <li key={g}>
                    <Evidence size="xs" className="break-all text-ink-2">
                      {g}
                    </Evidence>
                  </li>
                ))}
              </ul>
              {p.unlocks.length > 0 ? (
                <>
                  <Legend className="mt-2.5 !text-[9px]">What that unlocks</Legend>
                  <ul className="mt-1 space-y-0.5">
                    {p.unlocks.map((u) => (
                      <li key={u} className="text-[11px] leading-relaxed text-ink-3">
                        <span className="mr-1.5 text-ink-4">—</span>
                        {u}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The policy in force for this class, and anything it objects to.
 *
 * The rule comes off the decision rather than being looked up again, so what is
 * displayed is provably the rule that was applied — not a second read that
 * could disagree with the first.
 */
function PolicyBlock({ decision }: { decision: GateDecision }) {
  const r = decision.policy.rule;
  const findings = decision.policy.findings;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <Legend>Policy</Legend>
        <Evidence size="xs" className={findings.length === 0 ? 'text-seal' : 'text-fault'}>
          {findings.length === 0 ? 'satisfied' : `${findings.length} objection${findings.length === 1 ? '' : 's'}`}
        </Evidence>
      </div>

      <div className="overflow-hidden rounded-[5px] border border-hairline bg-void">
        <div className="grid grid-cols-2 gap-x-4 px-2.5 py-2 sm:grid-cols-4">
          <PolicyCell label="certificate" value={r.requires} />
          <PolicyCell label="approvers" value={String(r.quorum)} />
          <PolicyCell label="proof valid" value={`${Math.round(r.freshness_seconds / 60)} min`} />
          <PolicyCell label="break-glass" value={r.break_glass ? 'permitted' : 'no'} />
        </div>

        {r.note ? (
          <p className="border-t border-hairline px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-3">{r.note}</p>
        ) : null}

        {findings.length > 0 ? (
          <ul className="border-t border-hairline">
            {findings.map((f, i) => (
              <li key={i} className={cx('px-2.5 py-2', i > 0 && 'border-t border-hairline')}>
                <div className="flex items-baseline justify-between gap-2">
                  <Evidence size="xs" className="text-fault">
                    {f.code}
                  </Evidence>
                  {f.observed ? (
                    <Evidence size="xs" className="text-ink-3">
                      {f.observed}
                    </Evidence>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{f.message}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function PolicyCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-0.5">
      <Legend className="!text-[9px]">{label}</Legend>
      <Evidence size="xs" className="mt-0.5 block text-ink-2">
        {value}
      </Evidence>
    </div>
  );
}

/** Who has signed, and how many more people it needs. */
function QuorumBlock({ dossier }: { dossier: Dossier }) {
  const signed = approversFor(dossier);
  const outstanding = sealsOutstanding(dossier);
  const required = signed.length + outstanding;
  if (required <= 1 && dossier.signatures.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <Legend>Signatures</Legend>
        <Evidence size="xs" className={outstanding === 0 ? 'text-seal' : 'text-ink-3'}>
          {signed.length} of {required}
        </Evidence>
      </div>

      <div className="overflow-hidden rounded-[5px] border border-hairline bg-void">
        <div className="flex gap-1 px-2.5 pt-2.5">
          {Array.from({ length: Math.max(required, dossier.signatures.length) }, (_, i) => (
            <span key={i} className={cx('h-1.5 flex-1 rounded-[1px]', i < signed.length ? 'bg-seal' : 'bg-hairline-3')} />
          ))}
        </div>

        {dossier.signatures.length > 0 ? (
          <ul className="px-2.5 py-2">
            {dossier.signatures.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
                <span
                  className={cx(
                    'size-1.5 shrink-0 rounded-full',
                    s.break_glass ? 'bg-hazard' : s.decision === 'approved' ? 'bg-seal' : 'bg-fault',
                  )}
                />
                <Evidence size="xs" className="text-ink-2">
                  {s.approver}
                </Evidence>
                <span className="text-[10px] text-ink-4">
                  {s.break_glass ? 'broke the glass' : s.decision} ·{' '}
                  {new Date(s.at).toLocaleString('en-GB', { hour12: false })}
                </span>
                {s.reason ? <p className="w-full pl-3.5 text-[10.5px] text-ink-3">{s.reason}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2.5 py-2 text-[10.5px] text-ink-3">Nobody has signed yet.</p>
        )}

        {outstanding > 0 ? (
          <p className="border-t border-hairline px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-3">
            {outstanding} more approver{outstanding === 1 ? '' : 's'} required, and it cannot be anyone who has already
            signed. A quorum counts people, not clicks.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Production re-checksummed against the state the proof was taken from. */
function DriftBlock({ dossier }: { dossier: Dossier }) {
  const { drift, certificate } = dossier;
  if (!drift.checked_at) return null;

  const expected = certificate?.checksums?.pre;
  const observed = drift.production_checksum;
  const moved = drift.drifted === true || (Boolean(expected) && Boolean(observed) && expected !== observed);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <Legend>Production, right now</Legend>
        <Evidence size="xs" className={moved ? 'text-fault' : 'text-seal'}>
          {moved ? 'moved since the proof' : 'unchanged'}
        </Evidence>
      </div>
      <div className={cx('rounded-[5px] border bg-void px-2.5 py-2', moved ? 'border-fault/30' : 'border-hairline')}>
        {expected ? (
          <div className="flex items-baseline gap-2 py-0.5">
            <Legend className="!w-[74px] shrink-0 !text-[9px]">proof taken at</Legend>
            <Evidence size="xs" className="min-w-0 flex-1 truncate text-ink-3">
              {expected}
            </Evidence>
          </div>
        ) : null}
        {observed ? (
          <div className="flex items-baseline gap-2 py-0.5">
            <Legend className="!w-[74px] shrink-0 !text-[9px]">production is</Legend>
            <Evidence size="xs" className={cx('min-w-0 flex-1 truncate', moved ? 'text-fault' : 'text-ink-3')}>
              {observed}
            </Evidence>
          </div>
        ) : null}
        <p className={cx('mt-1.5 text-[10.5px] leading-relaxed', moved ? 'text-fault' : 'text-ink-4')}>
          {moved
            ? `The checker reported drifted: ${String(drift.drifted)}. AIRLOCK compared the digests itself and disagreed — a claim of safety is never taken on trust.`
            : `Re-checked ${new Date(drift.checked_at).toLocaleString('en-GB', { hour12: false })}. The proof still describes the database that exists.`}
        </p>
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
          emptyNote="No rollback exists. This change is not reversible, which is why it carries a scope certificate instead."
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
        <p className="px-2.5 py-3 text-[11px] leading-relaxed text-ink-3">{emptyNote}</p>
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
          <Legend>Blast radius — will be affected</Legend>
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
              <Evidence size="xs" className="w-16 shrink-0 text-right text-ink">
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

/** The tamper-evident link, once the change has been decided. */
function ReceiptBlock({ dossier }: { dossier: Dossier }) {
  if (!dossier.receipt) return null;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <Legend>Sealed into the ledger</Legend>
        <a
          href={`/api/dossiers/${dossier.dossier_id}/receipt`}
          className="text-[10.5px] text-ice transition-colors hover:underline"
        >
          download receipt
        </a>
      </div>
      <div className="rounded-[5px] border border-hairline bg-void px-2.5 py-2">
        <Readout label="Sequence">#{dossier.receipt.seq}</Readout>
        <Divider />
        <div className="pt-1.5">
          <Legend className="!text-[9px]">Hash</Legend>
          <Evidence size="xs" className="mt-1 block break-all text-ink-2">
            {dossier.receipt.hash}
          </Evidence>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-4">
          Commits to the record above and to the hash of the change before it. Editing any of it after the fact breaks
          every link that follows, and{' '}
          <Evidence size="xs" className="text-ink-3">
            npm run verify:ledger
          </Evidence>{' '}
          says exactly where.
        </p>
      </div>
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
  onBreakGlass,
  breakGlassEnabled = false,
  busy,
  className,
}: {
  dossier: Dossier;
  viewer: Viewer;
  onApprove: (grant: ApprovalGrant) => void;
  onReject: (reason: string) => void;
  onBreakGlass?: (justification: string) => void;
  breakGlassEnabled?: boolean;
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

        <MagnitudeBlock dossier={dossier} />
        <PolicyBlock decision={decision} />
        <QuorumBlock dossier={dossier} />

        <PrincipalsBlock dossier={dossier} />
        <SqlDiff dossier={dossier} />
        <AffectedTables dossier={dossier} />
        <LockProfile dossier={dossier} />

        {cert?.checksums ? <ChecksumTriple triple={cert.checksums} /> : null}
        <DriftBlock dossier={dossier} />
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
                    <a href={n.source_url} target="_blank" rel="noreferrer" className="ml-1.5 text-ice hover:underline">
                      {n.source_title ?? 'source'}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <CostBlock dossier={dossier} />
        <ReceiptBlock dossier={dossier} />
      </div>

      {/* ---- the decision ---- */}
      <footer className="shrink-0 space-y-2 border-t border-hairline bg-panel px-3.5 py-3">
        {decision.state === 'OPEN' ? (
          <>
            <ApproveControl grant={decision.grant} onApprove={onApprove} busy={busy} />
            <Button tone="neutral" size="md" full disabled={busy} onClick={() => onReject('rejected by approver')}>
              Reject and tear down the shadow branch
            </Button>
            <p className="pt-0.5 text-center text-[10px] leading-relaxed text-ink-4">
              {decision.grant.final ? 'Approving' : 'Countersigning'} as{' '}
              <span className="evidence text-ink-3">{viewer.email}</span> · this decision is written to the immutable
              ledger
            </p>
          </>
        ) : (
          <SealedDoor
            dossier={dossier}
            decision={decision}
            viewer={viewer}
            breakGlassEnabled={breakGlassEnabled}
            onBreakGlass={(justification) => onBreakGlass?.(justification)}
            busy={busy}
          />
        )}
      </footer>
    </Panel>
  );
}

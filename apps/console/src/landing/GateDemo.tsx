'use client';

import { useMemo, useState } from 'react';
import {
  openGate,
  parseDossier,
  verdictOf,
  type ApprovalGrant,
  type ChangeClass,
  type Dossier,
  type GateDecision,
} from '@airlock/contract';
import { cx } from '@/design/primitives';

/**
 * The gate, live, on the marketing page.
 *
 * This is not a mock-up or a recording. The component below imports `openGate`
 * from `@airlock/contract` — the same function the console calls, the same one
 * the server re-runs before it writes anything — and renders whatever it
 * returns. Every combination of these controls is a real evaluation.
 *
 * The point being made is a specific one, and it is best made by letting people
 * try to break it: when the gate seals, the Approve control is not disabled and
 * not hidden. It is **unrenderable**. `ApproveControl` takes an `ApprovalGrant`,
 * `ApprovalGrant` carries a symbol that only `openGate` can mint, and a sealed
 * decision does not carry one. There is no value this component could pass it.
 *
 * Time is pinned to a fixed instant rather than `Date.now()`, for two reasons:
 * the same input must produce the same output on the server and after
 * hydration, and a demo whose behaviour depends on what time you read it is a
 * demo nobody can reason about.
 */

/** Monday, mid-morning in London. Outside every change freeze in the shipped policy. */
const NOW = new Date('2026-08-24T10:00:00Z');
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const HASH_A = `sha256:${'a4f1'.repeat(16)}`;
const HASH_B = `sha256:${'9c02'.repeat(16)}`;
const HASH_C = `sha256:${'71de'.repeat(16)}`;

type CertState = 'PROVEN' | 'PENDING' | 'FAILED' | 'ABSENT';
type Who = 'approver' | 'requester' | 'author';

interface Knobs {
  cls: ChangeClass;
  cert: CertState;
  intact: boolean;
  fresh: boolean;
  drifted: boolean;
  who: Who;
  /** ACCESS_GRANT only. */
  expires: boolean;
  /** MONEY_MOVEMENT only. */
  overCeiling: boolean;
  /** ERASURE only: whether somebody else has already signed. */
  countersigned: boolean;
}

const INITIAL: Knobs = {
  cls: 'SCHEMA_MIGRATION',
  cert: 'PROVEN',
  intact: true,
  fresh: true,
  drifted: false,
  who: 'approver',
  expires: true,
  overCeiling: false,
  countersigned: false,
};

const REQUESTER = 'priya.n@airlock.dev';
const VIEWERS: Record<Who, { email: string; role: string }> = {
  approver: { email: 'sam.okafor@airlock.dev', role: 'approver' },
  requester: { email: 'dev@airlock.dev', role: 'requester' },
  author: { email: REQUESTER, role: 'approver' },
};

/* -------------------------------------------------------------------------- */
/* Building the dossier the gate will judge                                    */
/* -------------------------------------------------------------------------- */

function build(k: Knobs): Dossier {
  const wantsUndo = k.cls === 'SCHEMA_MIGRATION';
  const verifiedAt = iso(k.fresh ? 2 : 45);

  const certificate =
    k.cert === 'ABSENT'
      ? undefined
      : {
          kind: wantsUndo ? ('UNDO' as const) : ('SCOPE' as const),
          status: k.cert,
          verified_at: verifiedAt,
          ...(k.cert === 'FAILED'
            ? { failure_reason: 'The rollback restored 1,199,998 of 1,200,000 rows.' }
            : {}),
          ...(wantsUndo
            ? {
                checksums: {
                  pre: HASH_A,
                  post: HASH_B,
                  // A broken proof means the data did not come back.
                  post_rollback: k.intact ? HASH_A : HASH_C,
                  match: true,
                },
                lock_ms_estimate: 4210,
                table_rewrite: false,
              }
            : {
                scope: k.intact
                  ? {
                      records: [{ system: 'postgres', id: 'subject 8812', action: 'delete', count: 41 }],
                      exclusions: [
                        {
                          system: 'postgres',
                          table: 'invoices',
                          reason: 'Seven-year statutory retention.',
                          count: 12,
                        },
                      ],
                    }
                  : // An unbounded scope: nothing listed, nothing excluded.
                    { records: [], exclusions: [] },
              }),
        };

  return parseDossier({
    dossier_id: 'dos_demo',
    change_class: k.cls,
    request: REQUEST_COPY[k.cls],
    requested_by: REQUESTER,
    created_at: iso(60),
    target: { systems: ['postgres'], branch_ref: 'br_shadow_4f21a' },
    forward: [{ system: 'postgres', op: 'ALTER TABLE users ADD COLUMN tier text;', reversible: true, proven: true }],
    rollback: wantsUndo
      ? [{ system: 'postgres', op: 'ALTER TABLE users DROP COLUMN tier;', reversible: true, proven: true }]
      : [],
    magnitude: {
      // Sized per class, because a magnitude that says "1,200,000 rows" next to
      // a four-hour access grant is the kind of small untruth that makes a
      // reader stop believing the larger ones.
      records: RECORDS[k.cls],
      people: k.cls === 'ERASURE' ? 1 : k.cls === 'MONEY_MOVEMENT' ? 1_046 : 0,
      amount_minor: k.cls === 'MONEY_MOVEMENT' ? (k.overCeiling ? 4_190_400 : 90_000) : 0,
      currency: k.cls === 'MONEY_MOVEMENT' ? 'GBP' : undefined,
      undo_window_seconds: null,
    },
    principals:
      k.cls === 'ACCESS_GRANT'
        ? [
            {
              subject: 'oncall@airlock.dev',
              grants: ['postgres:SELECT ON ALL TABLES IN SCHEMA public'],
              scope: 'airlock-production',
              expires_at: k.expires ? new Date(NOW.getTime() + 4 * 3600_000).toISOString() : null,
              unlocks: ['Reading every row of customer data in public.*'],
            },
          ]
        : [],
    signatures:
      k.countersigned && k.cls === 'ERASURE'
        ? [{ approver: 'dana.q@airlock.dev', at: iso(5), decision: 'approved', reason: null, break_glass: false }]
        : [],
    drift: k.drifted
      ? { checked_at: iso(1), production_checksum: HASH_C, drifted: false }
      : { checked_at: iso(1), production_checksum: wantsUndo ? HASH_A : null, drifted: false },
    ...(certificate ? { certificate } : {}),
  });
}

/** What the countable unit is for each class the demo offers. */
const RECORDS: Record<ChangeClass, number> = {
  SCHEMA_MIGRATION: 1_200_000,
  DATA_OPERATION: 1_200_000,
  ERASURE: 41,
  ACCESS_GRANT: 215,
  MONEY_MOVEMENT: 1_046,
  COMMS_BLAST: 61_400,
  INFRA_MUTATION: 2,
};

const REQUEST_COPY: Record<ChangeClass, string> = {
  SCHEMA_MIGRATION: 'Add a tier column to users, backfill it, then drop the deprecated plan_name column.',
  DATA_OPERATION: 'Correct the currency on every EU invoice created before January.',
  ERASURE: 'Erase dana.reyes@example.com from every system we hold them in.',
  ACCESS_GRANT: 'Give the on-call engineer production read access for the length of this incident.',
  MONEY_MOVEMENT: 'Refund the duplicate charge to everyone affected by the pricing bug.',
  COMMS_BLAST: 'Email every affected customer about the refund before they see their statement.',
  INFRA_MUTATION: 'Scale the read replica pool from three nodes down to one.',
};

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

function Segmented<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Array<{ value: T; label: string; tone?: 'ice' | 'seal' | 'fault' | 'hazard' }>;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="legend">{label}</span>
        {hint ? <span className="text-[10px] text-ink-4">{hint}</span> : null}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-1 rounded-[5px] border border-hairline bg-void p-1"
      >
        {options.map((o) => {
          const on = value === o.value;
          const tone = o.tone ?? 'ice';
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cx(
                'flex-1 rounded-[3px] px-2 py-1.5 text-[11.5px] font-medium whitespace-nowrap transition-colors',
                on
                  ? {
                      ice: 'bg-ice-bg text-ice',
                      seal: 'bg-seal-bg text-seal',
                      fault: 'bg-fault-bg text-fault',
                      hazard: 'bg-hazard-bg text-hazard',
                    }[tone]
                  : 'text-ink-3 hover:bg-raised hover:text-ink-2',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One readable fact from the dossier the gate just judged. */
function Fact({
  label,
  value,
  tone = 'ink',
}: {
  label: string;
  value: string;
  tone?: 'ink' | 'seal' | 'hazard' | 'fault';
}) {
  const tones = { ink: 'text-ink-2', seal: 'text-seal', hazard: 'text-hazard', fault: 'text-fault' } as const;
  return (
    <div className="min-w-0">
      <dt className="legend !text-[9px]">{label}</dt>
      <dd className={cx('evidence mt-1 truncate text-[11px]', tones[tone])}>{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The gated control — the same shape the console uses                         */
/* -------------------------------------------------------------------------- */

/**
 * Takes proof, not a boolean.
 *
 * This signature is the entire argument. There is no `sealed` prop to pass, no
 * `disabled` state to render, and no way to call it without a value that
 * `openGate` produced.
 */
function ApproveControl({ grant }: { grant: ApprovalGrant }) {
  const [armed, setArmed] = useState(false);

  if (!grant.final) {
    return (
      <button className="h-11 w-full rounded-[5px] border border-ice-dim bg-ice-bg text-[13px] font-medium text-ice transition-colors hover:bg-ice-deep">
        Countersign — {grant.seals_held} of {grant.seals_required} signatures
      </button>
    );
  }

  if (grant.irreversible && !armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        className="h-11 w-full rounded-[5px] border border-hazard/55 bg-hazard-bg text-[13px] font-medium text-hazard transition-[filter] hover:brightness-125"
      >
        This cannot be undone — arm approval
      </button>
    );
  }

  return (
    <button
      className={cx(
        'h-11 w-full rounded-[5px] border text-[13px] font-medium transition-[filter] hover:brightness-125',
        grant.irreversible
          ? 'border-hazard/55 bg-hazard-bg text-hazard'
          : 'border-seal/45 bg-seal-bg text-seal',
      )}
    >
      {grant.irreversible ? 'Approve — destroy the listed records' : 'Approve — apply to production'}
    </button>
  );
}

function SealedDoor({ decision }: { decision: Extract<GateDecision, { state: 'SEALED' }> }) {
  const roleOnly = decision.reason === 'ROLE_NOT_APPROVER' || decision.reason === 'SELF_APPROVAL';
  return (
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
            {roleOnly ? 'Gate closed for you' : 'Gate sealed'}
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

          <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-4">
            No approval control is rendered here — not disabled, not hidden. The component that would draw it
            requires a grant, and no grant exists.{' '}
            <span className="evidence text-ink-3">{decision.reason}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The demo                                                                    */
/* -------------------------------------------------------------------------- */

export function GateDemo() {
  const [k, setK] = useState<Knobs>(INITIAL);

  /*
   * How many distinct combinations the reader has tried, and how many opened.
   *
   * Counted in the handler that changes a knob, not accumulated into a ref
   * while rendering. Mutating a ref during render — and then reading `.size`
   * back out of it in the same pass — is impure: React is free to render this
   * component twice for one interaction, or to abandon a render half-way, and
   * either would quietly inflate a counter the page presents as a fact. The
   * gate is re-opened for the *next* knobs to decide which set to add to,
   * which costs one pure `openGate` call per click.
   */
  const [tried, setTried] = useState<ReadonlySet<string>>(() => new Set([JSON.stringify(INITIAL)]));
  const [opened, setOpened] = useState<ReadonlySet<string>>(() =>
    openGate(build(INITIAL), VIEWERS[INITIAL.who], { now: NOW }).state === 'OPEN'
      ? new Set([JSON.stringify(INITIAL)])
      : new Set(),
  );

  const set = <K extends keyof Knobs>(key: K, value: Knobs[K]) => {
    const next = { ...k, [key]: value };
    const nextKey = JSON.stringify(next);
    setK(next);
    // A set that already holds the key is returned unchanged, so re-treading
    // combinations does not re-render the page.
    setTried((s) => (s.has(nextKey) ? s : new Set(s).add(nextKey)));
    if (openGate(build(next), VIEWERS[next.who], { now: NOW }).state === 'OPEN') {
      setOpened((s) => (s.has(nextKey) ? s : new Set(s).add(nextKey)));
    }
  };

  const dossier = useMemo(() => build(k), [k]);
  const viewer = VIEWERS[k.who];
  const decision = useMemo(() => openGate(dossier, viewer, { now: NOW }), [dossier, viewer]);
  const verdict = verdictOf(dossier, decision);
  const policy = decision.policy;

  const wantsUndo = k.cls === 'SCHEMA_MIGRATION';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ------------------------------- controls ------------------------------- */}
      <div className="panel milled p-4">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <span className="legend">Try to open it</span>
          <span className="evidence text-[10px] text-ink-4">
            {tried.size} tried · {opened.size} opened
          </span>
        </div>

        <div className="space-y-3.5">
          <Segmented
            label="Change class"
            hint="each class has its own policy"
            value={k.cls}
            options={[
              { value: 'SCHEMA_MIGRATION' as ChangeClass, label: 'Migration' },
              { value: 'ERASURE' as ChangeClass, label: 'Erasure' },
              { value: 'ACCESS_GRANT' as ChangeClass, label: 'Access' },
              { value: 'MONEY_MOVEMENT' as ChangeClass, label: 'Money' },
            ]}
            onChange={(v) => set('cls', v)}
          />

          <Segmented
            label="Certificate"
            value={k.cert}
            options={[
              { value: 'PROVEN' as CertState, label: 'Proven', tone: 'seal' },
              { value: 'PENDING' as CertState, label: 'Pending' },
              { value: 'FAILED' as CertState, label: 'Failed', tone: 'fault' },
              { value: 'ABSENT' as CertState, label: 'None', tone: 'fault' },
            ]}
            onChange={(v) => set('cert', v)}
          />

          <Segmented
            label={wantsUndo ? 'The checksum triple' : 'The computed scope'}
            hint={wantsUndo ? 'did the data come back?' : 'is the blast radius bounded?'}
            value={k.intact ? 'yes' : 'no'}
            options={[
              { value: 'yes', label: wantsUndo ? 'Line 3 ≡ line 1' : 'Bounded', tone: 'seal' },
              { value: 'no', label: wantsUndo ? 'Line 3 ≠ line 1' : 'Unbounded', tone: 'fault' },
            ]}
            onChange={(v) => set('intact', v === 'yes')}
          />

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Segmented
              label="Proof age"
              value={k.fresh ? 'fresh' : 'stale'}
              options={[
                { value: 'fresh', label: '2 min', tone: 'seal' },
                { value: 'stale', label: '45 min', tone: 'fault' },
              ]}
              onChange={(v) => set('fresh', v === 'fresh')}
            />
            <Segmented
              label="Production"
              value={k.drifted ? 'moved' : 'same'}
              options={[
                { value: 'same', label: 'Unchanged', tone: 'seal' },
                { value: 'moved', label: 'Moved since', tone: 'fault' },
              ]}
              onChange={(v) => set('drifted', v === 'moved')}
            />
          </div>

          {/* --- the knob that only matters for this class --- */}
          {k.cls === 'ACCESS_GRANT' ? (
            <Segmented
              label="The grant"
              hint="policy forbids standing access"
              value={k.expires ? 'expires' : 'forever'}
              options={[
                { value: 'expires', label: 'Expires in 4 h', tone: 'seal' },
                { value: 'forever', label: 'Never expires', tone: 'fault' },
              ]}
              onChange={(v) => set('expires', v === 'expires')}
            />
          ) : null}

          {k.cls === 'MONEY_MOVEMENT' ? (
            <Segmented
              label="Amount"
              hint="ceiling is £25,000"
              value={k.overCeiling ? 'over' : 'under'}
              options={[
                { value: 'under', label: '£900.00', tone: 'seal' },
                { value: 'over', label: '£41,904.00', tone: 'fault' },
              ]}
              onChange={(v) => set('overCeiling', v === 'over')}
            />
          ) : null}

          {k.cls === 'ERASURE' ? (
            <Segmented
              label="Signatures already held"
              hint="an erasure needs two people"
              value={k.countersigned ? 'one' : 'none'}
              options={[
                { value: 'none', label: 'None yet' },
                { value: 'one', label: 'One, by someone else', tone: 'seal' },
              ]}
              onChange={(v) => set('countersigned', v === 'one')}
            />
          ) : null}

          <Segmented
            label="You are"
            value={k.who}
            options={[
              { value: 'approver' as Who, label: 'An approver', tone: 'seal' },
              { value: 'requester' as Who, label: 'A requester' },
              { value: 'author' as Who, label: 'Who asked for it', tone: 'fault' },
            ]}
            onChange={(v) => set('who', v)}
          />
        </div>

        <button
          onClick={() => setK(INITIAL)}
          className="mt-4 text-[11px] text-ink-4 transition-colors hover:text-ink-2"
        >
          Reset
        </button>
      </div>

      {/* -------------------------------- result -------------------------------- */}
      <div className="flex flex-col gap-3">
        <div
          className={cx(
            'relative overflow-hidden rounded-[6px] border px-4 py-3.5',
            verdict.tone === 'proven'
              ? 'border-seal/40 bg-seal-bg'
              : verdict.tone === 'irreversible'
                ? 'border-hazard/45 bg-hazard-bg'
                : 'border-fault/40 bg-fault-bg',
          )}
        >
          {verdict.tone === 'irreversible' ? (
            <div className="hazard-hatch absolute inset-0 opacity-60" aria-hidden />
          ) : null}
          <div className="relative">
            <p
              className={cx(
                'evidence text-[12.5px] font-semibold tracking-[0.06em]',
                verdict.tone === 'proven'
                  ? 'text-seal'
                  : verdict.tone === 'irreversible'
                    ? 'text-hazard'
                    : 'text-fault',
              )}
            >
              {verdict.label}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{verdict.sub}</p>
          </div>
        </div>

        <div className="panel milled flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="legend">What the console renders</span>
            <span className="evidence text-[10px] text-ink-4">{dossier.change_class}</span>
          </div>

          <p className="mb-3 text-[12px] leading-relaxed text-ink-2">{dossier.request}</p>

          {/* The evidence the gate actually read, so the verdict above is
              checkable rather than merely asserted. */}
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 border-y border-hairline py-3 sm:grid-cols-3">
            <Fact
              label="certificate"
              value={dossier.certificate ? `${dossier.certificate.kind} · ${dossier.certificate.status}` : 'none'}
              tone={
                !dossier.certificate || dossier.certificate.status !== 'PROVEN'
                  ? 'fault'
                  : dossier.certificate.kind === 'SCOPE'
                    ? 'hazard'
                    : 'seal'
              }
            />
            <Fact
              label="proof age"
              value={k.fresh ? '2 min' : '45 min'}
              tone={k.fresh ? 'seal' : 'fault'}
            />
            <Fact
              label="production"
              value={k.drifted ? 'moved' : 'unchanged'}
              tone={k.drifted ? 'fault' : 'seal'}
            />
            <Fact
              label="magnitude"
              value={
                dossier.magnitude.amount_minor !== 0
                  ? `£${(Math.abs(dossier.magnitude.amount_minor) / 100).toLocaleString('en-GB')}`
                  : dossier.magnitude.people > 0
                    ? `${dossier.magnitude.people} ${dossier.magnitude.people === 1 ? 'person' : 'people'}`
                    : `${dossier.magnitude.records.toLocaleString()} rows`
              }
            />
            <Fact
              label="signatures"
              value={`${policy.sealsHeld} of ${policy.sealsRequired}`}
              tone={policy.sealsHeld >= policy.sealsRequired ? 'seal' : 'ink'}
            />
            <Fact
              label="policy"
              value={
                policy.findings.length === 0
                  ? 'satisfied'
                  : `${policy.findings.length} objection${policy.findings.length === 1 ? '' : 's'}`
              }
              tone={policy.findings.length === 0 ? 'seal' : 'fault'}
            />
          </dl>

          <div className="mt-auto pt-3">
            {decision.state === 'OPEN' ? (
              <>
                <ApproveControl grant={decision.grant} />
                <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-4">
                  <span className="evidence text-seal">openGate()</span> returned a grant, so the control above can
                  exist. It is the only way one comes into being.
                </p>
              </>
            ) : (
              <SealedDoor decision={decision} />
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-[6px] border border-hairline bg-void">
          <div className="border-b border-hairline px-3 py-1.5">
            <span className="evidence text-[10px] text-ink-4">the call that produced the above</span>
          </div>
          <pre className="scroll-thin overflow-x-auto px-3.5 py-2.5">
            <code className="evidence text-[11px] leading-relaxed text-ink-3">
              {`openGate(dossier, { role: '${viewer.role}' })\n`}
              <span className={decision.state === 'OPEN' ? 'text-seal' : 'text-fault'}>
                {decision.state === 'OPEN'
                  ? `-> { state: 'OPEN', grant: { final: ${decision.grant.final}, seals: ${decision.grant.seals_held}/${decision.grant.seals_required} } }`
                  : `-> { state: 'SEALED', reason: '${decision.reason}' }`}
              </span>
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}

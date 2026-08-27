'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CHANGE_CLASSES,
  CHANGE_CLASS_COPY,
  DEFAULT_POLICY,
  SEAL_COPY,
  activeBlackouts,
  approversFor,
  formatMoney,
  openGate,
  resolvedRules,
  sealsOutstanding,
  verifyChain,
  type ChainVerdict,
  type ChangeClass,
  type Dossier,
  type SealReason,
  type Viewer,
} from '@airlock/contract';
import { Evidence, Legend, cx } from '@/design/primitives';
import { Mark } from '@/console/Mark';

/**
 * The control room.
 *
 * The console is what an operator works in; this is what the person accountable
 * for the system looks at. Same data, same gate, different question — not
 * "should I approve this one" but "what is this system holding, what has it
 * refused, and can I still trust the record of what it did".
 *
 * Two decisions worth stating:
 *
 *   1. The headline number is what the gate **refused**, not what it approved.
 *      A queue with nothing in it is not evidence of safety; a count of changes
 *      stopped, with the reasons, is.
 *   2. The ledger is re-verified here, in the browser, rather than trusting a
 *      server that says it is fine. Same `verifyChain` the server would run.
 */

interface PostureResponse {
  viewer: Viewer & { type: string };
  posture: {
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
  };
  ledger: { head: string; length: number };
  breakGlassEnabled: boolean;
  generated_at: string;
}

export function ControlRoom() {
  const [data, setData] = useState<PostureResponse | null>(null);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [chain, setChain] = useState<ChainVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set after mount so time-dependent readings never differ between server and client. */
  const [now, setNow] = useState<Date | null>(null);

  /*
   * A promise chain rather than an `async` function, deliberately.
   *
   * The body of an `async` function runs synchronously up to its first `await`,
   * so calling one from an effect puts every `setState` it might reach on the
   * same tick as the effect — a render to decide, then a render to correct
   * itself. Starting with `Promise.all` means the synchronous part of this is
   * two `fetch` calls and nothing else; every state write happens in a
   * continuation.
   */
  const refresh = useCallback(
    () =>
      Promise.all([fetch('/api/posture'), fetch('/api/dossiers')])
        .then(async ([p, d]) => {
          if (!p.ok || !d.ok) throw new Error('the console is not answering');
          setData((await p.json()) as PostureResponse);
          setDossiers(((await d.json()) as { dossiers: Dossier[] }).dossiers);
          // Stamped where the data lands rather than where the poll starts, so
          // "holding for 4m 12s" is measured against the reading it is shown
          // beside rather than against a clock that ticks independently of it.
          setNow(new Date());
          setError(null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'unknown error');
        }),
    [],
  );

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 6000);
    return () => clearInterval(id);
  }, [refresh]);

  /* --- re-verify the chain here, not on the server ------------------------ */
  useEffect(() => {
    const sealed = dossiers.filter((d) => d.receipt !== null).sort((a, b) => a.receipt!.seq - b.receipt!.seq);
    let live = true;
    void verifyChain(sealed).then((v) => {
      if (live) setChain(v);
    });
    return () => {
      live = false;
    };
  }, [dossiers]);

  /*
   * Memoised because the fallback is a fresh object every render, and this
   * feeds the dependency list of the refusal grouping below — so an unmemoised
   * literal quietly makes that `useMemo` recompute on every tick of a
   * six-second poll, which is the opposite of what it is there for.
   */
  const viewer = useMemo<Viewer>(
    () => data?.viewer ?? { email: 'loading…', role: 'requester' },
    [data?.viewer],
  );
  const p = data?.posture;

  /* --- everything the gate is currently refusing, grouped ----------------- */
  const refusals = useMemo(() => {
    const counts = new Map<SealReason, number>();
    for (const d of dossiers) {
      if (d.approval.decision !== null || d.audit.applied_at !== null) continue;
      const decision = openGate(d, viewer);
      if (decision.state === 'SEALED') counts.set(decision.reason, (counts.get(decision.reason) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [dossiers, viewer]);

  const byClass = useMemo(() => {
    const counts = new Map<ChangeClass, number>();
    for (const d of dossiers) counts.set(d.change_class, (counts.get(d.change_class) ?? 0) + 1);
    return counts;
  }, [dossiers]);

  const waiting = dossiers.filter((d) => d.approval.decision === null && d.audit.applied_at === null);
  const decided = dossiers
    .filter((d) => d.approval.decision !== null || d.audit.applied_at !== null)
    .sort((a, b) => (b.approval.at ?? b.created_at).localeCompare(a.approval.at ?? a.created_at));

  return (
    <div className="min-h-dvh">
      <Header viewer={viewer} generatedAt={data?.generated_at ?? null} />

      <main className="mx-auto max-w-[1320px] px-5 pt-6 pb-20 sm:px-8">
        {error ? (
          <div className="mb-5 rounded-[5px] border border-fault/35 bg-fault-bg/40 px-4 py-3">
            <p className="text-[12px] text-fault">
              The control room cannot reach the console API — {error}. Numbers below are the last ones it saw.
            </p>
          </div>
        ) : null}

        {/* ---------------------------- headline ---------------------------- */}
        <section>
          <div className="mb-3 flex items-baseline gap-3">
            <Legend>Posture</Legend>
            <div className="h-px flex-1 bg-hairline" />
            <Evidence size="xs" dim>
              {p?.total ?? 0} changes on record
            </Evidence>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile
              value={p?.sealed ?? 0}
              label="Refused right now"
              tone="fault"
              sub="Proven, and not permitted to proceed"
            />
            <Tile value={p?.open ?? 0} label="Ready to decide" tone="seal" sub="A certificate holds and policy agrees" />
            <Tile
              value={p?.awaitingQuorum ?? 0}
              label="Awaiting a second pair of eyes"
              tone="ice"
              sub="One signature short of moving"
            />
            <Tile
              value={(p?.peopleGuarded ?? 0).toLocaleString()}
              label="People not written to"
              tone="hazard"
              sub="Held back by a sealed or rejected change"
            />
            <Tile
              value={formatMoney(p?.moneyGuardedMinor ?? 0, 'GBP')}
              label="Money not moved"
              tone="hazard"
              sub="Above ceiling, or otherwise stopped"
            />
            <Tile
              value={(p?.recordsGuarded ?? 0).toLocaleString()}
              label="Records not touched"
              tone="ink"
              sub="The work the system did by not doing it"
            />
          </div>
        </section>

        <div className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* ---------------------------- the queue --------------------------- */}
          <div className="space-y-5">
            <Panel
              title="Held at the gate"
              right={
                <Evidence size="xs" dim>
                  {waiting.length} waiting
                </Evidence>
              }
            >
              {waiting.length === 0 ? (
                <Blank>Nothing is holding for a human.</Blank>
              ) : (
                <ul>
                  {waiting.map((d) => (
                    <QueueRow key={d.dossier_id} dossier={d} viewer={viewer} now={now} />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Why the gate is refusing" right={<Evidence size="xs" dim>by reason</Evidence>}>
              {refusals.length === 0 ? (
                <Blank>Nothing is currently sealed.</Blank>
              ) : (
                <div className="space-y-2.5 px-4 py-3.5">
                  {refusals.map(([reason, count]) => {
                    const max = refusals[0]![1];
                    return (
                      <div key={reason}>
                        <div className="flex items-baseline justify-between gap-3">
                          <Evidence size="xs" className="text-ink-2">
                            {reason}
                          </Evidence>
                          <Evidence size="xs" className="text-fault">
                            {count}
                          </Evidence>
                        </div>
                        <div className="meter mt-1.5">
                          <span
                            className="bg-fault"
                            style={{ width: `${Math.max(6, (count / max) * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-4">{SEAL_COPY[reason]}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel
              title="Decided"
              right={
                <Evidence size="xs" dim>
                  {p?.applied ?? 0} applied · {p?.rejected ?? 0} rejected
                </Evidence>
              }
            >
              {decided.length === 0 ? (
                <Blank>No change has passed through the airlock yet.</Blank>
              ) : (
                <ul>
                  {decided.map((d) => (
                    <DecidedRow key={d.dossier_id} dossier={d} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* --------------------------- right column ------------------------- */}
          <div className="space-y-5">
            <LedgerPanel chain={chain} head={data?.ledger.head ?? null} />
            <FreezePanel now={now} />
            <MixPanel byClass={byClass} total={dossiers.length} />
            <BreakGlassPanel enabled={data?.breakGlassEnabled ?? false} used={p?.breakGlass ?? 0} />
          </div>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chrome                                                                      */
/* -------------------------------------------------------------------------- */

function Header({ viewer, generatedAt }: { viewer: Viewer; generatedAt: string | null }) {
  return (
    <header className="milled sticky top-0 z-30 border-b border-hairline bg-panel/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-3 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <Mark size={17} />
          <span className="text-[13px] font-semibold tracking-[0.22em] select-none">AIRLOCK</span>
        </Link>
        <div className="mx-1 h-5 w-px bg-hairline" />
        <span className="legend">Control room</span>

        <div className="flex-1" />

        {generatedAt ? (
          <Evidence size="xs" className="hidden text-ink-4 sm:block">
            {new Date(generatedAt).toLocaleTimeString('en-GB', { hour12: false })}
          </Evidence>
        ) : null}

        <div
          className={cx(
            'flex items-center gap-1.5 rounded-[4px] border px-2 py-1',
            viewer.role === 'approver' ? 'border-seal/35 bg-seal-bg' : 'border-hairline-2 bg-raised',
          )}
        >
          <Legend className="!text-[9px]">{viewer.role}</Legend>
          <Evidence size="xs" className="max-w-[150px] truncate text-ink-2">
            {viewer.email}
          </Evidence>
        </div>

        <Link
          href="/console"
          className="inline-flex h-8 items-center rounded-[4px] border border-ice-dim bg-ice-bg px-3 text-[12px] font-medium text-ice transition-colors hover:bg-ice-deep"
        >
          Console
        </Link>
      </div>
    </header>
  );
}

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel milled overflow-hidden">
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
        <Legend>{title}</Legend>
        <div className="h-px flex-1 bg-hairline" />
        {right}
      </div>
      {children}
    </section>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-[12px] text-ink-3">{children}</p>;
}

function Tile({
  value,
  label,
  tone,
  sub,
}: {
  value: React.ReactNode;
  label: string;
  tone: 'ink' | 'ice' | 'seal' | 'hazard' | 'fault';
  sub: string;
}) {
  const tones = {
    ink: 'text-ink',
    ice: 'text-ice',
    seal: 'text-seal',
    hazard: 'text-hazard',
    fault: 'text-fault',
  } as const;
  return (
    <div className="panel milled p-3.5">
      <div className={cx('evidence text-[clamp(19px,2.2vw,26px)] leading-none font-medium', tones[tone])}>
        {value}
      </div>
      <div className="mt-2 text-[11px] leading-tight font-medium text-ink-2">{label}</div>
      <div className="mt-1 text-[10px] leading-snug text-ink-4">{sub}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

function age(from: string, now: Date | null): string {
  if (!now) return '—';
  const ms = now.getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

function magnitudeOf(d: Dossier): string | null {
  const m = d.magnitude;
  if (m.amount_minor !== 0) return formatMoney(Math.abs(m.amount_minor), m.currency);
  if (m.people > 0) return `${m.people.toLocaleString()} ${m.people === 1 ? 'person' : 'people'}`;
  if (m.records > 0) return `${m.records.toLocaleString()} records`;
  return null;
}

function QueueRow({ dossier, viewer, now }: { dossier: Dossier; viewer: Viewer; now: Date | null }) {
  const decision = openGate(dossier, viewer);
  const outstanding = sealsOutstanding(dossier);
  const signed = approversFor(dossier).length;
  const quorum = signed + outstanding;
  const magnitude = magnitudeOf(dossier);

  const open = decision.state === 'OPEN';
  const tone = open ? (decision.grant.irreversible ? 'hazard' : 'seal') : 'fault';

  return (
    <li className="border-b border-hairline px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'mt-[5px] size-1.5 shrink-0 rounded-full',
            tone === 'seal' ? 'bg-seal' : tone === 'hazard' ? 'bg-hazard' : 'bg-fault',
          )}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] leading-snug text-ink">{dossier.request}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Evidence size="xs" className="text-ink-3">
              {dossier.change_class}
            </Evidence>
            {magnitude ? (
              <Evidence size="xs" className={dossier.magnitude.people > 0 ? 'text-hazard' : 'text-ink-2'}>
                {magnitude}
              </Evidence>
            ) : null}
            {quorum > 1 ? (
              <span className="flex items-center gap-1" title={`${signed} of ${quorum} signatures`}>
                {Array.from({ length: quorum }, (_, i) => (
                  <span
                    key={i}
                    className={cx('h-1.5 w-3.5 rounded-[1px]', i < signed ? 'bg-seal' : 'bg-hairline-3')}
                  />
                ))}
                <span className="ml-0.5 text-[10px] text-ink-4">
                  {signed}/{quorum}
                </span>
              </span>
            ) : null}
          </div>

          <p className={cx('mt-1.5 text-[10.5px] leading-relaxed', open ? 'text-seal' : 'text-fault')}>
            {open
              ? decision.grant.final
                ? 'Ready — one signature applies it.'
                : `Countersign — ${outstanding} more approver required, and it cannot be the same person.`
              : decision.message}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <Evidence size="xs" className="block text-ink-2">
            {age(dossier.created_at, now)}
          </Evidence>
          <Evidence size="xs" className="mt-0.5 block text-ink-4">
            held
          </Evidence>
        </div>
      </div>
    </li>
  );
}

function DecidedRow({ dossier }: { dossier: Dossier }) {
  const rejected = dossier.approval.decision === 'rejected';
  const glass = dossier.signatures.some((s) => s.break_glass);

  return (
    <li className="border-b border-hairline px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'mt-[5px] size-1.5 shrink-0 rounded-full',
            glass ? 'bg-hazard' : rejected ? 'bg-fault' : 'bg-seal',
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] leading-snug text-ink">{dossier.request}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-3">
            <span>
              {rejected ? 'rejected' : 'applied'} by <span className="evidence text-ink-2">{dossier.approval.approver}</span>
            </span>
            {dossier.signatures.length > 1 ? (
              <span className="text-ink-4">{dossier.signatures.length} signatures</span>
            ) : null}
            {dossier.approval.at ? (
              <Evidence size="xs" className="text-ink-4">
                {new Date(dossier.approval.at).toLocaleDateString('en-GB')}
              </Evidence>
            ) : null}
          </div>
          {dossier.approval.reason ? (
            <p className="mt-1 truncate text-[10.5px] text-ink-4">{dossier.approval.reason}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {glass ? (
            <span className="evidence rounded-[3px] border border-hazard/40 bg-hazard-bg px-1.5 py-[3px] text-[9.5px] text-hazard">
              BREAK-GLASS
            </span>
          ) : null}
          {dossier.receipt ? (
            <a
              href={`/api/dossiers/${dossier.dossier_id}/receipt`}
              className="evidence text-[10px] text-ice transition-colors hover:underline"
              title="Download a detached receipt an auditor can verify offline"
            >
              receipt
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Right column panels                                                         */
/* -------------------------------------------------------------------------- */

function LedgerPanel({ chain, head }: { chain: ChainVerdict | null; head: string | null }) {
  const ok = chain?.ok ?? null;
  return (
    <Panel
      title="Ledger integrity"
      right={
        <Evidence size="xs" className={ok === null ? 'text-ink-4' : ok ? 'text-seal' : 'text-fault'}>
          {ok === null ? 'checking…' : ok ? 'intact' : `broken at #${chain!.brokenAt}`}
        </Evidence>
      }
    >
      <div className="px-4 py-3.5">
        <p className="text-[11.5px] leading-relaxed text-ink-2">
          {ok === null
            ? 'Re-hashing the sealed history.'
            : ok
              ? `${chain!.length} decided change${chain!.length === 1 ? '' : 's'}, each committing to the hash of the one before it. Verified in this browser, not taken on trust from the server.`
              : 'A decided record no longer hashes to the value it was sealed with. Everything after it is unverifiable.'}
        </p>

        {chain && chain.links.length > 0 ? (
          <ol className="mt-3 space-y-1">
            {chain.links.map((link) => (
              <li key={link.dossier_id} className="flex items-baseline gap-2">
                <span className={cx('evidence text-[9.5px]', link.ok ? 'text-ink-4' : 'text-fault')}>
                  #{link.seq}
                </span>
                <span className="evidence min-w-0 flex-1 truncate text-[10px] text-ink-3">{link.dossier_id}</span>
                <span className={cx('evidence text-[9.5px]', link.ok ? 'text-seal' : 'text-fault')}>
                  {link.ok ? 'ok' : link.fault}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="mt-3.5 border-t border-hairline pt-3">
          <Legend className="!text-[9px]">Head</Legend>
          <p className="evidence mt-1 text-[10px] leading-relaxed break-all text-ink-3">{head ?? '—'}</p>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-4">
            Keep it somewhere we cannot reach. Verify offline with{' '}
            <span className="evidence text-ink-3">npm run verify:ledger</span>.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function FreezePanel({ now }: { now: Date | null }) {
  const windows = useMemo(() => {
    if (!now) return [];
    return CHANGE_CLASSES.flatMap((cls) =>
      activeBlackouts(DEFAULT_POLICY, cls, now).map((w) => ({ cls, window: w })),
    );
  }, [now]);

  const declared = resolvedRules(DEFAULT_POLICY).filter((r) => r.rule.blackout.length > 0);

  return (
    <Panel
      title="Change freezes"
      right={
        <Evidence size="xs" className={windows.length > 0 ? 'text-hazard' : 'text-ink-4'}>
          {now === null ? '—' : windows.length > 0 ? `${windows.length} in effect` : 'none in effect'}
        </Evidence>
      }
    >
      <div className="px-4 py-3.5">
        {windows.length > 0 ? (
          <ul className="mb-3 space-y-2">
            {windows.map(({ cls, window }, i) => (
              <li key={`${cls}-${i}`} className="rounded-[4px] border border-hazard/35 bg-hazard-bg/50 px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Evidence size="xs" className="text-hazard">
                    {cls}
                  </Evidence>
                  <Evidence size="xs" className="text-ink-3">
                    {window.from}–{window.to}
                  </Evidence>
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-2">{window.reason}</p>
              </li>
            ))}
          </ul>
        ) : null}

        <Legend className="!text-[9px]">Declared</Legend>
        <ul className="mt-2 space-y-1.5">
          {declared.map(({ cls, rule }) => (
            <li key={cls} className="flex items-baseline gap-2 text-[10.5px]">
              <Evidence size="xs" className="text-ink-3">
                {CHANGE_CLASS_COPY[cls].title}
              </Evidence>
              <div className="h-px flex-1 bg-hairline" />
              <Evidence size="xs" className="text-ink-4">
                {rule.blackout.map((w) => `${w.from}–${w.to}`).join(', ')}
              </Evidence>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[10px] leading-relaxed text-ink-4">
          Erasure, money and access are never frozen. A freeze that blocks a statutory obligation trades a legal
          problem for an operational one.
        </p>
      </div>
    </Panel>
  );
}

function MixPanel({ byClass, total }: { byClass: Map<ChangeClass, number>; total: number }) {
  const rows = CHANGE_CLASSES.map((cls) => ({ cls, n: byClass.get(cls) ?? 0 })).filter((r) => r.n > 0);
  const max = Math.max(1, ...rows.map((r) => r.n));

  return (
    <Panel title="What flows through" right={<Evidence size="xs" dim>{total} total</Evidence>}>
      <div className="space-y-2.5 px-4 py-3.5">
        {rows.length === 0 ? (
          <p className="text-[11.5px] text-ink-3">Nothing has been opened yet.</p>
        ) : (
          rows.map(({ cls, n }) => {
            const rule = resolvedRules(DEFAULT_POLICY).find((r) => r.cls === cls)!.rule;
            return (
              <div key={cls}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] text-ink-2">{CHANGE_CLASS_COPY[cls].title}</span>
                  <Evidence size="xs" className="text-ink-3">
                    {n}
                  </Evidence>
                </div>
                <div className="meter mt-1.5">
                  <span
                    className={rule.requires === 'UNDO' ? 'bg-seal' : 'bg-hazard'}
                    style={{ width: `${Math.max(6, (n / max) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
        <p className="pt-1 text-[10px] leading-relaxed text-ink-4">
          <span className="text-seal">Green</span> classes must prove they can be undone.{' '}
          <span className="text-hazard">Amber</span> ones cannot be undone at all, and must prove their exact scope
          instead.
        </p>
      </div>
    </Panel>
  );
}

function BreakGlassPanel({ enabled, used }: { enabled: boolean; used: number }) {
  return (
    <Panel
      title="Break-glass"
      right={
        <Evidence size="xs" className={enabled ? 'text-hazard' : 'text-ink-4'}>
          {enabled ? 'armed' : 'off'}
        </Evidence>
      }
    >
      <div className="px-4 py-3.5">
        <p className="text-[11.5px] leading-relaxed text-ink-2">
          {enabled
            ? 'Enabled in this deployment. Every use is attributed, carries a written reason, and is sealed into the same ledger as everything else.'
            : 'Switched off. Two switches are required — the class must permit it in policy, and the deployment must set AIRLOCK_BREAK_GLASS=1.'}
        </p>
        <div className="mt-3 flex items-baseline justify-between border-t border-hairline pt-3">
          <Legend className="!text-[9px]">Used, all time</Legend>
          <Evidence size="sm" className={used > 0 ? 'text-hazard' : 'text-ink-2'}>
            {used}
          </Evidence>
        </div>
        <p className="mt-2.5 text-[10px] leading-relaxed text-ink-4">
          Break-glass does not open the gate — it cannot mint a grant. It records that a named human went around a
          sealed door, permanently. People do this anyway; a control plane that pretends otherwise only ensures there
          is no record of it.
        </p>
      </div>
    </Panel>
  );
}

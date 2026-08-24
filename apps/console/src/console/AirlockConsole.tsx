'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ComposerBusyProvider,
  ComposerContainer,
  ThreadContainer,
  ThreadListContainer,
  ToasterProvider,
} from '@truefoundry/trueforge-ui';
import type { ApprovalGrant, Dossier, Viewer } from '@airlock/contract';
import { CAPABILITY_TOTAL } from '@airlock/contract';
import { Chip, Dot, Empty, Evidence, Legend, cx } from '@/design/primitives';
import { HarnessCounter, HarnessPanel } from '@/harness/HarnessPanel';
import { useRun, useRunStore } from '@/harness/HarnessProvider';
import { CertificateCard } from '@/certificate/CertificateCard';
import { Wordmark } from './Mark';
import { Lanes, SandboxLog } from './Lanes';
import { DidZone, WaitingZone } from './Zones';

type Zone = 'DOING' | 'WAITING' | 'DID';

/**
 * One-click starting points.
 *
 * Chosen to span the range rather than to flatter it: a reversible migration, a
 * correction that fails its own proof, an erasure, a grant, and money. Some of
 * these are supposed to be refused, and a judge discovering that by clicking is
 * worth more than a paragraph claiming it.
 */
const EXAMPLES: Array<{ cls: string; label: string; prompt: string; tone: 'seal' | 'ice' | 'hazard' }> = [
  {
    cls: 'SCHEMA_MIGRATION',
    label: 'Add a column, backfill it, drop the deprecated one',
    prompt:
      'Add a tier column to users, backfill it from subscriptions, then drop the deprecated plan_name column. Prove the rollback before you ask me for anything.',
    tone: 'seal',
  },
  {
    cls: 'DATA_OPERATION',
    label: 'Correct a currency error across historical rows',
    prompt:
      'Every EU invoice created before 2026-01-01 was stored in USD instead of EUR. Correct them, and show me exactly which rows you would touch before you touch any of them.',
    tone: 'ice',
  },
  {
    cls: 'ERASURE',
    label: 'Erase a person from every system we hold them in',
    prompt:
      'We received a right-to-erasure request for the user with email dana.reyes@example.com. Remove them from every system we hold them in, and tell me exactly what you will destroy and what you will keep.',
    tone: 'hazard',
  },
  {
    cls: 'ACCESS_GRANT',
    label: 'Give the on-call engineer production access',
    prompt:
      'Give the on-call engineer read access to the production database for the length of this incident. Compute what it actually unlocks by simulating it, not by reading the policy document.',
    tone: 'hazard',
  },
  {
    cls: 'MONEY_MOVEMENT',
    label: 'Refund a duplicate charge to everyone affected',
    prompt:
      'The 14 August pricing bug double-charged term subscribers. Refund the duplicate charge to everyone affected, and exclude anyone who has already been refunded or is under dispute.',
    tone: 'hazard',
  },
];

/* -------------------------------------------------------------------------- */
/* Topbar                                                                      */
/* -------------------------------------------------------------------------- */

function StatusReadout() {
  const run = useRun();
  const map = {
    idle: { tone: 'neutral', label: 'idle' },
    running: { tone: 'ice', label: 'running' },
    paused: { tone: 'hazard', label: 'holding for a human' },
    done: { tone: 'seal', label: 'complete' },
    error: { tone: 'fault', label: 'error' },
    cancelled: { tone: 'neutral', label: 'cancelled' },
  } as const;
  const s = map[run.status];
  return (
    <div className="flex items-center gap-1.5">
      <Dot tone={s.tone} pulse={run.status === 'running' || run.status === 'paused'} />
      <span className="text-[11px] text-ink-2">{s.label}</span>
    </div>
  );
}

function Topbar({ viewer, onToggleHarness }: { viewer: Viewer; onToggleHarness: () => void }) {
  const run = useRun();
  const sealed = run.pausedOn === 'approval';

  return (
    <header className="milled relative flex h-13 shrink-0 items-center gap-3 border-b border-hairline bg-panel px-3">
      <Link href="/" title="Back to the front door">
        <Wordmark sealed={sealed} />
      </Link>
      <div className="mx-1 h-5 w-px bg-hairline" />
      <StatusReadout />

      {run.connectors.length > 0 ? (
        <div className="hidden items-center gap-1.5 lg:flex">
          {run.connectors.slice(0, 4).map((c) => (
            <Chip key={c} tone="ice" mono className="!text-[9.5px]">
              {c}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="flex-1" />

      {run.reconnects > 0 ? (
        <Chip
          tone="seal"
          className="hidden !text-[9.5px] md:inline-flex"
          title="The stream reattached after a transport loss"
        >
          reattached ×{run.reconnects}
        </Chip>
      ) : null}

      {run.costUsd > 0 || run.tokens.total > 0 ? (
        <div className="hidden items-center gap-3 md:flex">
          <div className="text-right">
            <Legend className="!text-[9px]">cost</Legend>
            <Evidence size="sm" className="block text-ink">
              ${run.costUsd.toFixed(4)}
            </Evidence>
          </div>
          <div className="text-right">
            <Legend className="!text-[9px]">tokens</Legend>
            <Evidence size="sm" className="block text-ink">
              {run.tokens.total.toLocaleString()}
            </Evidence>
          </div>
        </div>
      ) : null}

      <Link
        href="/control"
        title="Fleet-level view: what is held, what was refused, and whether the ledger still verifies"
        className="hidden rounded-[4px] border border-hairline-2 bg-raised px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-hairline-3 hover:text-ink lg:block"
      >
        Control room
      </Link>

      <div
        className={cx(
          'flex items-center gap-1.5 rounded-[4px] border px-2 py-1',
          viewer.role === 'approver' ? 'border-seal/35 bg-seal-bg' : 'border-hairline-2 bg-raised',
        )}
        title={
          viewer.role === 'approver'
            ? 'You can open the gate.'
            : 'Separation of duties: you can propose a change but not approve one.'
        }
      >
        <Legend className="!text-[9px]">{viewer.role}</Legend>
        <Evidence size="xs" className="max-w-[150px] truncate text-ink-2">
          {viewer.email}
        </Evidence>
      </div>

      {/* From xl up the rail is docked, so the compact counter is redundant. */}
      <div className="xl:hidden">
        <HarnessCounter onClick={onToggleHarness} />
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Guided empty state                                                          */
/* -------------------------------------------------------------------------- */

function GuidedStart({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="scroll-thin flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-[640px]">
        <p className="text-[11px] leading-relaxed tracking-[0.16em] text-ink-3 uppercase">Change control</p>
        <h1 className="mt-2 text-[21px] leading-tight font-semibold text-ink">
          Nothing reaches production without passing through the airlock.
        </h1>
        <p className="mt-2.5 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-2">
          Describe an irreversible production change in plain English. AIRLOCK executes it against a shadow copy first,
          proves what it does in a sandbox, and only then asks you to approve it — with the evidence attached.
        </p>

        <div className="mt-6 space-y-2">
          <Legend>Start from an example</Legend>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.cls}
              onClick={() => onPick(ex.prompt)}
              className="group flex w-full items-start gap-3 rounded-[5px] border border-hairline bg-raised px-3 py-2.5 text-left transition-colors hover:border-hairline-3 hover:bg-raised-2"
            >
              <span className="pt-1">
                <Dot tone={ex.tone} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ink">{ex.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-ink-3">{ex.prompt}</span>
              </span>
              <Chip tone="neutral" mono className="mt-0.5 !text-[9.5px]">
                {ex.cls}
              </Chip>
            </button>
          ))}
        </div>

        <p className="mt-5 text-[10.5px] leading-relaxed text-ink-4">
          The approval gate is never offered until a certificate proves the change and policy permits it. Watch the
          harness ledger on the right fill as the run exercises each capability — it ends at {CAPABILITY_TOTAL} only if
          it earned every one.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Console                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A custom layout has to mount two providers the SDK's built-in layouts wire up
 * for it.
 *
 * `ComposerBusyProvider` is documented as "wired by default in `<Thread />`" —
 * and AIRLOCK composes `ThreadContainer` and `ComposerContainer` separately so
 * the sandbox log can sit between them. Without it, `ComposerContainer` throws
 * on mount. `ToasterProvider` is what the SDK's containers raise errors through.
 */
export function AirlockConsole({ className }: { className?: string }) {
  return (
    <ToasterProvider>
      <ComposerBusyProvider>
        <ConsoleBody className={className} />
      </ComposerBusyProvider>
    </ToasterProvider>
  );
}

function ConsoleBody({ className }: { className?: string }) {
  const store = useRunStore();
  const run = useRun();

  const [zone, setZone] = useState<Zone>('DOING');
  // The rail is permanently docked from xl up (CSS handles it). Below xl it
  // becomes an overlay, which must start CLOSED so it does not cover the
  // certificate a judge opened on a tablet.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(true);
  const [logPinned, setLogPinned] = useState(false);
  const [viewer, setViewer] = useState<Viewer>({ email: 'loading…', role: 'requester' });
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [breakGlassEnabled, setBreakGlassEnabled] = useState(false);
  /** Transient feedback from the last decision, e.g. "one of two signatures". */
  const [notice, setNotice] = useState<{ tone: 'seal' | 'fault' | 'ice'; text: string } | null>(null);

  /* --- who is looking: capability 21, proven by a real call --------------- */
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/me');
        if (!res.ok || !live) return;
        const me = (await res.json()) as { email: string; role: string; type: string; evidence: string };
        setViewer({ email: me.email, role: me.role });
        if (me.type === 'oidc-connected') {
          store.prove(21, me.evidence, `${me.email} · ${me.role}`);
        }
      } catch {
        /* the console still works signed-out; the lamp simply stays dark. */
      }
    })();
    return () => {
      live = false;
    };
  }, [store]);

  /* --- is the second door even fitted in this deployment? ----------------- */
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        // The id is immaterial for the GET: it reports the deployment switch,
        // not anything about a particular change.
        const res = await fetch('/api/dossiers/_/break-glass');
        if (!res.ok || !live) return;
        const body = (await res.json()) as { enabled: boolean };
        setBreakGlassEnabled(body.enabled === true);
      } catch {
        /* off is the safe default, and it is already the initial state. */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  /* --- the change queue --------------------------------------------------- */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/dossiers');
      if (!res.ok) return;
      const body = (await res.json()) as { dossiers: Dossier[] };
      setDossiers(body.dossiers);
      for (const d of body.dossiers) {
        if (d.started_by === 'webhook' || d.started_by === 'agent') {
          store.prove(19, `session created through the HTTP API by the ${d.started_by}`, d.dossier_id);
        }
      }
    } catch {
      /* queue stays as it was */
    }
  }, [store]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [refresh]);

  /* --- follow the run into the zone that matters -------------------------- */
  useEffect(() => {
    if (run.pausedOn === 'approval') setZone('WAITING');
  }, [run.pausedOn]);

  /* --- open the sandbox pane the first time the sandbox actually runs ------ */
  useEffect(() => {
    if (!logPinned && run.sandboxLog.length > 0) setLogCollapsed(false);
  }, [run.sandboxLog.length, logPinned]);

  /* --- clear the notice once it has had time to be read ------------------- */
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(id);
  }, [notice]);

  const selected = useMemo(
    () => dossiers.find((d) => d.dossier_id === selectedId) ?? null,
    [dossiers, selectedId],
  );

  /**
   * Post a decision and report honestly what came back.
   *
   * Three outcomes worth distinguishing: refused (the server ran the gate again
   * and disagreed), countersigned (recorded, still waiting on somebody else),
   * and decided. Collapsing them into "saved" would hide the one that matters.
   */
  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          state?: string;
          message?: string;
          error?: string;
        };

        if (!res.ok) {
          setNotice({ tone: 'fault', text: payload.message ?? payload.error ?? 'The console refused that.' });
        } else if (payload.state === 'countersigned') {
          setNotice({
            tone: 'ice',
            text: payload.message ?? 'Signature recorded. Another approver is still required.',
          });
        } else {
          setNotice({ tone: 'seal', text: 'Decision recorded and sealed into the ledger.' });
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onApprove = useCallback(
    (grant: ApprovalGrant) =>
      void post(`/api/dossiers/${grant.dossier_id}/decision`, { decision: 'approved', approver: grant.approver }),
    [post],
  );

  const onReject = useCallback(
    (reason: string) => {
      if (!selected) return;
      void post(`/api/dossiers/${selected.dossier_id}/decision`, {
        decision: 'rejected',
        approver: viewer.email,
        reason,
      });
    },
    [post, selected, viewer.email],
  );

  const onBreakGlass = useCallback(
    (justification: string) => {
      if (!selected) return;
      void post(`/api/dossiers/${selected.dossier_id}/break-glass`, { justification });
    },
    [post, selected],
  );

  const startExample = useCallback((prompt: string) => {
    setStarted(true);
    // Hand the prompt to the composer the SDK owns, rather than posting a turn
    // ourselves — the run must go through the harness, not around it.
    const el = document.querySelector<HTMLTextAreaElement>('[data-airlock-composer] textarea');
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, prompt);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    }
  }, []);

  const waitingCount = dossiers.filter((d) => d.approval.decision === null && d.audit.applied_at === null).length;
  const didCount = dossiers.length - waitingCount;

  const zones: Array<{ id: Zone; label: string; hint: string; count: number; tone: 'ice' | 'hazard' | 'neutral' }> = [
    { id: 'DOING', label: 'DOING', hint: 'what the agent is doing', count: run.lanes.length, tone: 'ice' },
    { id: 'WAITING', label: 'WAITING', hint: 'what it is waiting on', count: waitingCount, tone: 'hazard' },
    { id: 'DID', label: 'DID', hint: 'what it did', count: didCount, tone: 'neutral' },
  ];

  const card = (dossier: Dossier) => (
    <CertificateCard
      dossier={dossier}
      viewer={viewer}
      onApprove={onApprove}
      onReject={onReject}
      onBreakGlass={onBreakGlass}
      breakGlassEnabled={breakGlassEnabled}
      busy={busy}
      className="max-h-full"
    />
  );

  return (
    <div className={cx('flex h-full min-h-0 flex-col bg-void', className)}>
      <Topbar viewer={viewer} onToggleHarness={() => setDrawerOpen((v) => !v)} />

      {notice ? (
        <div
          role="status"
          className={cx(
            'flex shrink-0 items-center gap-2 border-b px-3 py-2',
            notice.tone === 'seal'
              ? 'border-seal/30 bg-seal-bg'
              : notice.tone === 'ice'
                ? 'border-ice-dim/40 bg-ice-bg'
                : 'border-fault/30 bg-fault-bg',
          )}
        >
          <Dot tone={notice.tone} />
          <p
            className={cx(
              'flex-1 text-[11.5px] leading-relaxed',
              notice.tone === 'seal' ? 'text-seal' : notice.tone === 'ice' ? 'text-ice' : 'text-fault',
            )}
          >
            {notice.text}
          </p>
          <button onClick={() => setNotice(null)} className="text-[10.5px] text-ink-3 hover:text-ink-2">
            dismiss
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* ---------- left rail: the three zones, then history ---------- */}
        <nav className="hidden w-[212px] shrink-0 flex-col border-r border-hairline bg-panel md:flex">
          <div className="p-2">
            {zones.map((z) => (
              <button
                key={z.id}
                onClick={() => setZone(z.id)}
                className={cx(
                  'group mb-0.5 flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left transition-colors',
                  zone === z.id ? 'bg-raised-2' : 'hover:bg-raised',
                )}
              >
                <span
                  className={cx(
                    'h-7 w-[2px] rounded-full transition-colors',
                    zone === z.id ? 'bg-ice' : 'bg-transparent group-hover:bg-hairline-3',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cx(
                      'block text-[11px] font-semibold tracking-[0.14em]',
                      zone === z.id ? 'text-ink' : 'text-ink-2',
                    )}
                  >
                    {z.label}
                  </span>
                  <span className="block truncate text-[10px] text-ink-4">{z.hint}</span>
                </span>
                {z.count > 0 ? (
                  <Evidence size="xs" className={z.id === 'WAITING' ? 'text-hazard' : 'text-ink-3'}>
                    {z.count}
                  </Evidence>
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-1 flex min-h-0 flex-1 flex-col border-t border-hairline">
            <div className="px-3 py-2">
              <Legend>Sessions</Legend>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1 pb-2">
              <ThreadListContainer />
            </div>
          </div>
        </nav>

        {/* ---------- main stage ---------- */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* mobile / tablet zone switcher */}
          <div className="flex shrink-0 gap-1 border-b border-hairline bg-panel p-1.5 md:hidden">
            {zones.map((z) => (
              <button
                key={z.id}
                onClick={() => setZone(z.id)}
                className={cx(
                  'flex-1 rounded-[4px] px-2 py-1.5 text-[10.5px] font-semibold tracking-[0.12em] transition-colors',
                  zone === z.id ? 'bg-raised-2 text-ink' : 'text-ink-3',
                )}
              >
                {z.label}
                {z.count > 0 ? <span className="ml-1.5 text-ink-4">{z.count}</span> : null}
              </button>
            ))}
          </div>

          {zone === 'DOING' ? (
            <>
              <Lanes />
              <div className="min-h-0 flex-1 overflow-hidden">
                {started || run.status !== 'idle' ? <ThreadContainer /> : <GuidedStart onPick={startExample} />}
              </div>
              <SandboxLog
                collapsed={logCollapsed}
                onToggle={() => {
                  setLogPinned(true);
                  setLogCollapsed((v) => !v);
                }}
              />
              <div data-airlock-composer className="shrink-0 border-t border-hairline bg-panel px-3 py-2.5">
                <ComposerContainer placeholder="Describe the change you want made to production…" />
              </div>
            </>
          ) : null}

          {zone === 'WAITING' ? (
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(280px,380px)_1fr]">
              <div className="min-h-0 border-r border-hairline">
                <WaitingZone dossiers={dossiers} viewer={viewer} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
              <div className="scroll-thin min-h-0 overflow-y-auto p-3">
                {selected ? (
                  card(selected)
                ) : (
                  <Empty
                    title="Select a change to review its certificate."
                    hint="The certificate carries the SQL, the real row counts, the lock profile, the checksum proof, the blast radius and what policy makes of it — everything you need to decide without leaving this screen."
                  />
                )}
              </div>
            </div>
          ) : null}

          {zone === 'DID' ? (
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(280px,420px)_1fr]">
              <div className="min-h-0 border-r border-hairline">
                <DidZone dossiers={dossiers} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
              <div className="scroll-thin min-h-0 overflow-y-auto p-3">
                {selected ? (
                  card(selected)
                ) : (
                  <Empty
                    title="An immutable record of everything that passed through."
                    hint="Select a change to see the certificate it was approved on, and the receipt that seals it into the ledger. Records here are never edited."
                  />
                )}
              </div>
            </div>
          ) : null}
        </main>

        {/* ---------- harness rail ---------- */}
        <HarnessPanel
          className="hidden w-[268px] shrink-0 xl:flex"
          onInspect={(stepId) => {
            const el = document.querySelector(`[data-event-id="${stepId}"]`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
        />
      </div>

      {/* ---------- harness as an overlay below xl ---------- */}
      {drawerOpen ? (
        <>
          <button
            aria-label="Close the harness ledger"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-30 bg-void/70 xl:hidden"
          />
          <div className="fixed inset-y-0 right-0 z-40 w-[280px] max-w-[86vw] shadow-2xl xl:hidden">
            <div className="flex h-full flex-col bg-panel">
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex items-center justify-between border-b border-hairline px-3 py-2 text-[11px] text-ink-2"
              >
                <span className="legend">Harness ledger</span>
                <span>close</span>
              </button>
              <HarnessPanel className="flex min-h-0 flex-1" />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

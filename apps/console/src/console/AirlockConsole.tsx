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
import type { ApprovalGrant, Dossier, TurnFailure, Viewer } from '@airlock/contract';
import { CAPABILITY_TOTAL, describeFailure, formatUsd, isRetryable } from '@airlock/contract';
import { Chip, Dot, Empty, Evidence, Legend, cx } from '@/design/primitives';
import { HarnessCounter, HarnessPanel } from '@/harness/HarnessPanel';
import { useRun, useRunControls, useRunStore } from '@/harness/HarnessProvider';
import { CertificateCard } from '@/certificate/CertificateCard';
import { Wordmark } from './Mark';
import { Lanes, SandboxLog } from './Lanes';
import { LiveActivity, useActivity } from './LiveActivity';
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

  // A cancelled run says *why*. "Cancelled" alone leaves an operator wondering
  // whether a colleague stopped it or a ceiling did, and those want different
  // responses. A failed run says the same, for the same reason: "error" on its
  // own sends people to the container logs to find out what the console was
  // already holding.
  const label =
    run.status === 'cancelled' && run.stopCause === 'budget'
      ? 'stopped — over budget'
      : run.status === 'error' && run.failure
        ? SHORT_FAILURE[run.failure.kind]
        : s.label;

  return (
    <div className="flex items-center gap-1.5" title={run.failure?.message ?? undefined}>
      <Dot tone={s.tone} pulse={run.status === 'running' || run.status === 'paused'} />
      <span className="text-[11px] text-ink-2">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The failure banner                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Put the composer back the way it was, with `prompt` in it.
 *
 * The turn has to go through the harness rather than around it, so the console
 * never posts one itself — it hands the text to the composer the SDK owns and
 * lets the operator press send. Used by both the example cards and the retry
 * button, because they want exactly the same thing.
 */
function fillComposer(prompt: string) {
  const el = document.querySelector<HTMLTextAreaElement>('[data-airlock-composer] textarea');
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, prompt);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
}

/**
 * The topbar has room for two words, and `describeFailure` writes a sentence.
 *
 * Keyed off the same `FailureKind` so the chip and the banner can never
 * disagree about what happened — only about how much room they have to say it.
 */
const SHORT_FAILURE: Record<TurnFailure['kind'], string> = {
  RATE_LIMITED: 'error — throttled',
  MODEL_AUTH: 'error — model key',
  CONTEXT_OVERFLOW: 'error — context full',
  PROVIDER: 'error — provider',
  UNKNOWN: 'error',
};

/**
 * The countdown a provider asked for.
 *
 * A 429 that names a wait is naming the condition under which a retry will
 * work, so the button is held closed until it passes. Letting somebody press
 * retry into a live rate limit produces a second identical failure and teaches
 * them the button is broken.
 */
function useRetryCountdown(failure: TurnFailure | null, since: string | null): number {
  const [left, setLeft] = useState(0);
  const wait = failure?.retryAfterSeconds ?? null;

  useEffect(() => {
    if (!wait || !since) {
      setLeft(0);
      return;
    }
    // Counted from when the harness reported it, not from when this component
    // mounted — a banner re-rendered five seconds later must not restart the
    // clock and make the operator wait twice.
    const ready = new Date(since).getTime() + wait * 1000;
    const tick = () => setLeft(Math.max(0, Math.ceil((ready - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [since, wait]);

  return left;
}

/**
 * What the harness said, and what to do about it.
 *
 * This is the screen the console was missing. A turn killed by a provider rate
 * limit arrives as `turn.done` carrying the provider's own sentence; before
 * this the console read the status, dropped the sentence, and left a red dot
 * above a transcript that simply stopped mid-run. An operator's only remaining
 * move was to guess, or to read the harness container's logs.
 *
 * The provider's words are shown verbatim under our one line about what to do.
 * They are the string that can be pasted into a dashboard or a ticket, and a
 * console that paraphrases them is a console that has to be worked around.
 */
function RunFailureBanner({
  failure,
  at,
  onRetry,
  onDismiss,
}: {
  failure: TurnFailure;
  /** When the harness reported it — the origin of the retry countdown. */
  at: string | null;
  onRetry: (() => void) | null;
  onDismiss: () => void;
}) {
  const waitLeft = useRetryCountdown(failure, at);
  const held = waitLeft > 0;

  return (
    <div
      role="alert"
      data-airlock-failure={failure.kind}
      className="flex shrink-0 items-start gap-2.5 border-b border-fault/30 bg-fault-bg px-3 py-2.5"
    >
      <span className="pt-[3px]">
        <Dot tone="fault" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] leading-relaxed font-medium text-fault">
          {describeFailure(failure)}
        </p>
        {/*
         * `break-words` and not `truncate`: a provider message names the
         * organisation, the limit and the overage, and the numbers are the
         * useful part. Clipping them to one line saves nothing worth saving.
         */}
        <Evidence size="xs" className="mt-1 block break-words text-ink-3">
          {failure.message}
        </Evidence>
        {/*
         * The sentence that stops an operator escalating a throttle.
         *
         * A red banner over a change-control console reads as "the change went
         * wrong" unless it says otherwise, and here nothing about the change
         * went wrong at all — the model provider ran out of tokens per minute.
         * The gate never opened, so there is nothing to unwind.
         */}
        {failure.kind !== 'UNKNOWN' ? (
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-4">
            Nothing reached production and no approval was affected — the run stopped before the gate.
          </p>
        ) : null}
      </div>

      {onRetry ? (
        <button
          onClick={onRetry}
          disabled={held}
          title={
            held
              ? `The provider asked for ${failure.retryAfterSeconds}s. Retrying sooner produces the same failure.`
              : 'Put the request back in the composer so you can send it again.'
          }
          className={cx(
            'mt-[1px] shrink-0 rounded-[4px] border px-2 py-1 text-[10.5px] font-semibold tracking-[0.08em] transition-colors',
            held
              ? 'cursor-not-allowed border-hairline-2 bg-raised-2 text-ink-4'
              : 'border-fault/45 bg-raised text-fault hover:brightness-125',
          )}
        >
          {held ? `RETRY IN ${waitLeft}s` : 'RETRY'}
        </button>
      ) : null}

      <button
        onClick={onDismiss}
        className="mt-[3px] shrink-0 text-[10.5px] text-ink-3 hover:text-ink-2"
      >
        dismiss
      </button>
    </div>
  );
}

/**
 * The run budget.
 *
 * Shown from the moment a run starts spending, not only once it is in trouble —
 * a meter that appears when you are already over is an alarm, and this is meant
 * to be a gauge. Goes amber at the warning threshold and red at the ceiling,
 * using the one alarm colour the design system permits.
 *
 * A budget set to observe rather than enforce is labelled as such. Rendering
 * the two identically would let a team believe they had a cap when what they
 * had was a number.
 */
function BudgetReadout() {
  const run = useRun();
  const store = useRunStore();

  const verdict = store.budgetVerdict();
  if (verdict.state === 'UNCAPPED') return null;
  if (run.costUsd === 0 && run.tokens.total === 0) return null;

  const tone = verdict.state === 'EXCEEDED' ? 'fault' : verdict.state === 'WARNING' ? 'hazard' : 'neutral';
  const advisory = verdict.state === 'EXCEEDED' && !verdict.shouldStop;

  return (
    <Chip
      tone={tone}
      mono
      className="!text-[9.5px]"
      title={`${verdict.message}${advisory ? ' This budget observes rather than enforces.' : ''}`}
    >
      {formatUsd(run.costUsd)}
      <span className="text-ink-4">/</span>
      {Math.round(verdict.fraction * 100)}%
      {advisory ? <span className="text-ink-3">observe</span> : null}
    </Chip>
  );
}

/**
 * The kill control.
 *
 * The brief AIRLOCK answers names three failures: the agent cannot reach your
 * tools, cannot run its own code safely, and cannot be stopped before it does
 * damage. An approval gate covers the third only in the sense that it stops a
 * change before it starts. This is the part that stops one already running.
 *
 * It is deliberately the only red control in the console. It is present only
 * while something is genuinely in flight — a stop button on an idle run is
 * furniture, and furniture is what people learn to ignore.
 */
function AbortControl() {
  const run = useRun();
  const controls = useRunControls();

  const running = run.status === 'running' || run.status === 'paused';
  if (!running || !controls) return null;

  return (
    <button
      onClick={() => void controls.abort()}
      disabled={run.aborting}
      title="Cancel the turn in flight. The harness peers the cancellation to whichever replica is doing the work."
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-[4px] border px-2.5 text-[11.5px] font-semibold tracking-[0.08em] transition-colors',
        run.aborting
          ? 'cursor-wait border-hairline-2 bg-raised-2 text-ink-3'
          : 'border-fault/55 bg-fault-bg text-fault hover:brightness-125',
      )}
    >
      <span
        aria-hidden
        className={cx('size-2 rounded-[1px]', run.aborting ? 'bg-ink-3 breathe' : 'bg-fault')}
      />
      {run.aborting ? 'STOPPING…' : 'ABORT'}
    </button>
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
      <AbortControl />
      <BudgetReadout />

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
  /**
   * The failure the operator has already read and closed, keyed by its
   * timestamp. Keyed rather than boolean so a *second* failure re-opens the
   * banner instead of inheriting the first one's dismissal — two rate limits in
   * a row are two facts, and the second one silently hidden is the bug this
   * whole banner exists to fix.
   */
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);

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

  /*
   * What the harness is doing, for runs this browser did not start.
   *
   * Polled on the same cadence as the change queue so the two panels cannot
   * disagree about whether something is happening.
   */
  const activity = useActivity();

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

  /**
   * Take an applied change back.
   *
   * Posted rather than decided here, because the window is the server's to
   * judge: it re-derives it from when the change landed, on its own clock, and
   * refuses a press that arrives late however much time the countdown appeared
   * to have left.
   */
  const onUndo = useCallback(
    (reason: string) => {
      if (!selected) return;
      void post(`/api/dossiers/${selected.dossier_id}/undo`, { reason });
    },
    [post, selected],
  );

  /**
   * Dismiss injection findings.
   *
   * Posted rather than decided here: the server checks the role and the reason
   * length itself, so a client that skips the textarea gets the same refusal
   * the UI would have given it.
   */
  const onClearInjection = useCallback(
    (reason: string) => {
      if (!selected) return;
      void post(`/api/dossiers/${selected.dossier_id}/clear-injection`, { reason });
    },
    [post, selected],
  );

  const startExample = useCallback((prompt: string) => {
    setStarted(true);
    // Hand the prompt to the composer the SDK owns, rather than posting a turn
    // ourselves — the run must go through the harness, not around it.
    fillComposer(prompt);
  }, []);

  /**
   * Offer the failed request back.
   *
   * Only for failures a retry could actually survive, and only when the console
   * still holds the words the operator used. Everything else gets the banner
   * without a button, which is the honest shape: there is something to read and
   * nothing to press.
   */
  const onRetry = useMemo(() => {
    if (!run.failure || !isRetryable(run.failure) || !run.prompt) return null;
    const prompt = run.prompt;
    return () => {
      setStarted(true);
      fillComposer(prompt);
    };
  }, [run.failure, run.prompt]);

  const waitingCount = dossiers.filter((d) => d.approval.decision === null && d.audit.applied_at === null).length;
  const didCount = dossiers.length - waitingCount;

  const zones: Array<{ id: Zone; label: string; hint: string; count: number; tone: 'ice' | 'hazard' | 'neutral' }> = [
    {
      id: 'DOING',
      label: 'DOING',
      hint: 'what the agent is doing',
      /*
       * Lanes when this tab is driving the run, otherwise the harness's own
       * count. Reading only `run.lanes` is why this tab showed no number at
       * all while the agent was demonstrably working: the lanes belong to a
       * turn posted from here, and the runs that matter are not.
       */
      count: run.lanes.length > 0 ? run.lanes.length : (activity?.runs[0]?.steps.length ?? 0),
      tone: 'ice',
    },
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
      onUndo={onUndo}
      onClearInjection={onClearInjection}
      breakGlassEnabled={breakGlassEnabled}
      busy={busy}
      className="max-h-full"
    />
  );

  return (
    <div className={cx('flex h-full min-h-0 flex-col bg-void', className)}>
      <Topbar viewer={viewer} onToggleHarness={() => setDrawerOpen((v) => !v)} />

      {run.failure && run.failureAt !== dismissedFailure ? (
        <RunFailureBanner
          failure={run.failure}
          at={run.failureAt}
          onRetry={onRetry}
          onDismiss={() => setDismissedFailure(run.failureAt)}
        />
      ) : null}

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
                {/*
                 * Three states, in order of who is driving.
                 *
                 * A turn posted from this tab streams through the SDK, so the
                 * transcript is the truthful view. Otherwise the interesting
                 * runs are the ones nobody here started — webhook, schedule,
                 * the HTTP API — and those are read back from the harness.
                 * GuidedStart is the last resort, for a harness with nothing on
                 * it at all, because offering somebody a prompt to type is the
                 * wrong first answer in a product about not typing prompts.
                 */}
                {started || run.status !== 'idle' ? (
                  <ThreadContainer />
                ) : activity && activity.runs.length > 0 ? (
                  <LiveActivity feed={activity} />
                ) : (
                  <GuidedStart onPick={startExample} />
                )}
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

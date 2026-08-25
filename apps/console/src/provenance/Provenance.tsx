'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { GRADE_COPY, traceClaim, type ClaimKey, type Dossier, type Grade, type Trace } from '@airlock/contract';
import { Chip, Evidence, Legend, cx } from '@/design/primitives';

/**
 * Provenance.
 *
 * A change dossier is dense with figures, and on most dashboards they are all
 * rendered identically — same weight, same colour, same implied authority. That
 * is the problem this exists to fix, because those figures are emphatically not
 * equally well founded. A checksum was *measured*, by a sandbox, at a recorded
 * instant. A record count was very often simply *asserted* by the agent in the
 * text of its own dossier. Both look like evidence. One is.
 *
 * So every traced figure carries a grade, and pressing it says where the number
 * came from. For a measured one, that includes the harness event behind it and
 * a control that scrolls the sandbox log to the line it was produced from.
 *
 * The rule that makes this worth having, and it is the same rule the capability
 * lamps follow: **an unsourced claim says it is unsourced.** It would have been
 * trivial to default to "derived from the dossier" and have every number look
 * accounted for. A provenance system that never says "nothing backs this" is
 * decoration with extra steps.
 */

/* -------------------------------------------------------------------------- */
/* Jumping to the log                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Scroll the sandbox log to the line a claim came from, and flash it.
 *
 * Deliberately a DOM query rather than more state threaded through four
 * components: the log is a live tail owned by the run store, and the anchor is
 * an id both it and the harness ledger already carry.
 *
 * Returns false when the line is not on screen, which the caller reports rather
 * than swallowing. That happens legitimately — the log keeps the last 400 lines
 * and a long run will have dropped the one you want — and "nothing happened
 * when I clicked" is a much worse answer than "that line has scrolled out of
 * the buffer".
 */
export function jumpToStep(stepId: string): boolean {
  if (typeof document === 'undefined') return false;

  const target = document.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(stepId)}"]`);
  if (!target) return false;

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.setAttribute('data-flash', 'true');
  setTimeout(() => target.removeAttribute('data-flash'), 1400);
  return true;
}

/* -------------------------------------------------------------------------- */
/* The inspector                                                               */
/* -------------------------------------------------------------------------- */

interface ProvenanceApi {
  active: ClaimKey | null;
  inspect: (claim: ClaimKey) => void;
  close: () => void;
}

const Ctx = createContext<ProvenanceApi | null>(null);

/**
 * One inspector per card, rather than a popover per figure.
 *
 * Popovers anchored to inline values inside a scrolling column need position
 * maths that is wrong at some window width on some day. A single panel that
 * every traced figure opens is both simpler and better: it always lands in the
 * same place, so the second thing you inspect is where you already know to
 * look.
 */
export function ProvenanceProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ClaimKey | null>(null);
  const inspect = useCallback((claim: ClaimKey) => setActive((cur) => (cur === claim ? null : claim)), []);
  const close = useCallback(() => setActive(null), []);
  return <Ctx.Provider value={{ active, inspect, close }}>{children}</Ctx.Provider>;
}

function useProvenance(): ProvenanceApi | null {
  return useContext(Ctx);
}

const GRADE_TONE: Record<Grade, 'seal' | 'ice' | 'hazard' | 'neutral'> = {
  MEASURED: 'seal',
  COMPUTED: 'ice',
  DECLARED: 'hazard',
  UNSOURCED: 'neutral',
};

/**
 * A figure you can interrogate.
 *
 * Rendered with a dotted underline — the typographic convention for "there is
 * more behind this" — and a grade marker whose colour is the one thing that
 * distinguishes a measured number from an asserted one at a glance.
 *
 * Falls back to plain text outside a provider, so a traced value dropped into
 * the landing page or a test renders correctly instead of throwing.
 */
export function Traced({
  dossier,
  claim,
  children,
  className,
}: {
  dossier: Dossier;
  claim: ClaimKey;
  children: ReactNode;
  className?: string;
}) {
  const api = useProvenance();
  const trace = traceClaim(dossier, claim);

  if (!api) return <>{children}</>;

  const on = api.active === claim;

  return (
    <button
      type="button"
      onClick={() => api.inspect(claim)}
      aria-expanded={on}
      title={`${trace.label} — ${GRADE_COPY[trace.grade]}`}
      className={cx(
        'group inline-flex items-baseline gap-1 rounded-[2px] text-left transition-colors',
        'underline decoration-dotted decoration-from-font underline-offset-[3px]',
        on ? 'decoration-ice text-ice' : 'decoration-ink-4 hover:decoration-ink-2',
        className,
      )}
    >
      <span>{children}</span>
      <span
        aria-hidden
        className={cx(
          'size-1 shrink-0 translate-y-[-3px] rounded-full transition-colors',
          trace.grade === 'MEASURED'
            ? 'bg-seal'
            : trace.grade === 'COMPUTED'
              ? 'bg-ice'
              : trace.grade === 'DECLARED'
                ? 'bg-hazard'
                : 'bg-ink-4',
        )}
      />
    </button>
  );
}

function JumpControl({ trace }: { trace: Trace }) {
  const [missed, setMissed] = useState(false);

  if (!trace.stepId) return null;

  return (
    <div className="mt-2 border-t border-hairline pt-2">
      <button
        type="button"
        onClick={() => setMissed(!jumpToStep(trace.stepId!))}
        className="evidence text-[10.5px] text-ice transition-colors hover:text-ink"
      >
        ↳ jump to the sandbox log line
      </button>
      {missed ? (
        <p className="mt-1 text-[10px] leading-relaxed text-ink-4">
          That line is no longer in the buffer — the log keeps the last 400, and this run has produced more. The
          event id is above and appears in the harness transcript.
        </p>
      ) : null}
    </div>
  );
}

/**
 * What sits at the foot of the card while a figure is being interrogated.
 *
 * Renders nothing when nothing is selected, so it costs no space in the normal
 * case.
 */
export function ProvenanceInspector({ dossier }: { dossier: Dossier }) {
  const api = useProvenance();
  if (!api?.active) return null;

  const trace = traceClaim(dossier, api.active);
  const tone = GRADE_TONE[trace.grade];

  return (
    <div className="shrink-0 border-t border-hairline bg-panel px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Legend>Where this came from</Legend>
        <Chip tone={tone} mono className="!text-[9.5px]">
          {trace.grade}
        </Chip>
        <div className="h-px flex-1 bg-hairline" />
        <button
          type="button"
          onClick={api.close}
          className="text-[11px] text-ink-3 transition-colors hover:text-ink"
          aria-label="Close provenance"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-4">
        <span className="text-[11.5px] text-ink-2">{trace.label}</span>
        <Evidence size="xs" className="text-ink">
          {trace.value || '—'}
        </Evidence>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">{trace.explains}</p>

      <p
        className={cx(
          'mt-1.5 text-[10px] leading-relaxed',
          trace.grade === 'DECLARED' ? 'text-hazard' : 'text-ink-4',
        )}
      >
        {GRADE_COPY[trace.grade]}
      </p>

      {trace.evidence ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline pt-2">
          <Legend className="!text-[9px]">harness event</Legend>
          <Evidence size="xs" className="text-ink-2">
            {trace.evidence}
          </Evidence>
          {trace.capability !== null ? (
            <Evidence size="xs" dim>
              capability {trace.capability}
            </Evidence>
          ) : null}
          {trace.stepId ? (
            <Evidence size="xs" dim className="min-w-0 truncate">
              {trace.stepId}
            </Evidence>
          ) : null}
        </div>
      ) : null}

      <JumpControl trace={trace} />
    </div>
  );
}

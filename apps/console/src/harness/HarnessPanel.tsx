'use client';

import { useMemo, useState } from 'react';
import { CAPABILITIES, CAPABILITY_TOTAL, capabilitiesByGroup, type CapabilitySpec } from '@airlock/contract';
import { Evidence, Lamp, Legend, cx } from '@/design/primitives';
import { useRun } from './HarnessProvider';

/**
 * The Harness Panel.
 *
 * A capability ledger that lights only from real harness events. Three
 * decisions matter here and they are all about credibility:
 *
 *   1. Unlit rows stay readable. Hiding what did not happen would make the
 *      counter meaningless; showing it is what makes the lit ones worth
 *      believing.
 *   2. Every lit row exposes its evidence — the literal event type and the
 *      event id — so a judge can click a lamp and land on the step that proved
 *      it, rather than take our word for it.
 *   3. One colour. A lit lamp is a lit lamp; the proof mode is written out
 *      rather than colour-coded, because six accent colours would read as a
 *      hackathon project.
 */

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

const PROOF_COPY = {
  stream: 'proven by a live harness event',
  runtime: 'proven by observed runtime behaviour',
  config: 'proven by the agent spec we sent',
} as const;

export function HarnessPanel({
  onInspect,
  className,
}: {
  onInspect?: (stepId: string) => void;
  className?: string;
}) {
  const run = useRun();
  const [open, setOpen] = useState<number | null>(null);

  const byId = useMemo(() => new Map(run.harnessEvents.map((e) => [e.capability, e])), [run.harnessEvents]);
  const lit = byId.size;
  const pct = Math.round((lit / CAPABILITY_TOTAL) * 100);

  return (
    // No `flex` in the base: the caller controls display so a responsive
    // `hidden xl:flex` is not fighting a hardcoded `flex` for the cascade.
    <aside
      className={cx('min-h-0 flex-col border-l border-hairline bg-panel', className)}
      aria-label="Harness capability ledger"
    >
      {/* ---- header: the number the demo ends on ---- */}
      <header className="milled relative shrink-0 border-b border-hairline px-3 pt-3 pb-2.5">
        <div className="flex items-baseline justify-between">
          <Legend>Harness</Legend>
          <div className="flex items-baseline gap-1">
            <Evidence size="lg" className={cx('font-medium', lit === CAPABILITY_TOTAL ? 'text-seal' : 'text-ink')}>
              {String(lit).padStart(2, '0')}
            </Evidence>
            <Evidence size="sm" dim>
              / {CAPABILITY_TOTAL}
            </Evidence>
          </div>
        </div>

        <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-raised-2">
          <div
            className={cx(
              'h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]',
              lit === CAPABILITY_TOTAL ? 'bg-seal' : 'bg-ice',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
          {lit === 0
            ? 'Nothing proven yet. Lamps light only on real harness events.'
            : lit === CAPABILITY_TOTAL
              ? 'Every capability exercised and evidenced in this run.'
              : `${CAPABILITY_TOTAL - lit} not yet exercised in this run.`}
        </p>
      </header>

      {/* ---- the rail ---- */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
        {capabilitiesByGroup().map(({ group, items }) => {
          const groupLit = items.filter((c) => byId.has(c.id)).length;
          return (
            <section key={group} className="mb-1">
              <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
                <Legend className="!text-[9.5px]">{group}</Legend>
                <div className="h-px flex-1 bg-hairline" />
                <Evidence size="xs" dim>
                  {groupLit}/{items.length}
                </Evidence>
              </div>

              <ul>
                {items.map((cap) => (
                  <CapabilityRow
                    key={cap.id}
                    cap={cap}
                    event={byId.get(cap.id)}
                    fresh={run.freshCapability === cap.id}
                    expanded={open === cap.id}
                    onToggle={() => setOpen(open === cap.id ? null : cap.id)}
                    onInspect={onInspect}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <footer className="shrink-0 border-t border-hairline px-3 py-2">
        <p className="text-[10px] leading-snug text-ink-4">
          A lamp cannot be lit from application code. Source:{' '}
          <span className="evidence text-ink-3">packages/contract/src/detectors.ts</span>
        </p>
      </footer>
    </aside>
  );
}

function CapabilityRow({
  cap,
  event,
  fresh,
  expanded,
  onToggle,
  onInspect,
}: {
  cap: CapabilitySpec;
  event: { at: string; step_id: string; evidence: string; detail?: string } | undefined;
  fresh: boolean;
  expanded: boolean;
  onToggle: () => void;
  onInspect?: (stepId: string) => void;
}) {
  const isLit = Boolean(event);

  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={cx(
          'group flex w-full items-center gap-2.5 px-3 py-[5px] text-left transition-colors',
          'hover:bg-raised-2',
          expanded && 'bg-raised-2',
        )}
      >
        <Lamp lit={isLit} fresh={fresh} tone="ice" />
        <span
          className={cx(
            'flex-1 truncate text-[11.5px] leading-tight transition-colors',
            isLit ? 'text-ink' : 'text-ink-4 group-hover:text-ink-3',
          )}
        >
          {cap.name}
        </span>
        {isLit ? (
          <Evidence size="xs" className="shrink-0 text-ink-3 tabular-nums">
            {timeOf(event!.at)}
          </Evidence>
        ) : (
          <Evidence size="xs" className="shrink-0 text-ink-4">
            ——
          </Evidence>
        )}
      </button>

      {expanded ? (
        <div className="border-y border-hairline bg-void px-3 py-2.5">
          <p className="text-[11px] leading-relaxed text-ink-2">{cap.loadBearing}</p>

          <dl className="mt-2.5 space-y-1">
            <Row label="Proof">
              <span className="text-ink-2">{PROOF_COPY[cap.proof]}</span>
            </Row>
            <Row label="Evidence">
              <span className={isLit ? 'text-ice' : 'text-ink-4'}>{event?.evidence ?? cap.evidence}</span>
            </Row>
            {event?.detail ? (
              <Row label="Detail">
                <span className="text-ink-2">{event.detail}</span>
              </Row>
            ) : null}
            <Row label="Visible at">
              <span className="text-ink-3">{cap.visibleAt}</span>
            </Row>
          </dl>

          {isLit && event!.step_id ? (
            <button
              onClick={() => onInspect?.(event!.step_id)}
              className="mt-2.5 inline-flex items-center gap-1.5 text-[10.5px] text-ice hover:underline"
            >
              <span className="evidence">{event!.step_id.slice(0, 14)}…</span>
              <span>open the step that proved this</span>
            </button>
          ) : !isLit ? (
            <p className="mt-2.5 text-[10.5px] text-ink-4">
              Not exercised in this run. This lamp stays dark rather than claiming credit.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[10.5px] leading-relaxed">
      <dt className="w-[62px] shrink-0 text-ink-4">{label}</dt>
      <dd className="evidence min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** Compact readout for the topbar: the counter, without the rail. */
export function HarnessCounter({ onClick }: { onClick?: () => void }) {
  const run = useRun();
  const lit = run.harnessEvents.length;
  const complete = lit === CAPABILITY_TOTAL;
  return (
    <button
      onClick={onClick}
      title="Harness capability ledger"
      className="flex items-center gap-2 rounded-[4px] border border-hairline-2 bg-raised px-2 py-1 transition-colors hover:border-hairline-3"
    >
      <span className="legend !text-[9px]">Harness</span>
      <Evidence size="sm" className={complete ? 'text-seal' : 'text-ink'}>
        {String(lit).padStart(2, '0')}/{CAPABILITY_TOTAL}
      </Evidence>
      <span className="flex gap-[3px]">
        {CAPABILITIES.slice(0, 6).map((c) => (
          <Lamp key={c.id} lit={run.harnessEvents.some((e) => e.capability === c.id)} tone="ice" />
        ))}
      </span>
    </button>
  );
}

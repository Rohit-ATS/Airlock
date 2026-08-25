'use client';

import Link from 'next/link';
import { cx } from '@/design/primitives';
import { Machine, PropArch, PropCamera, PropKey, PropMail, PropNote, PropPebble, PropRing } from './Machine';
import { Wordmark } from './Wordmark';
import { Drift, Nav, Reveal } from './Rise';

/**
 * The hero, as one overlapping composition.
 *
 * The first attempt stacked this as rows — headline, then the object, then the
 * copy — and it could not work: the reference has the object occupying the
 * middle of the plate with the four text blocks pinned *around* it, sharing the
 * same vertical space. Stacked, the machine either collides with the headline
 * or pushes the buttons off the fold, and both happened.
 *
 * So above `lg` this is a fixed-ratio stage with everything absolutely placed.
 * Below `lg` it falls back to a stack, because absolute placement at phone
 * width just produces a different set of overlaps.
 */
export function Hero() {
  return (
    <div id="top" className="p-4 sm:p-7">
      <div className="lp-card relative overflow-hidden">
        <Nav />

        <div className="relative lg:aspect-[16/9.2]">
          {/* ---- the object, centred ----------------------------------- */}
          <div className="relative z-20 mt-2 flex justify-center lg:absolute lg:inset-0 lg:mt-0 lg:items-center lg:justify-center">
            <Machine className="h-[300px] w-auto sm:h-[380px] lg:h-[80%] lg:translate-y-[1%]" />
          </div>

          {/* ---- wordmark, behind everything --------------------------- */}
          <div className="pointer-events-none absolute inset-x-0 top-[49%] z-10 hidden px-8 sm:px-12 lg:block">
            <Wordmark text="AIR" className="h-[16%] w-[37%]" />
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-[79%] z-10 hidden justify-end px-8 sm:px-12 lg:flex">
            <Wordmark text="LOCK" className="h-[16%] w-[42%]" />
          </div>

          {/* ---- headline, top-left ------------------------------------ */}
          <div className="relative z-30 px-8 pt-8 sm:px-12 lg:absolute lg:top-[9%] lg:left-0 lg:w-[45%] lg:pt-0">
            <Reveal>
              <div className="flex gap-5">
                <span className="lp-mono mt-3 hidden shrink-0 text-[15px] tracking-[0.06em] text-[var(--lp-ink-2)] sm:block">
                  [1/8]
                </span>
                <h1 className="lp-display text-[clamp(1.9rem,3.3vw,3rem)] text-[var(--lp-ink)]">
                  <span className="block pl-[24%]">Proving</span>
                  <span className="block">every</span>
                  <span className="block pl-[11%]">
                    <span className="mr-1 text-[var(--lp-ink-2)]">.</span>irreversible
                  </span>
                  <span className="block">change first</span>
                </h1>
              </div>
            </Reveal>
          </div>

          {/* ---- stat, top-right --------------------------------------- */}
          <div className="relative z-30 px-8 pt-8 sm:px-12 lg:absolute lg:top-[10%] lg:right-0 lg:w-[27%] lg:pt-0 lg:pr-12">
            <Reveal delay={120}>
              <div>
                <div className="flex items-baseline gap-3">
                  <svg width="27" height="31" viewBox="0 0 30 34" fill="none" aria-hidden className="translate-y-1.5 opacity-40">
                    <path
                      d="M15 32V3m0 0-9 9m9-9 9 9M6 12h18"
                      stroke="var(--lp-ink)"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-[clamp(2rem,3vw,2.8rem)] leading-none font-bold tracking-[-0.03em] text-[var(--lp-ink)]">
                    100%
                  </span>
                  <span className="text-[clamp(1.05rem,1.45vw,1.4rem)] font-semibold text-[var(--lp-ink)]">PROVEN</span>
                </div>
                <p className="mt-4 max-w-[34ch] text-[15px] leading-[1.5] text-[var(--lp-ink-2)]">
                  Every approved change was executed and undone on a shadow copy first, with the checksums attached.
                </p>
              </div>
            </Reveal>
          </div>

          {/* ---- copy + buttons, bottom-left --------------------------- */}
          <div className="relative z-30 px-8 pt-10 sm:px-12 lg:absolute lg:bottom-[5%] lg:left-0 lg:w-[42%] lg:pt-0">
            <Reveal>
              <div>
                <p className="max-w-[40ch] text-[15.5px] leading-[1.5] text-[var(--lp-ink-2)]">
                  We prove migrations, erasures, refunds and access grants against a shadow copy, then hand you the
                  checksums and let you decide.
                </p>
                <div className="mt-7 flex flex-wrap gap-4">
                  <Link
                    href="/console"
                    className="rounded-[9px] bg-[linear-gradient(180deg,var(--lp-orange-a),var(--lp-orange-b))] px-10 py-3.5 text-[16px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(189,86,10,.9)] transition-transform hover:scale-[1.02]"
                  >
                    Open the console
                  </Link>
                  <a
                    href="#gate"
                    className="rounded-[9px] bg-[var(--lp-grey-btn)] px-10 py-3.5 text-[16px] font-medium text-[var(--lp-ink)] transition-colors hover:brightness-95"
                  >
                    Try the gate
                  </a>
                </div>
              </div>
            </Reveal>
          </div>

          {/* ---- copy, bottom-right ------------------------------------ */}
          <div className="relative z-30 px-8 pt-8 pb-24 sm:px-12 lg:absolute lg:top-[68%] lg:right-0 lg:w-[32%] lg:pt-0 lg:pb-0 lg:pr-12">
            <Reveal delay={100}>
              <p className="max-w-[36ch] text-[15.5px] leading-[1.5] text-[var(--lp-ink-2)] lg:text-right">
                From the first line of SQL to a sealed, tamper-evident receipt — nothing reaches production unproven.
              </p>
            </Reveal>
          </div>

          {/* ---- the props orbiting the object -------------------------- */}
          <Drift className="top-[11%] left-[38%] z-30 hidden w-[clamp(54px,4.4vw,80px)] lg:block" dur={7.5} rot={-7}>
            <PropNote className="h-auto w-full" />
          </Drift>
          <Drift className="top-[3%] left-[54%] z-30 hidden w-[clamp(60px,5vw,90px)] lg:block" dur={8.5} delay={0.6} rot={5}>
            <PropCamera className="h-auto w-full" />
          </Drift>
          <Drift className="top-[15%] right-[29%] z-30 hidden w-[clamp(64px,5.4vw,96px)] lg:block" dur={9} delay={1.2} rot={6}>
            <PropMail className="h-auto w-full" />
          </Drift>
          <Drift className="top-[36%] left-[32%] z-20 hidden w-[clamp(52px,4.6vw,84px)] lg:block" dur={10} delay={1.9} rot={8}>
            <PropArch className="h-auto w-full" />
          </Drift>
          <Drift className="bottom-[10%] left-[39%] z-30 hidden w-[clamp(76px,6.6vw,118px)] lg:block" dur={9.5} delay={0.9} rot={-5}>
            <PropRing className="h-auto w-full" />
          </Drift>
          <Drift className="top-[47%] left-[30%] z-30 hidden w-[clamp(22px,1.8vw,31px)] xl:block" dur={7} delay={2.2} rot={11}>
            <PropPebble className="h-auto w-full" tone="#b39184" />
          </Drift>
          <Drift className="right-[32%] bottom-[15%] z-30 hidden w-[clamp(34px,2.9vw,50px)] xl:block" dur={8} delay={1.5} rot={-9}>
            <PropKey className="h-auto w-full" />
          </Drift>
        </div>

        {/* ---- right rail ------------------------------------------------ */}
        <div className="lp-rail absolute top-1/2 right-0 z-40 hidden -translate-y-1/2 flex-col gap-1 p-2 xl:flex">
          {RAIL.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target={s.href.startsWith('http') ? '_blank' : undefined}
              rel={s.href.startsWith('http') ? 'noreferrer' : undefined}
              title={s.label}
              aria-label={s.label}
              className={cx(
                'grid size-11 place-items-center rounded-[10px] text-[#f5f5f5]',
                'transition-colors hover:bg-white/25',
              )}
            >
              <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d={s.d} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
        </div>

        {/* ---- the rise, carrying the scroll cue ------------------------- */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center">
          <div className="relative w-[min(680px,58%)]">
            <div className="h-[72px] rounded-t-[100%] bg-[var(--lp-rise)]" aria-hidden />
            <a
              href="#rule"
              className="pointer-events-auto absolute inset-x-0 bottom-3.5 flex flex-col items-center gap-1.5 text-[13.5px] leading-[1.35] text-[var(--lp-ink-2)] transition-colors hover:text-[var(--lp-ink)]"
            >
              <svg width="17" height="25" viewBox="0 0 16 24" fill="none" aria-hidden>
                <rect x="0.85" y="0.85" width="14.3" height="22.3" rx="7.15" stroke="currentColor" strokeWidth="1.4" />
                <rect x="7.1" y="5" width="1.8" height="5" rx="0.9" fill="currentColor" />
              </svg>
              <span className="text-center">
                Scroll to
                <br />
                explore more
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

const RAIL = [
  {
    label: 'Repository',
    href: 'https://github.com/Rohit-ATS/Airlock',
    d: 'M8 .6a7.4 7.4 0 0 0-2.34 14.43c.37.07.5-.16.5-.35v-1.28c-2.06.45-2.5-.99-2.5-.99-.34-.86-.82-1.09-.82-1.09-.67-.46.05-.45.05-.45.74.05 1.13.77 1.13.77.66 1.13 1.74.81 2.16.62.07-.48.26-.81.47-1-1.65-.19-3.38-.83-3.38-3.67 0-.81.29-1.48.77-2-.08-.19-.33-.95.07-1.98 0 0 .63-.2 2.04.76a7 7 0 0 1 3.71 0c1.41-.96 2.03-.76 2.03-.76.4 1.03.15 1.79.07 1.98.48.52.77 1.19.77 2 0 2.85-1.74 3.48-3.39 3.66.27.23.5.68.5 1.38v2.04c0 .2.13.43.5.36A7.4 7.4 0 0 0 8 .6Z',
  },
  { label: 'Operator console', href: '/console', d: 'M2 3.2h12v9.6H2zM4.6 6l2 2-2 2M8.4 10.4H11' },
  { label: 'Control room', href: '/control', d: 'M8 1.6 14 5v6l-6 3.4L2 11V5z' },
];

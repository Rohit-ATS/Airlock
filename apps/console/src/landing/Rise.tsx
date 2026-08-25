'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/design/primitives';
import { Mark } from '@/console/Mark';
import { Hatch } from './Hatch';
import { Wordmark } from './Wordmark';

/**
 * The front-door chrome: nav, hero, and the furniture around them.
 *
 * The layout follows a specific editorial idea — a single rounded plate on a
 * warm ground, a floating pill nav, a headline whose lines are indented
 * unequally so the block reads as one shape, a centrepiece with artefacts
 * drifting around it, and a giant machine wordmark behind everything.
 *
 * What is adapted rather than copied is the *content* of each slot. The
 * reference floats decorative 3D props; this floats the artefacts the product
 * actually emits — a checksum triple, a seal, a receipt hash. The reference's
 * headline sells a service; this one states the rule the whole system is built
 * on. Same architecture, and every slot earns its place.
 */

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

const NAV = [
  { href: '#rule', label: 'The rule' },
  { href: '#gate', label: 'Try the gate' },
  { href: '#proof', label: 'Proof' },
  { href: '#policy', label: 'Policy' },
  { href: '#ledger', label: 'Ledger' },
];

export function RiseNav() {
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(`#${visible[0].target.id}`);
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    for (const item of NAV) {
      const el = document.getElementById(item.href.slice(1));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-5">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="AIRLOCK — home">
          <span className="grid size-9 place-items-center rounded-[9px] bg-[var(--lp-ink)]">
            <Mark size={17} />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--lp-ink)]">AIRLOCK</span>
        </Link>

        <nav className="lp-nav mx-auto hidden items-center gap-0.5 p-1 lg:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              data-active={active === item.href ? 'true' : undefined}
              className="px-3.5 py-2 text-[13px] text-[var(--lp-ink-2)] hover:text-[var(--lp-ink)]"
            >
              {item.label}
            </a>
          ))}
          <span className="mx-1.5 h-4 w-px bg-[var(--lp-line-2)]" aria-hidden />
          <a
            href="https://github.com/Rohit-ATS/Airlock"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 text-[13px] text-[var(--lp-ink-2)] hover:text-[var(--lp-ink)]"
          >
            Source
          </a>
        </nav>

        <Link
          href="/console"
          className="ml-auto shrink-0 rounded-full bg-[var(--lp-ink)] px-5 py-3 text-[13px] font-medium text-white transition-transform hover:scale-[1.02] lg:ml-0"
        >
          Open the console
        </Link>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Orbiting evidence                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The artefacts the product emits, drifting around the hatch.
 *
 * Long cycles at offset delays, so they never settle into a visible pattern.
 * Each one is a real thing the system produces rather than an ornament — which
 * is the difference between decoration and an illustration of the argument.
 */
function Chip({
  children,
  className,
  tone = 'paper',
  dur = 7,
  delay = 0,
  tilt = 0,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'paper' | 'signal' | 'ink' | 'seal';
  dur?: number;
  delay?: number;
  tilt?: number;
}) {
  const tones = {
    paper: 'bg-white text-[var(--lp-ink)] shadow-[0_10px_30px_-14px_rgba(0,0,0,.45)]',
    signal: 'bg-[var(--lp-signal)] text-white shadow-[0_12px_34px_-12px_rgba(217,100,29,.7)]',
    ink: 'bg-[var(--lp-void)] text-[#e8ecf2] shadow-[0_14px_36px_-16px_rgba(0,0,0,.75)]',
    seal: 'bg-[#0b3729] text-[#35d6a4] shadow-[0_12px_34px_-14px_rgba(0,0,0,.6)]',
  } as const;

  return (
    <div
      className={cx('lp-chip absolute rounded-[12px] px-3 py-2', tones[tone], className)}
      style={
        {
          '--lp-dur': `${dur}s`,
          '--lp-delay': `${delay}s`,
          '--lp-tilt': `${tilt}deg`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

export function RiseHero() {
  return (
    <section className="relative px-3 pb-6 sm:px-5">
      <div className="lp-plate relative mx-auto max-w-[1500px] overflow-hidden px-5 pt-10 pb-8 sm:px-9 sm:pt-14 md:pb-10">
        {/* ---- top row: counter, headline, stat ------------------------- */}
        <div className="relative z-20 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex gap-4 sm:gap-6">
            <span className="lp-eyebrow mt-3 hidden shrink-0 sm:block">[01/07]</span>

            {/* The lines are indented unequally on purpose: the block reads as
                one shape rather than four stacked rows. */}
            <h1 className="lp-display text-[clamp(2.6rem,7.4vw,6.6rem)]">
              <span className="block pl-[6%]">PROVE IT</span>
              <span className="block">BY DOING IT</span>
              <span className="block pl-[12%]">AND UNDOING IT</span>
              <span className="block">BEFORE YOU ASK</span>
            </h1>
          </div>

          <div className="max-w-[300px] lg:pt-3 lg:text-right">
            <div className="flex items-baseline gap-2 lg:justify-end">
              <span className="text-[var(--lp-signal-ink)]" aria-hidden>
                ⌦
              </span>
              <span className="evidence text-[clamp(2rem,4.4vw,3rem)] leading-none font-bold tracking-[-0.03em] text-[var(--lp-ink)]">
                0
              </span>
              <span className="text-[15px] font-semibold tracking-[0.02em] text-[var(--lp-ink-2)]">UNPROVEN</span>
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--lp-ink-3)]">
              Changes approved without a certificate, across every run. Not a target — the number the type system
              makes unreachable.
            </p>
          </div>
        </div>

        {/* ---- the stage: wordmark, hatch, drifting evidence ------------- */}
        <div className="relative mt-4 h-[clamp(320px,44vw,560px)] md:mt-0">
          {/* Behind everything, clipped by the hatch. */}
          <Wordmark
            className="pointer-events-none absolute inset-x-0 top-[38%] mx-auto h-[26%] w-[94%] select-none"
            opacity={0.9}
          />

          <div className="absolute inset-0 grid place-items-center">
            <div className="relative aspect-square h-full max-h-[520px]">
              <Hatch sealed className="drop-shadow-[0_28px_60px_rgba(0,0,0,0.22)]" />
            </div>
          </div>

          {/* Real artefacts, drifting. */}
          <Chip tone="ink" className="top-[6%] left-[4%] hidden sm:block" dur={8} tilt={-4}>
            <span className="evidence block text-[10px] text-[#7d8b9e]">pre</span>
            <span className="evidence block text-[11px]">sha256:0234ab62…</span>
          </Chip>

          <Chip tone="seal" className="top-[20%] right-[5%] hidden md:block" dur={9} delay={1.2} tilt={5}>
            <span className="evidence block text-[10px] text-[#7fecc9]">post-rollback</span>
            <span className="evidence block text-[11px]">= pre ✓</span>
          </Chip>

          <Chip tone="signal" className="bottom-[26%] left-[8%] hidden md:block" dur={7.5} delay={0.6} tilt={6}>
            <span className="block text-[10px] leading-none text-white">lock held</span>
            <span className="evidence block text-[15px] leading-tight font-semibold">4.21 s</span>
          </Chip>

          <Chip tone="paper" className="right-[10%] bottom-[16%] hidden lg:block" dur={8.5} delay={1.8} tilt={-6}>
            <span className="block text-[10px] leading-none text-[var(--lp-ink-3)]">receipt #004</span>
            <span className="evidence block text-[11px]">b871960aedb7…</span>
          </Chip>

          <Chip tone="paper" className="top-[46%] left-[1%] hidden xl:block" dur={10} delay={2.4} tilt={8}>
            <span className="block text-[10px] leading-none text-[var(--lp-ink-3)]">quorum</span>
            <span className="evidence block text-[13px] font-semibold">2 people</span>
          </Chip>
        </div>

        {/* ---- bottom row ----------------------------------------------- */}
        <div className="relative z-20 grid gap-8 md:grid-cols-2 md:items-end">
          <div>
            <p className="max-w-[46ch] text-[15px] leading-relaxed text-[var(--lp-ink-2)]">
              A change-control console for irreversible production work. The agent applies your migration to a shadow
              copy, rolls it back, and proves the data returned byte-identical — and only then is it allowed to ask you
              anything.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/console"
                className="rounded-[12px] bg-[var(--lp-signal)] px-7 py-4 text-[14px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(217,100,29,.9)] transition-transform hover:scale-[1.02]"
              >
                Open the console
              </Link>
              <a
                href="#gate"
                className="rounded-[12px] border border-[var(--lp-line-2)] bg-[var(--lp-paper-2)] px-7 py-4 text-[14px] font-semibold text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-paper-3)]"
              >
                Try to break the gate
              </a>
            </div>
          </div>

          <p className="max-w-[42ch] text-[14px] leading-relaxed text-[var(--lp-ink-3)] md:justify-self-end md:text-right">
            Built on TrueForge for the Agent Harness Hackathon. Seven classes of change, twenty-three harness
            capabilities, and a ledger you can verify in your own browser.
          </p>
        </div>

        {/* ---- scroll cue on a soft rise -------------------------------- */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden justify-center md:flex">
          <div className="relative w-[420px] max-w-full">
            <div
              className="h-14 rounded-t-[100%] bg-[var(--lp-paper-2)]"
              aria-hidden
            />
            <a
              href="#rule"
              className="pointer-events-auto absolute inset-x-0 bottom-1 flex flex-col items-center gap-1 text-[11px] leading-tight text-[var(--lp-ink-3)] transition-colors hover:text-[var(--lp-ink)]"
            >
              <svg width="15" height="21" viewBox="0 0 15 21" fill="none" aria-hidden>
                <rect x="0.75" y="0.75" width="13.5" height="19.5" rx="6.75" stroke="currentColor" strokeWidth="1.5" />
                <rect x="6.5" y="5" width="2" height="4" rx="1" fill="currentColor" />
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
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* A section shell reused down the page                                        */
/* -------------------------------------------------------------------------- */

export function Plate({
  id,
  index,
  label,
  title,
  standfirst,
  children,
  className,
}: {
  id?: string;
  index?: string;
  label?: string;
  title?: ReactNode;
  standfirst?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className="px-3 pb-6 sm:px-5">
      <div className={cx('lp-plate mx-auto max-w-[1500px] px-5 py-12 sm:px-9 md:py-16', className)}>
        {(index || label) && (
          <div className="flex items-baseline gap-3">
            {index ? <span className="lp-eyebrow">[{index}]</span> : null}
            {label ? <span className="lp-eyebrow text-[var(--lp-signal-ink)]">{label}</span> : null}
          </div>
        )}
        {title ? (
          <h2 className="lp-display mt-4 max-w-[20ch] text-[clamp(1.9rem,4.2vw,3.4rem)]">{title}</h2>
        ) : null}
        {standfirst ? (
          <div className="mt-5 max-w-[68ch] text-[15px] leading-relaxed text-[var(--lp-ink-2)]">{standfirst}</div>
        ) : null}
        {children ? <div className="mt-10">{children}</div> : null}
      </div>
    </section>
  );
}

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/design/primitives';
import { Machine, PropArch, PropCamera, PropMail, PropNote, PropPebble, PropRing } from './Machine';
import { Wordmark } from './Wordmark';

/**
 * The front door.
 *
 * Laid out slot-for-slot against the reference: a rounded plate inset on a
 * darker ground, a floating pill nav, a four-line staggered headline, a centre
 * object with props drifting around it, a stat block and a social rail on the
 * right, a giant pixel wordmark behind, a description and two buttons at the
 * foot, and a soft rise carrying the scroll cue.
 *
 * What is adapted is the copy and the centre object. Everything else — the
 * proportions, the indents, the placement — follows the reference.
 */

/* -------------------------------------------------------------------------- */
/* Reveal                                                                      */
/* -------------------------------------------------------------------------- */

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cx('lp-reveal', className)}
      data-shown={shown ? 'true' : 'false'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Drifting prop                                                               */
/* -------------------------------------------------------------------------- */

function Drift({
  children,
  className,
  dur = 8,
  delay = 0,
  rot = 0,
}: {
  children: ReactNode;
  className?: string;
  dur?: number;
  delay?: number;
  rot?: number;
}) {
  return (
    <div
      className={cx('lp-drift pointer-events-none absolute', className)}
      style={
        {
          ['--lp-dur' as string]: `${dur}s`,
          ['--lp-delay' as string]: `${delay}s`,
          ['--lp-rot' as string]: `${rot}deg`,
        } as React.CSSProperties
      }
      aria-hidden
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

const NAV = [
  { href: '#top', label: 'Home', active: true },
  { href: '#rule', label: 'The rule' },
  { href: '#proof', label: 'Proof' },
  { href: '#policy', label: 'Policy' },
  { href: '#ledger', label: 'Ledger' },
];

function Nav() {
  return (
    <div className="flex items-center gap-4 px-6 pt-6 sm:px-9 sm:pt-8">
      {/* mark + name */}
      <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="AIRLOCK — home">
        <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--lp-orange)]">
          <span className="grid grid-cols-2 gap-[2px]">
            <span className="size-[5px] rounded-[1px] bg-white" />
            <span className="size-[5px] rounded-[1px] bg-white/60" />
            <span className="size-[5px] rounded-[1px] bg-white/60" />
            <span className="size-[5px] rounded-[1px] bg-white" />
          </span>
        </span>
        <span className="text-[19px] font-semibold tracking-[-0.02em]">AIRLOCK</span>
      </Link>

      {/* the pill group */}
      <nav className="lp-nav mx-auto hidden items-center gap-1 p-1.5 lg:flex" aria-label="Sections">
        {NAV.map((item) => (
          <a
            key={item.label}
            href={item.href}
            data-active={item.active ? 'true' : undefined}
            className="px-4 py-2.5 text-[14px] text-[var(--lp-ink-2)] hover:text-[var(--lp-ink)]"
          >
            {item.label}
          </a>
        ))}
        <span className="mx-1 h-5 w-px bg-[var(--lp-active)]" aria-hidden />
        <a
          href="https://github.com/Rohit-ATS/Airlock"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-4 py-2.5 text-[14px] text-[var(--lp-ink-2)] hover:text-[var(--lp-ink)]"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M1.6 8h12.8M8 1.4c1.7 1.8 2.6 4 2.6 6.6S9.7 12.8 8 14.6C6.3 12.8 5.4 10.6 5.4 8S6.3 3.2 8 1.4Z" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          Source
        </a>
      </nav>

      {/* the black button */}
      <Link
        href="/console"
        className="ml-auto shrink-0 rounded-[10px] bg-[var(--lp-black)] px-6 py-3.5 text-[14px] font-medium text-white transition-transform hover:scale-[1.02] lg:ml-0"
      >
        Open the console
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

export function Hero() {
  return (
    <div id="top" className="p-3 sm:p-5">
      <div className="lp-card relative overflow-hidden">
        <Nav />

        {/* ---- headline / stat row -------------------------------------- */}
        <div className="relative z-20 grid gap-8 px-6 pt-10 sm:px-9 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12">
          <Reveal>
            <div className="flex gap-4 sm:gap-6">
              <span className="lp-mono mt-3 hidden shrink-0 text-[12px] text-[var(--lp-ink-3)] sm:block">[1/8]</span>
              <h1 className="lp-display text-[clamp(2.4rem,6.4vw,5.6rem)]">
                <span className="block pl-[16%]">Proving</span>
                <span className="block">every</span>
                <span className="block pl-[9%]">
                  <span className="text-[var(--lp-orange-ink)]">.</span>irreversible
                </span>
                <span className="block">change first</span>
              </h1>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="lg:pt-4">
              <div className="flex items-baseline gap-2.5">
                <svg width="26" height="30" viewBox="0 0 26 30" fill="none" aria-hidden className="translate-y-1">
                  <path d="M13 28V4m0 0L3 14M13 4l10 10" stroke="var(--lp-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="lp-mono text-[clamp(2.1rem,3.6vw,2.9rem)] leading-none font-bold tracking-[-0.03em]">
                  100%
                </span>
                <span className="text-[17px] font-medium tracking-[0.01em]">PROVEN</span>
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-[var(--lp-ink-3)]">
                Every approved change was executed and undone on a shadow copy first, with the checksums attached.
              </p>
            </div>
          </Reveal>
        </div>

        {/* ---- the stage ------------------------------------------------- */}
        <div className="relative mt-2 h-[clamp(340px,48vw,600px)]">
          {/* wordmark, behind and clipped by the machine */}
          <div className="pointer-events-none absolute inset-x-0 top-[36%] z-0 px-6 sm:px-9">
            <Wordmark text="AIR" className="h-[clamp(3.4rem,10vw,8.4rem)] w-[62%]" />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-[4%] z-0 flex justify-end px-6 sm:px-9">
            <Wordmark text="LOCK" className="h-[clamp(3.4rem,10vw,8.4rem)] w-[58%]" />
          </div>

          {/* the machine */}
          <div className="absolute inset-0 z-10 grid place-items-center">
            <Machine className="h-full w-auto max-w-[92vw]" />
          </div>

          {/* props */}
          <Drift className="top-[8%] left-[26%] w-[clamp(46px,6vw,76px)] hidden sm:block" dur={7.5} rot={-8}>
            <PropNote className="h-auto w-full" />
          </Drift>
          <Drift className="top-[2%] right-[27%] w-[clamp(58px,7.5vw,104px)] hidden sm:block" dur={9} delay={1.1} rot={6}>
            <PropMail className="h-auto w-full" />
          </Drift>
          <Drift className="top-[-2%] left-[46%] w-[clamp(48px,6vw,86px)] hidden md:block" dur={8.5} delay={0.5} rot={-4}>
            <PropCamera className="h-auto w-full" />
          </Drift>
          <Drift className="top-[24%] left-[19%] w-[clamp(48px,6.5vw,92px)] hidden md:block" dur={10} delay={1.8} rot={9}>
            <PropArch className="h-auto w-full" />
          </Drift>
          <Drift className="bottom-[16%] left-[30%] w-[clamp(56px,8vw,116px)] hidden md:block" dur={9.5} delay={0.9} rot={-6}>
            <PropRing className="h-auto w-full" />
          </Drift>
          <Drift className="top-[46%] left-[23%] w-[clamp(24px,2.6vw,38px)] hidden lg:block" dur={7} delay={2.2} rot={12}>
            <PropPebble className="h-auto w-full" tone="#a9887a" />
          </Drift>
          <Drift className="right-[30%] bottom-[22%] w-[clamp(26px,3vw,44px)] hidden lg:block" dur={8} delay={1.5} rot={-10}>
            <PropPebble className="h-auto w-full" />
          </Drift>
        </div>

        {/* ---- foot row -------------------------------------------------- */}
        <div className="relative z-20 grid gap-8 px-6 pb-16 sm:px-9 md:grid-cols-2 md:items-end md:pb-24">
          <Reveal>
            <div>
              <p className="max-w-[44ch] text-[15px] leading-relaxed text-[var(--lp-ink-2)]">
                We prove migrations, erasures, refunds and access grants against a shadow copy — then hand you the
                checksums and let you decide.
              </p>
              <div className="mt-7 flex flex-wrap gap-3.5">
                <Link
                  href="/console"
                  className="rounded-[10px] bg-[var(--lp-orange)] px-9 py-4 text-[15px] font-semibold text-white transition-transform hover:scale-[1.02]"
                >
                  Open the console
                </Link>
                <a
                  href="#gate"
                  className="rounded-[10px] bg-[var(--lp-pill)] px-9 py-4 text-[15px] font-semibold text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-active)]"
                >
                  Try the gate
                </a>
              </div>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <p className="max-w-[40ch] text-[14.5px] leading-relaxed text-[var(--lp-ink-3)] md:justify-self-end md:text-right">
              From the first line of SQL to a sealed, tamper-evident receipt — nothing reaches production unproven.
            </p>
          </Reveal>
        </div>

        {/* ---- social rail ----------------------------------------------- */}
        <div className="lp-rail absolute top-1/2 right-0 z-30 hidden -translate-y-1/2 flex-col gap-1 p-2 xl:flex">
          {[
            { label: 'Repository', href: 'https://github.com/Rohit-ATS/Airlock', d: 'M8 .5a7.5 7.5 0 0 0-2.37 14.62c.37.07.5-.16.5-.36v-1.3c-2.09.46-2.53-1-2.53-1-.34-.87-.83-1.1-.83-1.1-.68-.47.05-.46.05-.46.75.06 1.15.78 1.15.78.67 1.15 1.76.82 2.19.63.07-.49.26-.82.48-1.01-1.67-.19-3.42-.84-3.42-3.72 0-.82.29-1.5.78-2.02-.08-.19-.34-.96.07-2 0 0 .63-.2 2.06.77a7.1 7.1 0 0 1 3.76 0c1.43-.97 2.06-.77 2.06-.77.41 1.04.15 1.81.07 2 .49.52.78 1.2.78 2.02 0 2.89-1.76 3.53-3.43 3.71.27.24.51.69.51 1.4v2.07c0 .2.13.44.51.36A7.5 7.5 0 0 0 8 .5Z' },
            { label: 'Console', href: '/console', d: 'M2 3h12v10H2V3Zm2.6 2.4 2.2 2.2-2.2 2.2M8.4 10.6H11' },
            { label: 'Control room', href: '/control', d: 'M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Z' },
          ].map((s) => (
            <a
              key={s.label}
              href={s.href}
              target={s.href.startsWith('http') ? '_blank' : undefined}
              rel={s.href.startsWith('http') ? 'noreferrer' : undefined}
              title={s.label}
              aria-label={s.label}
              className="grid size-10 place-items-center rounded-[10px] text-[var(--lp-ink-2)] transition-colors hover:bg-[var(--lp-active)] hover:text-[var(--lp-ink)]"
            >
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d={s.d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
        </div>

        {/* ---- the rise, and the scroll cue ------------------------------- */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center">
          <div className="relative w-[min(520px,86%)]">
            <div className="h-[74px] rounded-t-[100%] bg-[var(--lp-rise)]" aria-hidden />
            <a
              href="#rule"
              className="pointer-events-auto absolute inset-x-0 bottom-3 flex flex-col items-center gap-1 text-[12.5px] leading-tight text-[var(--lp-ink-3)] transition-colors hover:text-[var(--lp-ink)]"
            >
              <svg width="16" height="23" viewBox="0 0 16 23" fill="none" aria-hidden>
                <rect x="0.8" y="0.8" width="14.4" height="21.4" rx="7.2" stroke="currentColor" strokeWidth="1.5" />
                <rect x="7" y="5" width="2" height="5" rx="1" fill="currentColor" />
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

/* -------------------------------------------------------------------------- */
/* Section shell used down the page                                            */
/* -------------------------------------------------------------------------- */

export function Band({
  id,
  index,
  label,
  title,
  lede,
  children,
  dark,
}: {
  id?: string;
  index?: string;
  label?: string;
  title?: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  dark?: boolean;
}) {
  return (
    <section id={id} className="px-3 pb-3 sm:px-5 sm:pb-5">
      <div
        className={cx(
          'lp-card px-6 py-16 sm:px-9 md:py-24',
          dark && '!bg-[var(--lp-void)] text-[var(--lp-pale)]',
        )}
      >
        <div className="grid gap-y-10 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-x-14">
          <div className="lg:sticky lg:top-8 lg:self-start">
            {index ? (
              <div className={cx('lp-mono text-[12px]', dark ? 'text-[var(--lp-pale-3)]' : 'text-[var(--lp-ink-3)]')}>
                {index}
              </div>
            ) : null}
            {label ? (
              <div className={cx('mt-2 text-[14px] font-medium', dark ? 'text-[var(--lp-pale-2)]' : 'text-[var(--lp-ink-2)]')}>
                {label}
              </div>
            ) : null}
          </div>

          <div>
            {title ? (
              <Reveal>
                <h2 className={cx('lp-display max-w-[18ch] text-[clamp(1.9rem,4.4vw,3.6rem)]', dark && '!text-[var(--lp-pale)]')}>
                  {title}
                </h2>
              </Reveal>
            ) : null}
            {lede ? (
              <Reveal delay={80}>
                <div
                  className={cx(
                    'mt-6 max-w-[62ch] text-[15.5px] leading-relaxed',
                    dark ? 'text-[var(--lp-pale-2)]' : 'text-[var(--lp-ink-2)]',
                  )}
                >
                  {lede}
                </div>
              </Reveal>
            ) : null}
            {children ? <div className={title || lede ? 'mt-12' : ''}>{children}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

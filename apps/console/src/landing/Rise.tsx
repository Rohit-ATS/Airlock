'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/design/primitives';
import { Hatch } from './Hatch';
import { Wordmark } from './Wordmark';

/**
 * The front door: chrome, hero, and the shared furniture.
 *
 * Full bleed throughout. No cards, no rounded plates, no boxes inside boxes —
 * sections run edge to edge and are separated by a single hairline, so the page
 * reads as one continuous document instead of a stack of tiles.
 *
 * The hierarchy is carried by scale and whitespace rather than by borders. When
 * the largest thing on screen is 11vw and the smallest is 11px, you stop
 * needing a box to tell the reader which is which.
 */

/* -------------------------------------------------------------------------- */
/* Reveal                                                                      */
/* -------------------------------------------------------------------------- */

/** One-way. An element that re-animates on every scroll-by never sits still. */
export function Rise({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Without IntersectionObserver, content must still be readable.
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
      { rootMargin: '0px 0px -10% 0px', threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cx('lp-rise', className)}
      data-shown={shown ? 'true' : 'false'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

const NAV = [
  { href: '#rule', label: 'The rule' },
  { href: '#gate', label: 'The gate' },
  { href: '#proof', label: 'Proof' },
  { href: '#policy', label: 'Policy' },
  { href: '#ledger', label: 'Ledger' },
];

export function Nav() {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cx(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-500',
        solid ? 'border-b border-[var(--lp-line)] bg-[var(--lp-paper)]/92 backdrop-blur-xl' : 'border-b border-transparent',
      )}
    >
      <div className="flex h-[68px] items-center gap-10 px-6 sm:px-10">
        <Link href="/" className="lp-display shrink-0 text-[19px] tracking-[-0.03em]" aria-label="AIRLOCK — home">
          AIRLOCK
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="lp-link text-[13.5px] text-[var(--lp-ink-2)] transition-colors hover:text-[var(--lp-ink)]"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-7">
          <a
            href="https://github.com/Rohit-ATS/Airlock"
            target="_blank"
            rel="noreferrer"
            className="lp-link hidden text-[13.5px] text-[var(--lp-ink-2)] transition-colors hover:text-[var(--lp-ink)] sm:inline-block"
          >
            Source
          </a>
          <Link
            href="/console"
            className="group flex items-center gap-2.5 text-[13.5px] font-medium text-[var(--lp-ink)]"
          >
            Open the console
            <span className="grid size-8 place-items-center rounded-full bg-[var(--lp-ink)] text-[var(--lp-paper)] transition-transform duration-300 group-hover:translate-x-0.5">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 6h8m0 0L6.5 2.5M10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

function Orbit({
  children,
  className,
  dur = 9,
  delay = 0,
  tone = 'paper',
}: {
  children: ReactNode;
  className?: string;
  dur?: number;
  delay?: number;
  tone?: 'paper' | 'ink' | 'signal';
}) {
  const tones = {
    paper: 'bg-white text-[var(--lp-ink)] ring-1 ring-[var(--lp-line)]',
    ink: 'bg-[var(--lp-void)] text-[var(--lp-pale)]',
    // Explicit hex rather than `text-white`: the console's @theme block
    // replaces Tailwind's default palette, so that utility is never emitted
    // and the text silently inherited the page's ink at 3.6:1 on the fill.
    signal: 'bg-[var(--lp-signal)] text-[#ffffff]',
  } as const;
  return (
    <div
      className={cx('lp-float absolute px-4 py-3', tones[tone], className)}
      style={{ ['--lp-dur' as string]: `${dur}s`, ['--lp-delay' as string]: `${delay}s` }}
      aria-hidden
    >
      {children}
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-[68px]">
      <div className="relative px-6 pt-16 pb-10 sm:px-10 md:pt-24">
        {/* --- headline ---------------------------------------------------- */}
        <Rise>
          <div className="flex items-start gap-6">
            <span className="lp-label mt-4 hidden shrink-0 sm:block">01 / 07</span>
            <h1 className="lp-display max-w-[15ch] text-[clamp(3rem,10.5vw,10.5rem)]">
              Prove it
              <span className="lp-serif-em block text-[0.62em] text-[var(--lp-signal-ink)]">by doing it,</span>
              then undoing it
            </h1>
          </div>
        </Rise>

        {/* --- the stage --------------------------------------------------- */}
        <div className="relative mt-6 md:mt-2">
          <div className="pointer-events-none relative mx-auto aspect-square w-[min(64vw,540px)]">
            <Hatch sealed className="h-full w-full" />
          </div>

          <Orbit tone="ink" className="top-[8%] left-[2%] hidden sm:block" dur={10}>
            <span className="lp-label !text-[9px] !text-[var(--lp-pale-3)]">pre</span>
            <span className="evidence mt-1 block text-[12px]">sha256:0234ab62…</span>
          </Orbit>

          <Orbit tone="paper" className="top-[20%] right-[3%] hidden md:block" dur={11} delay={1.4}>
            <span className="lp-label !text-[9px]">post-rollback</span>
            <span className="evidence mt-1 block text-[12px] text-[#0b6349]">identical ✓</span>
          </Orbit>

          <Orbit tone="signal" className="bottom-[22%] left-[6%] hidden md:block" dur={9.5} delay={0.7}>
            <span className="block text-[10px] tracking-[0.14em] text-[#ffffff] uppercase">lock held</span>
            <span className="evidence mt-0.5 block text-[19px] leading-none font-semibold text-[#ffffff]">4.21s</span>
          </Orbit>

          <Orbit tone="paper" className="right-[8%] bottom-[14%] hidden lg:block" dur={12} delay={2.1}>
            <span className="lp-label !text-[9px]">quorum</span>
            <span className="evidence mt-1 block text-[13px] font-semibold">2 people</span>
          </Orbit>
        </div>

        {/* --- supporting row ---------------------------------------------- */}
        <Rise delay={120}>
          <div className="mt-4 grid gap-10 md:grid-cols-[1.1fr_auto] md:items-end">
            <div>
              <p className="lp-lede max-w-[52ch]">
                A change-control console for irreversible production work. The agent applies your migration to a shadow
                copy, rolls it back, and proves the data returned byte-identical — and only then is it allowed to ask
                you anything.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
                <Link
                  href="/console"
                  className="group inline-flex items-center gap-3 bg-[var(--lp-ink)] px-8 py-4.5 text-[14px] font-medium text-[var(--lp-paper)] transition-colors hover:bg-[var(--lp-signal)]"
                >
                  Open the console
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
                    <path d="M2 6h8m0 0L6.5 2.5M10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
                <a href="#gate" className="lp-link text-[14px] font-medium text-[var(--lp-ink-2)] hover:text-[var(--lp-ink)]">
                  Try to break the gate
                </a>
              </div>
            </div>

            <div className="md:text-right">
              <div className="evidence text-[clamp(3.4rem,7vw,5.6rem)] leading-[0.8] font-bold tracking-[-0.05em]">
                0
              </div>
              <div className="lp-label mt-3">unproven changes approved</div>
              <p className="mt-3 max-w-[30ch] text-[13px] leading-relaxed text-[var(--lp-ink-3)] md:ml-auto">
                Not a target. The number the type system makes unreachable.
              </p>
            </div>
          </div>
        </Rise>
      </div>

      {/* --- the wordmark band, edge to edge --------------------------------- */}
      <div className="mt-10 border-y border-[var(--lp-line)] py-8 md:mt-16">
        <Wordmark className="h-[clamp(3rem,11vw,9rem)] w-full px-6 text-[var(--lp-ink)] sm:px-10" opacity={1} />
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Section shell                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A full-bleed section with a sticky label in the left column.
 *
 * The label stays with you as the content scrolls, which is what lets the page
 * drop every heading box: you always know where you are without a card telling
 * you.
 */
export function Band({
  id,
  index,
  label,
  title,
  lede,
  children,
  dark,
  className,
}: {
  id?: string;
  index?: string;
  label?: string;
  title?: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cx(
        'border-t px-6 py-24 sm:px-10 md:py-36',
        dark
          ? 'border-[var(--lp-line-dark)] bg-[var(--lp-void)] text-[var(--lp-pale)]'
          : 'border-[var(--lp-line)]',
        className,
      )}
    >
      <div className="grid gap-y-12 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-x-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          {index ? (
            <div className={cx('lp-label', dark && '!text-[var(--lp-pale-3)]')}>{index}</div>
          ) : null}
          {label ? (
            <div className={cx('mt-2 text-[13px] font-medium', dark ? 'text-[var(--lp-pale-2)]' : 'text-[var(--lp-ink-2)]')}>
              {label}
            </div>
          ) : null}
        </div>

        <div>
          {title ? (
            <Rise>
              <h2
                className={cx(
                  'lp-display max-w-[17ch] text-[clamp(2.1rem,5.4vw,4.6rem)]',
                  dark && 'text-[var(--lp-pale)]',
                )}
              >
                {title}
              </h2>
            </Rise>
          ) : null}
          {lede ? (
            <Rise delay={80}>
              <div className={cx('lp-lede mt-8 max-w-[62ch]', dark && '!text-[var(--lp-pale-2)]')}>{lede}</div>
            </Rise>
          ) : null}
          {children ? <div className={title || lede ? 'mt-16' : ''}>{children}</div> : null}
        </div>
      </div>
    </section>
  );
}

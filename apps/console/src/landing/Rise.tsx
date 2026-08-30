'use client';

import { useCallback, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/design/primitives';

/**
 * The front door, laid out to the reference.
 *
 * One plate. Nav across the top, headline left with the [1/8] counter beside
 * it, a stat block top-right, the object dead centre with props orbiting, the
 * wordmark split in two behind it, copy and buttons bottom-left, a second
 * column of copy bottom-right, a vertical rail on the right edge, and the rise
 * carrying the scroll cue at the foot.
 */

/* -------------------------------------------------------------------------- */
/* Reveal                                                                      */
/* -------------------------------------------------------------------------- */

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const [shown, setShown] = useState(false);

  /**
   * Observe on attach, not from an effect.
   *
   * The fallback for a browser with no IntersectionObserver has to make the
   * content visible, and doing that with a synchronous `setShown(true)` inside
   * an effect is a render whose only purpose is to undo the decision the
   * previous render just made. A ref callback runs in the commit phase and can
   * return its own cleanup in React 19, so the observer's whole lifetime — set
   * up, one-way reveal, teardown — lives in a single function, and the element
   * is never left hidden by an effect that has not run yet.
   */
  const observe = useCallback((el: HTMLDivElement | null) => {
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
      ref={observe}
      className={cx('lp-reveal', className)}
      data-shown={shown ? 'true' : 'false'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Nav                                                                         */
/* -------------------------------------------------------------------------- */

const NAV = [
  { href: '#top', label: 'Home', active: true },
  { href: '#rule', label: 'The rule' },
  { href: '#proof', label: 'Proof' },
  { href: '#policy', label: 'Policy' },
  { href: '#ledger', label: 'Ledger' },
];

export function Nav() {
  return (
    <div className="flex items-center gap-4 px-5 pt-6 sm:gap-6 sm:px-12 sm:pt-7">
      <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="AIRLOCK — home">
        {/* the checkered mark */}
        <span className="grid size-8 shrink-0 place-items-center rounded-[7px] bg-[var(--lp-mark)]">
          <span className="grid grid-cols-3 gap-[2px]">
            {[1, 0, 1, 0, 1, 0, 1, 0, 1].map((on, i) => (
              <span key={i} className={cx('size-[4px] rounded-[1px]', on ? 'bg-white' : 'bg-white/35')} />
            ))}
          </span>
        </span>
        <span className="text-[18px] font-semibold tracking-[0.02em] text-[var(--lp-ink)]">AIRLOCK</span>
      </Link>

      <nav className="lp-nav mx-auto hidden items-center gap-1 p-1.5 lg:flex" aria-label="Sections">
        {NAV.map((item) => (
          <a
            key={item.label}
            href={item.href}
            data-active={item.active ? 'true' : undefined}
            className="px-3.5 py-2 text-[13.5px] text-[var(--lp-ink-2)] hover:text-[var(--lp-ink)]"
          >
            {item.label}
          </a>
        ))}
        <a
          href="https://github.com/Rohit-ATS/Airlock"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3.5 py-2 text-[13.5px] text-[var(--lp-ink-2)] hover:text-[var(--lp-ink)]"
        >
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="6.7" stroke="currentColor" strokeWidth="1.25" />
            <path
              d="M1.4 8h13.2M8 1.3c1.75 1.85 2.7 4.1 2.7 6.7s-.95 4.85-2.7 6.7C6.25 12.85 5.3 10.6 5.3 8s.95-4.85 2.7-6.7Z"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
          Source
        </a>
      </nav>

      {/*
        Two labels, because at 390px the long one did not fit and the plate's
        `overflow-hidden` sliced the button in half rather than scrolling — so
        the page looked broken on a phone while reporting zero horizontal
        overflow, which is why it survived this long.
      */}
      <Link
        href="/console"
        className="ml-auto shrink-0 rounded-[8px] bg-[var(--lp-signal)] px-5 py-2.5 text-[14.5px] font-semibold text-[var(--color-void)] transition-[filter] hover:brightness-110 sm:px-7 sm:py-3 sm:text-[15px] lg:ml-0"
      >
        <span className="sm:hidden">Console</span>
        <span className="hidden sm:inline">Open the console</span>
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Section shell used down the page                                            */
/* -------------------------------------------------------------------------- */

/**
 * The section shell.
 *
 * WHAT CHANGED, AND WHY IT WAS WORTH CHANGING
 *
 * Every section used to be the same object: a rounded grey plate with a
 * diagonal gradient and a drop shadow, carrying a 190px sticky column on the
 * left that held two words. Three problems, all visible in a screenshot:
 *
 *   - Nine identical plates down a page is not a rhythm, it is a list. Nothing
 *     told the reader that §03 is a thing they can operate and §05 is a table
 *     they can read.
 *   - The sticky column cost 190px of every row to carry "The rule", and the
 *     title beside it was capped at 18ch — so the widest part of the page was
 *     empty and the narrowest part was the headline.
 *   - Shadows. Instrument's third rule is that depth comes from hairlines and
 *     background steps, because none of these surfaces are floating in space.
 *
 * Now: the index and label run across the top as a legend with a rule fading
 * out of it — the same voice the console's panel legends use — and the title
 * and lede sit side by side beneath it, so the measure is right for both. The
 * `deep` variant drops one surface step into the void instead of inverting the
 * palette, which is what "you have stopped reading and started operating this"
 * has to mean now that the whole page is dark.
 */
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
  /** Kept as `dark` because call sites name it; it now means "one step deeper". */
  dark?: boolean;
}) {
  return (
    <section id={id} className="px-4 pb-4 sm:px-7 sm:pb-7">
      <div className={cx(dark ? 'lp-deep' : 'lp-card', 'lp-atmos lp-lit relative overflow-hidden px-6 py-14 sm:px-10 md:py-16')}>
        {dark ? <div className="lp-grid-layer" aria-hidden /> : null}
        {index || label ? (
          <div className="flex items-center gap-4">
            {index ? <span className="lp-legend text-[var(--lp-signal)]">{index}</span> : null}
            {label ? <span className="lp-legend">{label}</span> : null}
            <span className="lp-rule min-w-8 flex-1" aria-hidden />
          </div>
        ) : null}

        {title || lede ? (
          <div className="mt-8 grid gap-y-6 lg:grid-cols-12 lg:gap-x-12">
            {title ? (
              <div className="lg:col-span-7">
                <Reveal>
                  <h2 className="lp-display max-w-[20ch] text-[clamp(1.85rem,3.9vw,3.1rem)] text-[var(--lp-ink)]">
                    {title}
                  </h2>
                </Reveal>
              </div>
            ) : null}
            {lede ? (
              <div className={cx('lg:col-span-5 lg:pt-2', !title && 'lg:col-start-1')}>
                <Reveal delay={80}>
                  <div className="max-w-[58ch] text-[15px] leading-[1.6] text-[var(--lp-ink-2)]">{lede}</div>
                </Reveal>
              </div>
            ) : null}
          </div>
        ) : null}

        {children ? <div className={title || lede ? 'mt-12' : ''}>{children}</div> : null}
      </div>
    </section>
  );
}

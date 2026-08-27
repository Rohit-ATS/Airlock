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

export function Drift({
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
    <div className="flex items-center gap-6 px-8 pt-7 sm:px-12">
      <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="AIRLOCK — home">
        {/* the checkered mark */}
        <span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-[var(--lp-orange-b)]">
          <span className="grid grid-cols-3 gap-[2px]">
            {[1, 0, 1, 0, 1, 0, 1, 0, 1].map((on, i) => (
              <span key={i} className={cx('size-[4px] rounded-[1px]', on ? 'bg-white' : 'bg-white/35')} />
            ))}
          </span>
        </span>
        <span className="text-[21px] font-semibold tracking-[-0.02em] text-[var(--lp-ink)]">AIRLOCK</span>
      </Link>

      <nav className="lp-nav mx-auto hidden items-center gap-1 p-1.5 lg:flex" aria-label="Sections">
        {NAV.map((item) => (
          <a
            key={item.label}
            href={item.href}
            data-active={item.active ? 'true' : undefined}
            className="px-5 py-2.5 text-[16px] text-[var(--lp-ink)]"
          >
            {item.label}
          </a>
        ))}
        <a
          href="https://github.com/Rohit-ATS/Airlock"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-5 py-2.5 text-[16px] text-[var(--lp-ink)]"
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

      <Link
        href="/console"
        className="ml-auto shrink-0 rounded-[11px] bg-[var(--lp-black)] px-8 py-4 text-[16px] font-medium text-white transition-transform hover:scale-[1.02] lg:ml-0"
      >
        Open the console
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
    <section id={id} className="px-4 pb-4 sm:px-7 sm:pb-7">
      <div className={cx('lp-card px-8 py-16 sm:px-12 md:py-24', dark && '!bg-[var(--lp-void)] text-[var(--lp-pale)]')}>
        <div className="grid gap-y-10 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-x-14">
          <div className="lg:sticky lg:top-8 lg:self-start">
            {index ? (
              <div className={cx('lp-mono text-[13px]', dark ? 'text-[var(--lp-pale-3)]' : 'text-[var(--lp-ink-2)]')}>
                {index}
              </div>
            ) : null}
            {label ? (
              <div
                className={cx(
                  'mt-2 text-[15px] font-medium',
                  dark ? 'text-[var(--lp-pale-2)]' : 'text-[var(--lp-ink-2)]',
                )}
              >
                {label}
              </div>
            ) : null}
          </div>

          <div>
            {title ? (
              <Reveal>
                <h2
                  className={cx(
                    'lp-display max-w-[18ch] text-[clamp(1.9rem,4.2vw,3.4rem)]',
                    dark ? 'text-[var(--lp-pale)]' : 'text-[var(--lp-ink)]',
                  )}
                >
                  {title}
                </h2>
              </Reveal>
            ) : null}
            {lede ? (
              <Reveal delay={80}>
                <div
                  className={cx(
                    'mt-6 max-w-[62ch] text-[16px] leading-[1.55]',
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

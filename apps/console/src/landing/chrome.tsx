'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/design/primitives';
import { Mark } from '@/console/Mark';

/**
 * Landing page chrome.
 *
 * The page is laid out as a specification document — numbered sections, a rail
 * that tells you where you are, hairlines instead of cards. That is not a
 * stylistic whim: AIRLOCK's argument is that a change should arrive as a
 * document you can check, so the page that makes the argument is one too.
 */

/* -------------------------------------------------------------------------- */
/* Reveal                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Show an element once it has been scrolled to, and then leave it alone.
 *
 * Deliberately one-way: an element that re-animates every time it re-enters the
 * viewport is a page that will not sit still while you read it.
 */
export function Reveal({
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
    // Without IntersectionObserver — or before hydration on a slow device —
    // content must still be readable, so the fallback is "shown".
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cx('reveal', className)}
      data-shown={shown ? 'true' : 'false'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

export interface SectionSpec {
  id: string;
  index: string;
  label: string;
}

export const SECTIONS: SectionSpec[] = [
  { id: 'rule', index: '01', label: 'The rule' },
  { id: 'gate', index: '02', label: 'Try the gate' },
  { id: 'certificates', index: '03', label: 'Two certificates' },
  { id: 'classes', index: '04', label: 'What it governs' },
  { id: 'policy', index: '05', label: 'Policy' },
  { id: 'harness', index: '06', label: 'The harness' },
  { id: 'ledger', index: '07', label: 'The ledger' },
  { id: 'build', index: '08', label: 'How it is built' },
];

export function Section({
  spec,
  title,
  standfirst,
  children,
  className,
}: {
  spec: SectionSpec;
  title: ReactNode;
  standfirst?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={spec.id} className={cx('border-t border-hairline px-5 py-20 sm:px-8 md:py-28', className)}>
      <div className="mx-auto max-w-[1160px]">
        <Reveal>
          <div className="flex items-baseline gap-3">
            <span className="evidence text-[11px] text-ice">§{spec.index}</span>
            <span className="legend">{spec.label}</span>
          </div>
          <h2 className="subhead mt-4 max-w-[24ch] text-ink">{title}</h2>
          {standfirst ? <div className="lede mt-4 max-w-[70ch]">{standfirst}</div> : null}
        </Reveal>
        <div className="mt-10 md:mt-12">{children}</div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

/** Which section is currently under the reader. Drives the rail and nothing else. */
export function useActiveSection(): string {
  const [active, setActive] = useState(SECTIONS[0]!.id);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        // The topmost intersecting section wins, so scrolling up and down
        // through a tall section does not flicker between two neighbours.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first?.target.id) setActive(first.target.id);
      },
      { rootMargin: '-18% 0px -60% 0px', threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return active;
}

export function SectionRail() {
  const active = useActiveSection();
  return (
    <nav
      aria-label="Sections"
      className="pointer-events-none fixed top-1/2 left-5 z-30 hidden -translate-y-1/2 xl:block"
    >
      <ul className="pointer-events-auto space-y-1">
        {SECTIONS.map((s) => {
          const on = active === s.id;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="group flex items-center gap-2.5 py-[3px]"
                aria-current={on ? 'true' : undefined}
              >
                <span
                  className={cx(
                    'h-px transition-all duration-300',
                    on ? 'w-6 bg-ice' : 'w-3 bg-hairline-3 group-hover:w-5 group-hover:bg-ink-3',
                  )}
                />
                <span
                  className={cx(
                    'evidence text-[10px] transition-colors',
                    on ? 'text-ice' : 'text-ink-4 group-hover:text-ink-3',
                  )}
                >
                  {s.index}
                </span>
                <span
                  className={cx(
                    'text-[10.5px] transition-all duration-300',
                    on ? 'text-ink-2 opacity-100' : 'text-ink-4 opacity-0 group-hover:opacity-100',
                  )}
                >
                  {s.label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function TopNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cx(
        'fixed inset-x-0 top-0 z-40 transition-colors duration-300',
        scrolled ? 'border-b border-hairline bg-void/85 backdrop-blur-md' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-14 max-w-[1160px] items-center gap-3 px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2 text-ink">
          <Mark size={17} />
          <span className="text-[13px] font-semibold tracking-[0.22em] select-none">AIRLOCK</span>
        </Link>

        <div className="flex-1" />

        <a
          href="https://github.com/Rohit-ATS/Airlock"
          target="_blank"
          rel="noreferrer"
          className="hidden text-[12px] text-ink-2 transition-colors hover:text-ink sm:block"
        >
          Source
        </a>
        <Link
          href="/control"
          className="hidden text-[12px] text-ink-2 transition-colors hover:text-ink sm:block"
        >
          Control room
        </Link>
        <Link
          href="/console"
          className="inline-flex h-8 items-center rounded-[4px] border border-ice-dim bg-ice-bg px-3 text-[12px] font-medium text-ice transition-colors hover:bg-ice-deep"
        >
          Open the console
        </Link>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Small shared pieces                                                         */
/* -------------------------------------------------------------------------- */

/** A block of code, set as evidence rather than as decoration. */
export function Code({ children, caption }: { children: string; caption?: string }) {
  return (
    <figure className="overflow-hidden rounded-[6px] border border-hairline bg-void">
      {caption ? (
        <figcaption className="border-b border-hairline px-3 py-1.5">
          <span className="evidence text-[10px] text-ink-4">{caption}</span>
        </figcaption>
      ) : null}
      <pre className="scroll-thin overflow-x-auto px-3.5 py-3">
        <code className="evidence text-[11.5px] leading-relaxed text-ink-2">{children}</code>
      </pre>
    </figure>
  );
}

/** A labelled figure: big number, small caption. Used across the hero and the room. */
export function Stat({
  value,
  label,
  tone = 'ink',
  sub,
}: {
  value: ReactNode;
  label: string;
  tone?: 'ink' | 'ice' | 'seal' | 'hazard' | 'fault';
  sub?: string;
}) {
  const tones = {
    ink: 'text-ink',
    ice: 'text-ice',
    seal: 'text-seal',
    hazard: 'text-hazard',
    fault: 'text-fault',
  } as const;
  return (
    <div>
      <div className={cx('evidence text-[clamp(20px,2.6vw,30px)] leading-none font-medium', tones[tone])}>
        {value}
      </div>
      <div className="legend mt-2">{label}</div>
      {sub ? <div className="mt-1 text-[10.5px] leading-snug text-ink-4">{sub}</div> : null}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-hairline px-5 py-14 sm:px-8">
      <div className="mx-auto max-w-[1160px]">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[46ch]">
            <div className="flex items-center gap-2 text-ink">
              <Mark size={17} />
              <span className="text-[13px] font-semibold tracking-[0.22em]">AIRLOCK</span>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
              Built for the TrueForge Agent Harness Hackathon, 24–30 August 2026. TrueFoundry&rsquo;s brief closed
              with <em className="text-ink-2 not-italic">&ldquo;build the agent you would trust with root.&rdquo;</em>{' '}
              AIRLOCK is the literal answer: an agent that behaves as though it is not trusted with root, and proves
              it every time.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3">
            <FooterColumn
              title="Product"
              links={[
                { href: '/console', label: 'The console' },
                { href: '/control', label: 'Control room' },
                { href: '#gate', label: 'Try the gate' },
              ]}
            />
            <FooterColumn
              title="Read"
              links={[
                { href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/POLICY.md', label: 'Policy', external: true },
                {
                  href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/CAPABILITIES.md',
                  label: 'Capabilities',
                  external: true,
                },
                {
                  href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/TRUEFORGE-NOTES.md',
                  label: 'Harness notes',
                  external: true,
                },
              ]}
            />
            <FooterColumn
              title="Source"
              links={[
                { href: 'https://github.com/Rohit-ATS/Airlock', label: 'Repository', external: true },
                {
                  href: 'https://github.com/Rohit-ATS/Airlock/blob/main/packages/contract/src/gate.ts',
                  label: 'gate.ts',
                  external: true,
                },
                {
                  href: 'https://github.com/Rohit-ATS/Airlock/blob/main/packages/mcp/src/tools.ts',
                  label: 'The MCP doorway',
                  external: true,
                },
              ]}
            />
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-hairline pt-6 text-[11px] text-ink-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p>
              <span className="text-ink-3">Rohit Maruri</span> — console, gate, contract, policy, harness panel,
              agents and skills.
            </p>
            <p>
              <span className="text-ink-3">Damir Mertl</span> — shadow verifier, checksum proof flow, generated
              dossiers, automated verifier checks, seed data, and the next shadow-branch and scope-computation work.
            </p>
          </div>
          <p className="evidence">MIT</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string; external?: boolean }>;
}) {
  return (
    <div>
      <div className="legend">{title}</div>
      <ul className="mt-3 space-y-1.5">
        {links.map((l) => (
          <li key={l.href + l.label}>
            {l.external ? (
              <a
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-ink-2 transition-colors hover:text-ice"
              >
                {l.label}
              </a>
            ) : (
              <Link href={l.href} className="text-[12px] text-ink-2 transition-colors hover:text-ice">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

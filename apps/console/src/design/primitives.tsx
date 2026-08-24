/**
 * AIRLOCK design primitives.
 *
 * Small, unopinionated pieces that encode the three system rules so callers
 * cannot accidentally break them:
 *   - `Evidence` is the only way to render a verifiable number.
 *   - `Lamp` is the only way to render capability state.
 *   - `hazard` tone is available on exactly one component, `Verdict`.
 */
import type { ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

/** A panel legend: small, uppercase, tracked. Never a heading tag by default. */
export function Legend({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('legend', className)}>{children}</div>;
}

/**
 * A number a judge might verify. Always mono, always tabular.
 * Using this instead of raw text is what keeps columns of hashes and row counts
 * aligned, and stops a live-updating cost from shifting the layout.
 */
export function Evidence({
  children,
  className,
  dim,
  size = 'sm',
}: {
  children: ReactNode;
  className?: string;
  dim?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}) {
  const sizes = { xs: 'text-[10px]', sm: 'text-[11.5px]', md: 'text-[13px]', lg: 'text-[15px]' } as const;
  return (
    <span className={cx('evidence', sizes[size], dim && 'text-ink-3', className)}>{children}</span>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

export function Panel({
  children,
  className,
  milled = true,
}: {
  children: ReactNode;
  className?: string;
  milled?: boolean;
}) {
  return <div className={cx('panel', milled && 'milled', className)}>{children}</div>;
}

/** A titled section inside a zone. The legend row is fixed height so stacked
 *  sections align across columns even when their titles differ in length. */
export function Section({
  label,
  right,
  children,
  className,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('flex min-h-0 flex-col', className)}>
      <header className="flex h-8 shrink-0 items-center justify-between gap-3 px-3">
        <Legend>{label}</Legend>
        {right}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'ice' | 'seal' | 'hazard' | 'fault';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-2',
  ice: 'text-ice',
  seal: 'text-seal',
  hazard: 'text-hazard',
  fault: 'text-fault',
};

const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-hairline-2 bg-raised-2 text-ink-2',
  ice: 'border-ice-dim/45 bg-ice-bg text-ice',
  seal: 'border-seal/35 bg-seal-bg text-seal',
  hazard: 'border-hazard/40 bg-hazard-bg text-hazard',
  fault: 'border-fault/40 bg-fault-bg text-fault',
};

export function Chip({
  children,
  tone = 'neutral',
  mono,
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  mono?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-[3px] text-[10.5px] leading-none font-medium whitespace-nowrap',
        TONE_CHIP[tone],
        mono && 'evidence',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small filled dot. `pulse` marks work that is genuinely in flight. */
export function Dot({ tone = 'neutral', pulse }: { tone?: Tone; pulse?: boolean }) {
  const bg: Record<Tone, string> = {
    neutral: 'bg-ink-3',
    ice: 'bg-ice',
    seal: 'bg-seal',
    hazard: 'bg-hazard',
    fault: 'bg-fault',
  };
  return <span className={cx('size-1.5 shrink-0 rounded-full', bg[tone], pulse && 'breathe')} />;
}

/* -------------------------------------------------------------------------- */
/* The lamp                                                                    */
/* -------------------------------------------------------------------------- */

export const LAMP_COLOR: Record<Tone, string> = {
  neutral: 'var(--color-ink-3)',
  ice: 'var(--color-ice)',
  seal: 'var(--color-seal)',
  hazard: 'var(--color-hazard)',
  fault: 'var(--color-fault)',
};

/**
 * The capability indicator.
 *
 * `lit` is driven only by the harness ledger, which is driven only by real
 * events — there is deliberately no way to force one on from a component.
 */
export function Lamp({ lit, fresh, tone = 'ice' }: { lit: boolean; fresh?: boolean; tone?: Tone }) {
  return (
    <span
      className="lamp"
      data-lit={lit ? 'true' : 'false'}
      data-fresh={fresh ? 'true' : 'false'}
      style={{ ['--lamp-color' as string]: LAMP_COLOR[tone] }}
      aria-hidden
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export function Button({
  children,
  onClick,
  tone = 'neutral',
  size = 'md',
  disabled,
  title,
  type = 'button',
  className,
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'neutral' | 'primary' | 'seal' | 'hazard' | 'fault';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
  full?: boolean;
}) {
  const tones = {
    neutral: 'border-hairline-2 bg-raised-2 text-ink hover:bg-raised-3 hover:border-hairline-3',
    primary: 'border-ice-dim bg-ice-bg text-ice hover:bg-ice-deep',
    seal: 'border-seal/45 bg-seal-bg text-seal hover:brightness-125',
    hazard: 'border-hazard/55 bg-hazard-bg text-hazard hover:brightness-125',
    fault: 'border-fault/45 bg-fault-bg text-fault hover:brightness-125',
  } as const;
  const sizes = { sm: 'h-6 px-2 text-[11px]', md: 'h-8 px-3 text-[12px]', lg: 'h-10 px-4 text-[13px]' } as const;
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[4px] border font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-raised-2',
        tones[tone],
        sizes[size],
        full && 'w-full',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout helpers                                                              */
/* -------------------------------------------------------------------------- */

/** A labelled readout: legend on the left, evidence right-aligned. */
export function Readout({
  label,
  children,
  tone,
  title,
}: {
  label: string;
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5" title={title}>
      <span className="legend">{label}</span>
      <span className={cx('evidence text-[12px]', tone ? TONE_TEXT[tone] : 'text-ink')}>{children}</span>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px w-full bg-hairline', className)} />;
}

/** Empty states carry an instruction, never just an apology. */
export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
      <p className="text-[12.5px] text-ink-2">{title}</p>
      {hint ? <p className="max-w-[46ch] text-[11.5px] leading-relaxed text-ink-3">{hint}</p> : null}
    </div>
  );
}

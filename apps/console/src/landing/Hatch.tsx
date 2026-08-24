'use client';

import { cx } from '@/design/primitives';

/**
 * The hatch, drawn as an engineering elevation.
 *
 * Two counter-rotating rings, eight dogs on a bolt circle, a sight glass, and
 * dimension callouts — an object under specification rather than an
 * illustration. It turns very slowly (a full revolution takes about a minute)
 * so the page reads as alive without asking for attention, and it stops dead
 * under `prefers-reduced-motion`.
 *
 * `sealed` is passed in rather than animated on a timer: the mark tells the
 * truth about the door, here and in the console topbar, and a decorative state
 * would undermine the one place the product cannot afford to be decorative.
 */
export function Hatch({ sealed = true, className }: { sealed?: boolean; className?: string }) {
  const accent = sealed ? 'var(--color-hazard)' : 'var(--color-seal)';

  // Eight dogs, evenly spaced, starting at twelve o'clock.
  const dogs = Array.from({ length: 8 }, (_, i) => (i * 360) / 8);
  // Ticks on the outer bezel: a fine scale, heavier every fifth.
  const ticks = Array.from({ length: 60 }, (_, i) => i * 6);

  return (
    <svg
      viewBox="0 0 400 400"
      className={cx('h-full w-full', className)}
      role="img"
      aria-label={sealed ? 'A sealed airlock hatch' : 'An open airlock hatch'}
    >
      <defs>
        <radialGradient id="hatch-face" cx="50%" cy="38%" r="72%">
          <stop offset="0%" stopColor="#161a23" />
          <stop offset="62%" stopColor="#0e1117" />
          <stop offset="100%" stopColor="#07080a" />
        </radialGradient>
        <radialGradient id="hatch-glass" cx="42%" cy="34%" r="78%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.30" />
          <stop offset="55%" stopColor={accent} stopOpacity="0.06" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hatch-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.07" />
        </linearGradient>
      </defs>

      {/* ---- dimension callouts: this is a drawing, not a logo ---- */}
      <g stroke="var(--color-hairline-2)" strokeWidth="1" opacity="0.55">
        <path d="M14 200h34M352 200h34M200 14v34M200 352v34" />
        <path d="M14 194v12M386 194v12M194 14h12M194 386h12" />
      </g>
      <g fill="var(--color-ink-4)" fontFamily="var(--font-mono)" fontSize="8.5" letterSpacing="0.06em">
        <text x="14" y="186">
          Ø 344
        </text>
        <text x="206" y="24">
          PRESSURE BOUNDARY
        </text>
        <text x="206" y="382">
          8 × DOG · SYMMETRIC
        </text>
      </g>

      {/* ---- outer bezel with a fine scale ---- */}
      <g className="hatch-ring">
        {ticks.map((deg, i) => {
          const major = i % 5 === 0;
          return (
            <line
              key={deg}
              x1="200"
              y1={major ? 40 : 44}
              x2="200"
              y2="50"
              stroke={major ? 'var(--color-hairline-3)' : 'var(--color-hairline-2)'}
              strokeWidth={major ? 1.4 : 0.8}
              transform={`rotate(${deg} 200 200)`}
            />
          );
        })}
      </g>

      <circle cx="200" cy="200" r="160" fill="none" stroke="var(--color-hairline-2)" strokeWidth="1" />
      <circle cx="200" cy="200" r="152" fill="none" stroke="var(--color-hairline)" strokeWidth="1" />

      {/* ---- the door face ---- */}
      <circle cx="200" cy="200" r="146" fill="url(#hatch-face)" />
      <circle cx="200" cy="200" r="146" fill="none" stroke="url(#hatch-edge)" strokeWidth="1.5" />

      {/* ---- bolt circle ---- */}
      <circle
        cx="200"
        cy="200"
        r="120"
        fill="none"
        stroke="var(--color-hairline-2)"
        strokeWidth="1"
        strokeDasharray="2 5"
        opacity="0.75"
      />

      {/* ---- the dogs that hold it shut ---- */}
      <g className="hatch-ring-reverse">
        {dogs.map((deg) => (
          <g key={deg} transform={`rotate(${deg} 200 200)`}>
            <rect
              x="192"
              y="70"
              width="16"
              height="26"
              rx="3"
              fill="var(--color-raised-2)"
              stroke="var(--color-hairline-3)"
              strokeWidth="1"
            />
            <circle cx="200" cy="83" r="3.2" fill={sealed ? accent : 'var(--color-ink-4)'} opacity={sealed ? 0.9 : 0.5} />
          </g>
        ))}
      </g>

      {/* ---- inner ring: the moving part ---- */}
      <circle cx="200" cy="200" r="96" fill="none" stroke="var(--color-hairline-2)" strokeWidth="1.5" />
      <g className="hatch-ring">
        <circle
          cx="200"
          cy="200"
          r="88"
          fill="none"
          stroke="var(--color-hairline-3)"
          strokeWidth="1"
          strokeDasharray="26 12"
          opacity="0.8"
        />
      </g>

      {/* ---- the seam: the one place the alarm colour is allowed ---- */}
      <g strokeLinecap="round" strokeWidth="2.5">
        <path d="M54 200h60M286 200h60" stroke={accent} opacity={sealed ? 0.85 : 0.35} />
      </g>

      {/* ---- sight glass ---- */}
      <circle cx="200" cy="200" r="58" fill="url(#hatch-glass)" />
      <circle cx="200" cy="200" r="58" fill="none" stroke="var(--color-hairline-3)" strokeWidth="1.5" />
      <circle
        cx="200"
        cy="200"
        r="52"
        fill="none"
        stroke={accent}
        strokeWidth="1"
        opacity="0.35"
        className="seal-pressure"
      />

      {/* ---- crosshair, broken at the centre ---- */}
      <g stroke="var(--color-hairline-3)" strokeWidth="1" opacity="0.6">
        <path d="M200 152v22M200 226v22M152 200h22M226 200h22" />
      </g>

      {/* ---- state readout, inside the glass ---- */}
      <text
        x="200"
        y="197"
        textAnchor="middle"
        fill={accent}
        fontFamily="var(--font-mono)"
        fontSize="11"
        fontWeight="600"
        letterSpacing="0.18em"
      >
        {sealed ? 'SEALED' : 'OPEN'}
      </text>
      <text
        x="200"
        y="213"
        textAnchor="middle"
        fill="var(--color-ink-2)"
        fontFamily="var(--font-mono)"
        fontSize="8.5"
        letterSpacing="0.12em"
        opacity="0.85"
      >
        {sealed ? 'NO CERTIFICATE' : 'PROOF ACCEPTED'}
      </text>
    </svg>
  );
}

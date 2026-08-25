'use client';

/**
 * The centre object.
 *
 * A retro terminal in three-quarter view, drawn in SVG with layered gradients
 * rather than rendered — no asset to load, sharp at any size, and themeable
 * from the same tokens as the rest of the page.
 *
 * The screen is the one place this departs from decoration: it shows a
 * certificate mid-verification, with the three checksums and the match. The
 * object on a landing page should be the thing the product makes, and for
 * AIRLOCK that is a proof.
 */
export function Machine({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 600" className={className} role="img" aria-label="A terminal showing a verified certificate">
      <defs>
        {/* Front face: lit from the upper left. */}
        <linearGradient id="m-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2a054" />
          <stop offset="0.45" stopColor="#e2812f" />
          <stop offset="1" stopColor="#c96a1e" />
        </linearGradient>
        {/* Right cheek: the shadowed side. */}
        <linearGradient id="m-side" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#c0651c" />
          <stop offset="1" stopColor="#9c4d12" />
        </linearGradient>
        {/* Top bevel. */}
        <linearGradient id="m-top" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#f8b877" />
          <stop offset="1" stopColor="#e08b3c" />
        </linearGradient>
        {/* Keyboard slab. */}
        <linearGradient id="m-deck" x1="0.1" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#f0f0ee" />
          <stop offset="1" stopColor="#cfcfcb" />
        </linearGradient>
        <linearGradient id="m-deck-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b9b9b4" />
          <stop offset="1" stopColor="#9b9b96" />
        </linearGradient>
        {/* The screen well. */}
        <linearGradient id="m-glass" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#8fa3ab" />
          <stop offset="1" stopColor="#6d838d" />
        </linearGradient>
        <radialGradient id="m-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Contact shadow on the ground. */}
      <ellipse cx="262" cy="520" rx="185" ry="34" fill="url(#m-shadow)" />

      {/* ---- monitor ------------------------------------------------------ */}
      <g>
        {/* right cheek */}
        <path d="M392 118 L436 146 L436 356 L392 336 Z" fill="url(#m-side)" />
        {/* top bevel */}
        <path d="M118 100 L392 118 L436 146 L162 128 Z" fill="url(#m-top)" />
        {/* front face */}
        <path d="M118 100 L392 118 L392 336 L118 322 Z" fill="url(#m-face)" />

        {/* screen well */}
        <path d="M146 132 L364 146 L364 296 L146 284 Z" fill="#a7591b" opacity="0.55" />
        <path d="M152 138 L358 151 L358 291 L152 279 Z" fill="url(#m-glass)" />

        {/* the certificate on screen */}
        <g opacity="0.95">
          <path d="M196 160 L316 168 L316 268 L196 260 Z" fill="#f7f6f2" />
          {/* heading rule */}
          <rect x="206" y="172" width="62" height="5" rx="2" fill="#c96a1e" transform="rotate(0.4 206 172)" />
          {/* the three checksums */}
          {[188, 200, 212].map((y, i) => (
            <g key={y}>
              <rect x="206" y={y} width="84" height="3" rx="1.5" fill={i === 2 ? '#2f8f6b' : '#9aa0a6'} />
              <rect x="294" y={y} width="12" height="3" rx="1.5" fill={i === 2 ? '#2f8f6b' : '#c9ccd0'} />
            </g>
          ))}
          {/* the match line */}
          <rect x="206" y="228" width="46" height="4" rx="2" fill="#2f8f6b" />
          {[240, 249].map((y) => (
            <rect key={y} x="206" y={y} width="96" height="3" rx="1.5" fill="#c9ccd0" />
          ))}
        </g>

        {/* vent on the right of the face */}
        <path d="M376 196 L386 202 L386 250 L376 244 Z" fill="#a7591b" opacity="0.5" />
        {/* power dot */}
        <circle cx="136" cy="306" r="5" fill="#2f8f6b" />
      </g>

      {/* ---- deck / keyboard ---------------------------------------------- */}
      <g>
        <path d="M104 322 L392 336 L446 372 L158 358 Z" fill="url(#m-deck)" />
        <path d="M104 322 L158 358 L158 392 L104 356 Z" fill="url(#m-deck-side)" />
        <path d="M158 358 L446 372 L446 406 L158 392 Z" fill="#dedeD9" />
        <path d="M446 372 L446 406 L392 370 L392 336 Z" fill="url(#m-side)" opacity="0.5" />

        {/* keys */}
        {Array.from({ length: 5 }).map((_, row) =>
          Array.from({ length: 14 }).map((__, col) => (
            <rect
              key={`${row}-${col}`}
              x={132 + col * 21 + row * 5.5}
              y={330 + row * 8}
              width="16"
              height="5.5"
              rx="1.6"
              fill="#ffffff"
              opacity={0.9 - row * 0.06}
            />
          )),
        )}
      </g>

      {/* ---- the cable, and the little companion on the end ---------------- */}
      <path
        d="M446 396 C 470 430, 462 470, 430 486"
        fill="none"
        stroke="#2a2a2a"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <g className="lp-drift" style={{ ['--lp-dur' as string]: '6.5s', ['--lp-delay' as string]: '0.4s' }}>
        <circle cx="412" cy="494" r="30" fill="#e2812f" />
        <circle cx="412" cy="494" r="30" fill="url(#m-face)" opacity="0.6" />
        <circle cx="402" cy="488" r="3.6" fill="#1c1c1c" />
        <circle cx="422" cy="489" r="3.6" fill="#1c1c1c" />
        <path d="M401 502 q11 9 22 0" fill="none" stroke="#1c1c1c" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* The props that orbit it                                                     */
/* -------------------------------------------------------------------------- */

/** A sticky note with a face on it. */
export function PropNote({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <defs>
        <linearGradient id="p-note" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7b95f" />
          <stop offset="1" stopColor="#e59227" />
        </linearGradient>
      </defs>
      <rect x="10" y="12" width="80" height="76" rx="8" fill="url(#p-note)" />
      <circle cx="36" cy="44" r="4.5" fill="#1c1c1c" />
      <circle cx="64" cy="44" r="4.5" fill="#1c1c1c" />
      <path d="M34 62 q16 13 32 0" fill="none" stroke="#1c1c1c" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** An envelope. */
export function PropMail({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 90" className={className} aria-hidden>
      <defs>
        <linearGradient id="p-mail" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#f9c877" />
          <stop offset="1" stopColor="#e9a23f" />
        </linearGradient>
      </defs>
      <rect x="4" y="8" width="112" height="76" rx="9" fill="url(#p-mail)" />
      <path d="M10 16 L60 54 L110 16" fill="none" stroke="#c47c1e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A small camera. */
export function PropCamera({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 110" className={className} aria-hidden>
      <defs>
        <linearGradient id="p-cam" x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#e2543a" />
          <stop offset="1" stopColor="#b3341f" />
        </linearGradient>
      </defs>
      <rect x="34" y="8" width="34" height="16" rx="5" fill="#a52c1a" />
      <rect x="8" y="22" width="104" height="76" rx="14" fill="url(#p-cam)" />
      <circle cx="60" cy="60" r="26" fill="#2a2a2a" />
      <circle cx="60" cy="60" r="16" fill="#4a5560" />
      <circle cx="53" cy="53" r="5" fill="#cfe0e8" opacity="0.85" />
      <circle cx="96" cy="36" r="5" fill="#f7b95f" />
    </svg>
  );
}

/** A half-torus arch. */
export function PropArch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 70" className={className} aria-hidden>
      <path d="M12 66 a48 48 0 0 1 96 0 h-22 a26 26 0 0 0 -52 0 Z" fill="#efeeea" />
      <path d="M86 66 h22 a48 48 0 0 0 -13 -33 l-16 15 a26 26 0 0 1 7 18 Z" fill="#cfcec9" />
    </svg>
  );
}

/** A flat ring lying at an angle. */
export function PropRing({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 60" className={className} aria-hidden>
      <ellipse cx="70" cy="30" rx="62" ry="22" fill="none" stroke="#e2812f" strokeWidth="12" />
      <ellipse cx="70" cy="26" rx="62" ry="22" fill="none" stroke="#f6ab63" strokeWidth="4" opacity="0.7" />
    </svg>
  );
}

/** A pebble. */
export function PropPebble({ className, tone = '#b7b5b0' }: { className?: string; tone?: string }) {
  return (
    <svg viewBox="0 0 60 50" className={className} aria-hidden>
      <ellipse cx="30" cy="26" rx="26" ry="21" fill={tone} />
      <ellipse cx="23" cy="19" rx="10" ry="7" fill="#fff" opacity="0.28" />
    </svg>
  );
}

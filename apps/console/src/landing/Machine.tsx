'use client';

/**
 * The centre object: a retro all-in-one terminal, floating.
 *
 * Drawn in SVG rather than rendered, so there is no asset to load and it stays
 * sharp at any size. The geometry is a simple axonometric box — the whole
 * assembly is rotated once at the group level, and each face is a flat polygon
 * with its own gradient, which is enough to read as solid without any of the
 * cost of a real 3D pipeline.
 *
 * The screen is the one part that is not decoration: it shows a certificate
 * mid-verification, with three checksums and the match line. The object on the
 * front of a product should be the thing the product makes.
 */
export function Machine({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 900 900"
      className={className}
      role="img"
      aria-label="A terminal displaying a verified certificate"
    >
      <defs>
        {/* Front of the monitor — lit from the upper left. */}
        <linearGradient id="mc-front" x1="0.1" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#ffa652" />
          <stop offset="0.4" stopColor="#f68a2c" />
          <stop offset="1" stopColor="#e0721b" />
        </linearGradient>
        {/* Right cheek, in shadow. */}
        <linearGradient id="mc-side" x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#d2681a" />
          <stop offset="1" stopColor="#a94f0f" />
        </linearGradient>
        {/* Top bevel, catching the most light. */}
        <linearGradient id="mc-top" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ffc182" />
          <stop offset="1" stopColor="#f79640" />
        </linearGradient>
        {/* The keyboard deck. */}
        <linearGradient id="mc-deck" x1="0.1" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#fbfbfa" />
          <stop offset="1" stopColor="#d8d8d4" />
        </linearGradient>
        <linearGradient id="mc-deck-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9c9c4" />
          <stop offset="1" stopColor="#a6a6a1" />
        </linearGradient>
        {/* The glass. */}
        <linearGradient id="mc-glass" x1="0.1" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#a9bcc4" />
          <stop offset="0.55" stopColor="#8ba2ac" />
          <stop offset="1" stopColor="#71888f" />
        </linearGradient>
        <linearGradient id="mc-ball" x1="0.25" y1="0.15" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffb567" />
          <stop offset="1" stopColor="#e0721b" />
        </linearGradient>
        <radialGradient id="mc-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#5a5a58" stopOpacity="0.34" />
          <stop offset="1" stopColor="#5a5a58" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ground contact. */}
      <ellipse cx="450" cy="812" rx="250" ry="42" fill="url(#mc-shadow)" />

      {/* The whole assembly leans back and to the left. */}
      <g transform="rotate(-9 450 430)">
        {/* ---- monitor -------------------------------------------------- */}
        {/* right cheek */}
        <path d="M628 176 L706 232 L706 556 L628 512 Z" fill="url(#mc-side)" />
        {/* top bevel */}
        <path d="M232 150 L628 176 L706 232 L306 204 Z" fill="url(#mc-top)" />
        {/* front face */}
        <path d="M232 150 L628 176 L628 512 L232 486 Z" fill="url(#mc-front)" />

        {/* screen recess */}
        <path d="M272 196 L590 219 L590 434 L272 412 Z" fill="#b25a12" opacity="0.5" />
        {/* the glass */}
        <path d="M282 206 L580 227 L580 425 L282 404 Z" fill="url(#mc-glass)" />
        {/* a soft reflection across the glass */}
        <path d="M282 206 L580 227 L580 268 L282 300 Z" fill="#ffffff" opacity="0.12" />

        {/* ---- what is on the screen: a certificate ---------------------- */}
        <g>
          <path d="M348 244 L520 256 L520 396 L348 385 Z" fill="#f8f7f3" />
          {/* title rule */}
          <rect x="362" y="260" width="86" height="7" rx="3" fill="#e0721b" />
          {/* the three checksums; the third matches the first */}
          {[286, 302, 318].map((y, i) => (
            <g key={y}>
              <rect x="362" y={y} width="120" height="4.5" rx="2" fill={i === 2 ? '#2f8f6b' : '#a8adb4'} />
              <rect x="488" y={y + 0.6} width="18" height="4.5" rx="2" fill={i === 2 ? '#2f8f6b' : '#cdd1d5'} />
            </g>
          ))}
          {/* the match */}
          <rect x="362" y="342" width="62" height="6" rx="3" fill="#2f8f6b" />
          {[360, 372].map((y) => (
            <rect key={y} x="362" y={y} width="134" height="4" rx="2" fill="#d4d7da" />
          ))}
        </g>

        {/* speaker grille on the right of the face */}
        <path d="M602 300 L618 310 L618 392 L602 382 Z" fill="#b25a12" opacity="0.45" />
        {/* status lamp */}
        <circle cx="256" cy="462" r="8" fill="#2f8f6b" />

        {/* ---- deck ------------------------------------------------------ */}
        {/* top surface of the keyboard slab */}
        <path d="M204 486 L628 512 L718 588 L294 562 Z" fill="url(#mc-deck)" />
        {/* front lip */}
        <path d="M294 562 L718 588 L718 630 L294 604 Z" fill="url(#mc-deck-edge)" />
        {/* left cheek of the slab */}
        <path d="M204 486 L294 562 L294 604 L204 528 Z" fill="#b7b7b2" />
        {/* the wedge the whole thing stands on */}
        <path d="M628 512 L718 588 L718 664 L628 592 Z" fill="url(#mc-side)" />
        <path d="M294 604 L718 630 L718 664 L294 638 Z" fill="#e0721b" opacity="0.9" />

        {/* keys — five staggered rows */}
        {Array.from({ length: 5 }).map((_, row) =>
          Array.from({ length: 15 }).map((__, col) => (
            <rect
              key={`${row}-${col}`}
              x={244 + col * 27 + row * 17}
              y={496 + row * 15}
              width="21"
              height="9"
              rx="2.5"
              fill="#ffffff"
              opacity={0.96 - row * 0.05}
            />
          )),
        )}
        {/* space bar */}
        <rect x="404" y="571" width="150" height="10" rx="3" fill="#ffffff" opacity="0.8" />
      </g>

      {/* ---- cable, and the companion on the end ------------------------- */}
      <path
        d="M712 646 C 772 700, 762 770, 706 792"
        fill="none"
        stroke="#26262a"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <g className="lp-drift" style={{ ['--lp-dur' as string]: '6s', ['--lp-delay' as string]: '0.5s' }}>
        <circle cx="676" cy="800" r="46" fill="url(#mc-ball)" />
        <ellipse cx="660" cy="784" rx="15" ry="11" fill="#ffffff" opacity="0.35" />
        <circle cx="661" cy="793" r="5.5" fill="#26262a" />
        <circle cx="691" cy="795" r="5.5" fill="#26262a" />
        <path d="M659 812 q17 14 34 0" fill="none" stroke="#26262a" strokeWidth="4.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* The props that orbit it                                                     */
/* -------------------------------------------------------------------------- */

export function PropNote({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 110 100" className={className} aria-hidden>
      <defs>
        <linearGradient id="pn" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#f0a32e" />
        </linearGradient>
      </defs>
      <rect x="8" y="14" width="94" height="78" rx="7" fill="url(#pn)" transform="rotate(-6 55 53)" />
      <circle cx="40" cy="46" r="5" fill="#26262a" />
      <circle cx="72" cy="43" r="5" fill="#26262a" />
      <path d="M38 66 q17 13 34 -3" fill="none" stroke="#26262a" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="88" cy="20" r="4" fill="#c8801d" />
    </svg>
  );
}

export function PropMail({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 104" className={className} aria-hidden>
      <defs>
        <linearGradient id="pm" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#ffd996" />
          <stop offset="1" stopColor="#f2ac4a" />
        </linearGradient>
        <linearGradient id="pm2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe4b0" />
          <stop offset="1" stopColor="#f6bd68" />
        </linearGradient>
      </defs>
      <rect x="6" y="10" width="128" height="86" rx="10" fill="url(#pm)" />
      <path d="M12 18 L70 62 L128 18 L128 30 L70 74 L12 30 Z" fill="url(#pm2)" />
    </svg>
  );
}

export function PropCamera({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 130 122" className={className} aria-hidden>
      <defs>
        <linearGradient id="pc" x1="0.1" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ef6a4c" />
          <stop offset="1" stopColor="#b32c17" />
        </linearGradient>
        <linearGradient id="pc2" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#c8391f" />
          <stop offset="1" stopColor="#8f2211" />
        </linearGradient>
      </defs>
      <rect x="40" y="6" width="40" height="20" rx="6" fill="#a52a15" />
      <rect x="10" y="24" width="98" height="84" rx="15" fill="url(#pc)" />
      <path d="M108 32 L120 44 L120 100 L108 108 Z" fill="url(#pc2)" />
      <circle cx="59" cy="66" r="29" fill="#2a2a2c" />
      <circle cx="59" cy="66" r="19" fill="#4d5b66" />
      <circle cx="59" cy="66" r="10" fill="#1c2228" />
      <circle cx="51" cy="58" r="6" fill="#dff0f7" opacity="0.9" />
      <circle cx="95" cy="40" r="6" fill="#ffd27a" />
    </svg>
  );
}

export function PropArch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 130 78" className={className} aria-hidden>
      <path d="M10 74 a52 52 0 0 1 104 0 h-26 a26 26 0 0 0 -52 0 Z" fill="#f4f3f1" />
      <path d="M88 74 h26 a52 52 0 0 0 -16 -37 l-18 18 a26 26 0 0 1 8 19 Z" fill="#cfcec9" />
    </svg>
  );
}

export function PropRing({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 68" className={className} aria-hidden>
      <ellipse cx="80" cy="38" rx="70" ry="24" fill="none" stroke="#c85f14" strokeWidth="15" />
      <ellipse cx="80" cy="34" rx="70" ry="24" fill="none" stroke="#f79640" strokeWidth="9" />
      <ellipse cx="80" cy="31" rx="70" ry="24" fill="none" stroke="#ffbe7d" strokeWidth="3" opacity="0.75" />
    </svg>
  );
}

export function PropPebble({ className, tone = '#c3c1bc' }: { className?: string; tone?: string }) {
  return (
    <svg viewBox="0 0 70 58" className={className} aria-hidden>
      <ellipse cx="35" cy="30" rx="31" ry="24" fill={tone} />
      <ellipse cx="26" cy="21" rx="12" ry="8" fill="#ffffff" opacity="0.32" />
    </svg>
  );
}

/** The little keyhole-ish shape sitting low on the right in the reference. */
export function PropKey({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 90 70" className={className} aria-hidden>
      <circle cx="30" cy="32" r="24" fill="#d9d7d2" />
      <circle cx="30" cy="32" r="10" fill="#b3b1ac" />
      <rect x="48" y="24" width="36" height="16" rx="8" fill="#d9d7d2" />
    </svg>
  );
}

'use client';

/**
 * AIRLOCK, drawn as a pixel matrix.
 *
 * The reference sets a giant blocky wordmark behind its centrepiece, and the
 * blockiness is doing real work — it reads as *machine* rather than as a large
 * font, which is exactly the register this product wants. So rather than
 * approximate it with a heavy typeface, the letters are a 5×7 bitmap rendered
 * as rectangles: genuinely pixel-perfect at any size, no font to load, and
 * scalable without the hinting artefacts a hugely-scaled webfont picks up.
 *
 * It is a texture, not a label. It sits behind the hatch, gets clipped by it,
 * and is low-contrast on purpose — the headline must win the first read, and a
 * wordmark that competes with it has stopped being a background.
 */

/** 5 wide, 7 tall, one string per row. `1` is a filled pixel. */
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
/** One blank column between letters; the reference sets its wordmark loose. */
const TRACKING = 2;

export function Wordmark({
  text = 'AIRLOCK',
  className,
  /** Rounded corners on each pixel. 0 is a hard square. */
  radius = 0,
  opacity = 1,
}: {
  text?: string;
  className?: string;
  radius?: number;
  opacity?: number;
}) {
  const letters = [...text.toUpperCase()].filter((c) => c in GLYPHS);
  const width = letters.length * GLYPH_W + Math.max(0, letters.length - 1) * TRACKING;

  const cells: Array<{ x: number; y: number }> = [];
  letters.forEach((letter, index) => {
    const originX = index * (GLYPH_W + TRACKING);
    GLYPHS[letter]!.forEach((row, y) => {
      [...row].forEach((bit, x) => {
        if (bit === '1') cells.push({ x: originX + x, y });
      });
    });
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${GLYPH_H}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ opacity }}
      role="presentation"
      aria-hidden
    >
      <g className="lp-wordmark">
        {cells.map((c) => (
          // Slightly over 1 unit so adjacent pixels butt together. At exactly
          // 1 the renderer leaves a hairline seam and the glyphs read as
          // dotted instead of solid, which is the whole look.
          <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1.04} height={1.04} rx={radius} />
        ))}
      </g>
    </svg>
  );
}

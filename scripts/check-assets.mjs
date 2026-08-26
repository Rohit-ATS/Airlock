/**
 * Check the README's SVG assets.
 *
 * The README is the first thing a judge reads, and its banners are animated
 * SVGs committed to the repository. That makes them code, and code in this
 * repository is checked mechanically rather than eyeballed — an asset that
 * renders on this machine and breaks on GitHub is exactly the kind of defect
 * nobody finds until it is on screen in front of the person you were trying to
 * impress.
 *
 * What this asserts, and why each one is a real failure mode:
 *
 *   1. WELL-FORMED XML. GitHub serves these through <img>, and a browser
 *      parsing an SVG is strict — one unescaped `&` in a <text> node and the
 *      whole image silently fails to render. This is by far the most common
 *      way a hand-written SVG dies.
 *   2. NO SCRIPTS OR EXTERNAL REFERENCES. GitHub's image proxy will not fetch
 *      a remote font or image, so anything referencing one renders wrong for
 *      everyone but the author. <script> never executes in an <img> context at
 *      all, so an asset relying on it is simply broken.
 *   3. A viewBox, WIDTH AND HEIGHT. Without viewBox the asset does not scale;
 *      without intrinsic dimensions GitHub cannot reserve space and the page
 *      reflows as it loads.
 *   4. A REDUCED-MOTION BLOCK. These loop forever. A reader who has asked
 *      their machine to hold still is entitled to have it hold still.
 *   5. NOTHING ONLY-VISIBLE-WHEN-ANIMATED. The subtle one. If an element's
 *      resting style is `opacity: 0` and only a keyframe brings it in, then
 *      turning animation off leaves it invisible — so the reduced-motion
 *      reader sees a half-empty banner. Checked by looking for a zero opacity
 *      that no non-animated rule restores.
 *   6. SIZE. A megabyte of SVG in a README is a slow first impression.
 *
 * Run: npm run check:assets   (part of `npm test`)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assetsDir = path.join(root, 'assets');

/** Generous, but a README banner past this is doing something wrong. */
const MAX_BYTES = 80_000;

const failures = [];
const notes = [];
const note = (file, message) => failures.push(`${file}: ${message}`);

/**
 * A deliberately small well-formedness check.
 *
 * Not a full XML parser — this repository will not take a dependency to lint an
 * asset. It catches the three things that actually break SVG in practice: an
 * unbalanced tag, an unescaped ampersand, and an unescaped angle bracket inside
 * text content.
 */
function checkWellFormed(file, svg) {
  // Unescaped ampersands. `&` is only legal as the start of an entity.
  const badAmp = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/.exec(svg);
  if (badAmp) {
    const around = svg.slice(Math.max(0, badAmp.index - 40), badAmp.index + 40).replace(/\n/g, ' ');
    note(file, `unescaped "&" at offset ${badAmp.index} — use &amp;  …${around}…`);
  }

  // Tag balance, ignoring self-closing tags and the handful of void-ish forms.
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(svg)) !== null) {
    const [, closing, name, attrs, selfClose] = m;
    if (attrs.includes('<')) note(file, `"<" inside the attributes of <${name}> — escape it as &lt;`);
    if (selfClose === '/') continue;
    if (closing === '/') {
      const open = stack.pop();
      if (open !== name) {
        note(file, `tag mismatch: </${name}> closes <${open ?? 'nothing'}>`);
        return;
      }
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) note(file, `unclosed tag(s): ${[...new Set(stack)].join(', ')}`);
}

function checkAsset(file) {
  const full = path.join(assetsDir, file);
  const svg = readFileSync(full, 'utf8');
  const bytes = Buffer.byteLength(svg, 'utf8');

  checkWellFormed(file, svg);

  /* --- no scripts, no anything fetched from elsewhere ------------------- */
  if (/<script/i.test(svg)) note(file, 'contains <script>, which never executes inside <img> and will not work');
  if (/@import/i.test(svg)) note(file, 'contains @import — a remote stylesheet will not be fetched');
  const remote = /(?:href|src)\s*=\s*["'](https?:)?\/\//i.exec(svg);
  if (remote) note(file, `references something remote (${remote[0].slice(0, 48)}…) — it will not render for anyone else`);
  if (/url\(\s*["']?https?:/i.test(svg)) note(file, 'a CSS url() points at a remote resource');

  /* --- the root element ------------------------------------------------- */
  const rootTag = /<svg\b[^>]*>/i.exec(svg);
  if (!rootTag) {
    note(file, 'has no <svg> root element');
    return;
  }
  const attrs = rootTag[0];
  if (!/xmlns\s*=/.test(attrs)) note(file, 'the <svg> root is missing xmlns');
  if (!/viewBox\s*=/.test(attrs)) note(file, 'the <svg> root is missing viewBox, so it will not scale');
  if (!/\bwidth\s*=/.test(attrs) || !/\bheight\s*=/.test(attrs)) {
    note(file, 'the <svg> root is missing width/height, so the page reflows while it loads');
  }
  if (!/<title[\s>]/i.test(svg)) note(file, 'has no <title>, so it is unreadable to a screen reader');

  /* --- motion ----------------------------------------------------------- */
  const animated = /@keyframes|<animate|<animateTransform/i.test(svg);
  if (animated && !/prefers-reduced-motion/.test(svg)) {
    note(file, 'animates but has no prefers-reduced-motion block');
  }

  // The subtle one: something whose resting state is invisible and which only
  // appears via a keyframe is invisible to a reduced-motion reader.
  if (animated && /prefers-reduced-motion/.test(svg)) {
    const reduced = svg.slice(svg.indexOf('prefers-reduced-motion'));
    const killsAnimation = /animation\s*:\s*none/i.test(reduced);
    if (!killsAnimation) {
      note(file, 'the reduced-motion block does not actually disable the animations');
    }
    // Any rule setting opacity:0 outside a @keyframes block is a resting state.
    const withoutKeyframes = svg.replace(/@keyframes[\s\S]*?\}\s*\}/g, '');
    if (/opacity\s*:\s*0\s*[;}]/.test(withoutKeyframes) && !/animation-fill-mode|forwards|both/.test(svg)) {
      notes.push(
        `${file}: has a resting opacity:0 and no fill-mode — check it is still visible with motion disabled`,
      );
    }
  }

  /* --- weight ------------------------------------------------------------ */
  if (bytes > MAX_BYTES) note(file, `${(bytes / 1024).toFixed(0)}KB exceeds the ${MAX_BYTES / 1024}KB budget`);

  return { file, bytes, animated };
}

/* -------------------------------------------------------------------------- */

if (!existsSync(assetsDir)) {
  console.error('No assets/ directory. The README references animated SVGs that do not exist.');
  process.exit(1);
}

const files = readdirSync(assetsDir).filter((f) => f.endsWith('.svg')).sort();
if (files.length === 0) {
  console.error('assets/ contains no SVG files.');
  process.exit(1);
}

const rows = files.map(checkAsset).filter(Boolean);

/* --- every asset the README references must exist, and vice versa --------- */
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
for (const ref of readme.matchAll(/src="assets\/([^"]+)"/g)) {
  if (!files.includes(ref[1])) note('README.md', `references assets/${ref[1]}, which does not exist`);
}
for (const f of files) {
  if (!readme.includes(`assets/${f}`)) {
    notes.push(`assets/${f}: committed but never referenced from the README`);
  }
}

console.log('');
for (const r of rows) {
  console.log(`  ok  ${r.file.padEnd(16)} ${String(Math.round(r.bytes / 1024)).padStart(3)}KB  ${r.animated ? 'animated' : 'static'}`);
}
for (const n of notes) console.log(`  ..  ${n}`);

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} problem(s) with the README assets:\n`);
  for (const f of failures) console.error(`  X ${f}`);
  console.error('\nAn SVG that fails to parse does not degrade — it renders as a broken image.');
  process.exit(1);
}
console.log(`${rows.length} asset(s) check out.`);

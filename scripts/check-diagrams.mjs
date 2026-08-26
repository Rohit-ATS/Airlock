/**
 * Check the README's Mermaid diagrams actually render.
 *
 * GitHub renders Mermaid in the browser, after the page has loaded. That means
 * a syntax error fails nothing: no build breaks, no check goes red, and the
 * diagram is replaced by a bright error box in the middle of the README —
 * which is a worse outcome than having no diagram at all, and one you only
 * discover by looking at the published page.
 *
 * This repository's whole argument is that a claim you cannot check is
 * indistinguishable from one that is false, and a diagram is a claim. So the
 * blocks are extracted and run through the real Mermaid parser.
 *
 * Deliberately NOT part of `npm test`: it needs a browser download. Same
 * reasoning as check-a11y.mjs — a check that is flaky for environmental
 * reasons trains people to ignore it. Run it by hand after touching a diagram.
 *
 *   npm i -D playwright-core && npx playwright install chromium
 *   npm run check:diagrams
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch {
  console.log('');
  console.log('This check needs a browser, which is not installed by default:');
  console.log('');
  console.log('  npm i -D playwright-core');
  console.log('  npx playwright install chromium');
  console.log('');
  console.log('Kept out of the default install because a browser download is a slow, flaky');
  console.log('thing to put between a judge and a working clone.');
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* Extract the blocks                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Split on the fence line by line rather than with one big regex.
 *
 * A lookahead across 70KB containing nested backticks is exactly the kind of
 * pattern that quietly matches nothing and reports "0 diagrams, all fine",
 * which is the failure this check exists to prevent. A line-by-line scan
 * cannot silently find zero when the fences are there.
 */
function extractMermaid(md) {
  const blocks = [];
  let current = null;
  for (const line of md.split('\n')) {
    if (line.trim() === '```mermaid') {
      current = [];
      continue;
    }
    if (current !== null && line.trim() === '```') {
      blocks.push(current.join('\n'));
      current = null;
      continue;
    }
    if (current !== null) current.push(line);
  }
  return blocks;
}

const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const blocks = extractMermaid(readme);

console.log('');
if (blocks.length === 0) {
  console.log('No Mermaid diagrams in the README. Nothing to check.');
  process.exit(0);
}
console.log(`Found ${blocks.length} Mermaid diagram(s) in README.md.`);

/* -------------------------------------------------------------------------- */
/* Render them with the real parser                                            */
/* -------------------------------------------------------------------------- */

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const page_html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
${blocks.map((b, i) => `<pre class="mermaid" id="m${i}">${escape(b)}</pre>`).join('\n')}
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  window.__thrown = [];
  mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
  try {
    await mermaid.run({ querySelector: '.mermaid', suppressErrors: false });
  } catch (e) {
    window.__thrown.push(String(e && e.message ? e.message : e));
  }
  window.__done = true;
</script></body></html>`;

const tmp = path.join(os.tmpdir(), `airlock-diagrams-${process.pid}.html`);
writeFileSync(tmp, page_html, 'utf8');

const launch = process.env.AIRLOCK_CHROMIUM ? { executablePath: process.env.AIRLOCK_CHROMIUM } : {};
let browser;
try {
  browser = await chromium.launch(launch);
} catch (error) {
  console.log('');
  console.log(`Could not launch a browser: ${error.message.split('\n')[0]}`);
  console.log('Run `npx playwright install chromium`, or set AIRLOCK_CHROMIUM to an executable.');
  if (existsSync(tmp)) unlinkSync(tmp);
  process.exit(0);
}

const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.__done === true, { timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const rows = [];
  document.querySelectorAll('.mermaid').forEach((el, i) => {
    const svg = el.querySelector('svg');
    const text = el.textContent.toLowerCase();
    rows.push({
      i,
      rendered: Boolean(svg),
      width: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
      errorBox: text.includes('syntax error') || text.includes('mermaid version'),
    });
  });
  return { rows, thrown: window.__thrown ?? [] };
});

await browser.close();
if (existsSync(tmp)) unlinkSync(tmp);

/* -------------------------------------------------------------------------- */

let bad = 0;
console.log('');
for (const r of report.rows) {
  // A diagram that "renders" at 20px wide has produced an empty SVG, which
  // looks like success to a naive check and like nothing on the page.
  const ok = r.rendered && r.width > 50 && !r.errorBox;
  if (!ok) bad += 1;
  console.log(`  ${ok ? 'ok ' : 'X  '} diagram ${r.i + 1}  ${r.rendered ? `${r.width}px wide` : 'produced no SVG'}${r.errorBox ? '  — RENDERED AN ERROR BOX' : ''}`);
}
for (const t of report.thrown) console.log(`  X   parser threw: ${t}`);

console.log('');
if (bad > 0 || report.thrown.length > 0) {
  console.error('A Mermaid syntax error does not fail a build — it renders a red box in the');
  console.error('middle of the README, on the first thing anybody reads. Fix the block above.');
  process.exit(1);
}
console.log(`${report.rows.length} diagram(s) render.`);

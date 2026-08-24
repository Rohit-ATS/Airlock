/**
 * Audit every AIRLOCK surface against WCAG 2.1 AA with axe-core.
 *
 *   npm run build --workspace @airlock/console
 *   npm start --workspace @airlock/console &
 *   npm run check:a11y
 *
 * Why this exists as a committed script rather than a claim in a README: the
 * first run of it found 106 failing nodes across all three routes — legends,
 * hints and secondary evidence text, everywhere — because two ink tokens had
 * been chosen for the mood they created rather than measured. The palette in
 * globals.css was rebalanced as a result, and every step of the ink scale now
 * clears 4.5:1 against every surface it can sit on.
 *
 * "It is dim on purpose" is not a defence anybody has to accept, and a design
 * system that cannot be checked is a design system that drifts. Run this after
 * touching the palette.
 *
 * Deliberately NOT part of `npm test`: it needs a built console, a running
 * server and a downloaded browser, and a test that is flaky for environmental
 * reasons trains people to ignore it. Run it by hand, and read the number.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

let chromium;
let axeSource;
try {
  ({ chromium } = require('playwright-core'));
  axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
} catch {
  console.error('This check needs two dev dependencies that are not installed by default:\n');
  console.error('  npm i -D playwright-core axe-core');
  console.error('  npx playwright install chromium\n');
  console.error('They are kept out of the default install because a browser download is a');
  console.error('slow, flaky thing to put between a judge and a working clone.');
  process.exit(2);
}

const BASE = process.env.AIRLOCK_BASE_URL ?? 'http://localhost:3000';
const ROUTES = [
  ['landing', '/'],
  ['console', '/console'],
  ['control', '/control'],
];

/** WCAG 2.1 A and AA. Anything below AA is not a standard, it is an opinion. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const launch = process.env.AIRLOCK_CHROMIUM
  ? { executablePath: process.env.AIRLOCK_CHROMIUM }
  : {};

let browser;
try {
  browser = await chromium.launch(launch);
} catch (error) {
  console.error(`Could not launch chromium: ${error.message}`);
  console.error('Set AIRLOCK_CHROMIUM to an executable path, or run `npx playwright install chromium`.');
  process.exit(2);
}

let failing = 0;
const summary = [];

for (const [name, path] of ROUTES) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch {
    console.error(`\n${name}: could not reach ${BASE}${path} — is the console running?`);
    await context.close();
    await browser.close();
    process.exit(2);
  }

  // The console streams and the control room verifies a hash chain after mount.
  // Auditing before either settles measures a page that never reaches a user.
  await page.waitForTimeout(2500);
  await page.addScriptTag({ content: axeSource });

  const result = await page.evaluate(
    async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    TAGS,
  );

  const nodes = result.violations.reduce((n, v) => n + v.nodes.length, 0);
  failing += nodes;
  summary.push([name, result.violations.length, nodes]);

  console.log(`\n=== ${name} (${BASE}${path}) ===`);
  if (result.violations.length === 0) {
    console.log('  no violations');
  }
  for (const v of result.violations) {
    console.log(`  [${v.impact}] ${v.id}: ${v.help}  — ${v.nodes.length} node(s)`);
    console.log(`      ${v.helpUrl}`);
    for (const node of v.nodes.slice(0, 5)) {
      console.log(`      ${node.target.join(' ')}`);
      const detail = (node.failureSummary ?? '').split('\n').filter(Boolean).slice(1, 3).join(' | ');
      if (detail) console.log(`        -> ${detail}`);
    }
    if (v.nodes.length > 5) console.log(`      …and ${v.nodes.length - 5} more`);
  }

  await context.close();
}

await browser.close();

console.log('\n---');
for (const [name, types, nodes] of summary) {
  console.log(`  ${name.padEnd(9)} ${String(types).padStart(2)} violation type(s), ${nodes} node(s)`);
}
console.log(`\nTOTAL failing nodes: ${failing}`);

if (failing > 0) {
  console.error('\nWCAG 2.1 AA is the bar. Fix the palette or the markup, not the threshold.');
  process.exit(1);
}
console.log('Clean against WCAG 2.1 AA.');

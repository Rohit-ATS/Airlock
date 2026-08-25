/**
 * Nothing on the connect -> certify -> apply path may import simulated data.
 *
 * AIRLOCK ships a seeded demo queue, and that is a good thing: it is what makes
 * the console show something real ninety seconds after a clone. It is also the
 * single most dangerous piece of code in the repository, because the moment a
 * seeded row can reach a certificate, every number on the card becomes a claim
 * about a database that does not exist — and it will still look exactly right.
 *
 * The failure mode is not someone deciding to fake a checksum. It is a helper
 * that is convenient in a test, imported into a module that is convenient to
 * reuse, three refactors from now, by someone who has no idea the boundary
 * exists. Nobody notices, because the output is plausible.
 *
 * So the boundary is enforced rather than documented. This walks the import
 * graph from each entry point below and fails if it can reach anything that
 * generates data. Demo seeding stays legal in the console's own store, which is
 * a separate, clearly labelled entry point that no real connection routes
 * through.
 *
 * Run: node scripts/check-no-simulation.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The real path. Everything reachable from here is held to rule R1.
 *
 * Add an entry when a module joins the path from a live connection to an
 * applied change. Removing one to make this pass is the wrong fix, and is the
 * thing the reviewer should look for.
 */
const ENTRY_POINTS = [
  'packages/contract/src/connection.ts',
  'packages/contract/src/shadow.ts',
  'packages/contract/src/resolve.ts',
  'packages/contract/src/gate.ts',
  'packages/contract/src/receipt.ts',
];

/**
 * Module specifiers that mean "this data was invented".
 *
 * Matched against the import specifier rather than the file contents, because a
 * module that merely mentions the word `seed` in a comment is fine and a module
 * that imports a generator is not.
 */
const FORBIDDEN = [
  { pattern: /(^|[/\\])seed(-|\.|\/|$)|seed-sqlite|seedIfEmpty/i, why: 'seeds rows that were never in anybody\'s database' },
  { pattern: /faker/i, why: 'generates plausible values, which is the exact failure this rule exists to prevent' },
  { pattern: /(^|[/\\])mocks?([/\\.]|$)/i, why: 'mocks stand in for a system of record' },
  { pattern: /(^|[/\\])stubs?([/\\.]|$)/i, why: 'stubs stand in for a system of record' },
  { pattern: /(^|[/\\])fixtures?([/\\.]|$)|contracts[/\\]examples/i, why: 'fixtures are console demo data, not measurements' },
  { pattern: /generate\.mjs$/i, why: 'the fixture generator' },
];

/** Bare `import x from 'y'`, `export … from 'y'`, and `import('y')`. */
const SPECIFIER = /(?:^|\s)(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\s)import\s*['"]([^'"]+)['"]/gm;

function specifiersIn(file) {
  const source = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of source.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec) out.push(spec);
  }
  return out;
}

/** Resolve a relative specifier to a real file, tolerating the .js -> .ts swap. */
function resolveLocal(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    base.replace(/\.js$/, '.ts'),
    `${base}.ts`,
    `${base}.mjs`,
    path.join(base, 'index.ts'),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

const violations = [];
const visited = new Set();

function walk(file, chain) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (visited.has(rel)) return;
  visited.add(rel);

  for (const spec of specifiersIn(file)) {
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(spec)) {
        violations.push({ chain: [...chain, rel], spec, why });
      }
    }

    const next = resolveLocal(file, spec);
    if (next) walk(next, [...chain, rel]);
  }
}

for (const entry of ENTRY_POINTS) {
  const file = path.join(root, entry);
  if (!fs.existsSync(file)) continue; // a path module that does not exist yet
  walk(file, []);
}

if (violations.length > 0) {
  console.error(`\n[31mSimulated data can reach the certificate path.[0m\n`);
  for (const v of violations) {
    console.error(`  imports ${JSON.stringify(v.spec)} — ${v.why}`);
    console.error(`    via ${v.chain.join('\n     -> ')}\n`);
  }
  console.error('Every number in a certificate has to come from the connected database.');
  console.error('If this is demo data, it belongs behind the console\'s own seeding entry');
  console.error('point, which no real connection routes through. Do not fix this by');
  console.error('removing the entry point from ENTRY_POINTS.');
  process.exit(1);
}

console.log(`No simulated data on the certificate path — ${visited.size} module(s) checked from ${ENTRY_POINTS.length} entry point(s).`);

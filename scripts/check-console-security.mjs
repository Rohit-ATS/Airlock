/**
 * Guard the console write surface.
 *
 * This is intentionally a small source-level check, because these routes live
 * inside a Next app rather than a package with a node-test build target. The
 * risks it protects are concrete:
 *
 *   1. Machine writers must authenticate before they can create/apply records.
 *   2. Browser mutation routes must reject cross-origin writes.
 *   3. Detached receipt downloads must not reflect raw route params into the
 *      Content-Disposition filename.
 *   4. Non-browser writers must actually send the configured machine token.
 *
 * Run: node scripts/check-console-security.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

function expectIncludes(rel, needle, why) {
  const text = read(rel);
  if (!text.includes(needle)) failures.push(`${rel}: ${why}`);
}

function expectMatches(rel, pattern, why) {
  const text = read(rel);
  if (!pattern.test(text)) failures.push(`${rel}: ${why}`);
}

for (const rel of [
  'apps/console/app/api/dossiers/route.ts',
  'apps/console/app/api/dossiers/[id]/post-apply/route.ts',
]) {
  expectIncludes(rel, "import { requireMachineWriter } from '@/server/machineAuth';", 'must import the machine writer guard');
  expectMatches(rel, /const\s+auth\s*=\s*requireMachineWriter\(request\);\s*if\s*\(auth\)\s*return\s+auth;/s, 'must require the machine token before parsing or writing');
}

for (const rel of [
  'apps/console/app/api/dossiers/[id]/decision/route.ts',
  'apps/console/app/api/dossiers/[id]/break-glass/route.ts',
  'apps/console/app/api/dossiers/[id]/clear-injection/route.ts',
  'apps/console/app/api/dossiers/[id]/undo/route.ts',
]) {
  expectIncludes(rel, "import { requireSameOrigin } from '@/server/machineAuth';", 'must import the same-origin guard');
  expectMatches(rel, /const\s+origin\s*=\s*requireSameOrigin\(request\);\s*if\s*\(origin\)\s*return\s+origin;/s, 'must reject cross-origin browser writes before parsing or writing');
}

/*
 * A decision verb is matched exactly, never defaulted.
 *
 * The regression this pins actually shipped: the route read
 * `body.decision === 'rejected' ? 'rejected' : 'approved'`, so every input that
 * was not the literal string "rejected" — a tense typo, the wrong case, a null,
 * an empty body — approved the change and answered 200. The behavioural half of
 * this is asserted over real HTTP in scripts/check-console-http.mjs; this is the
 * cheap source-level half that fails fast without booting a server.
 */
expectMatches(
  'apps/console/app/api/dossiers/[id]/decision/route.ts',
  /if\s*\(body\.decision\s*!==\s*'approved'\s*&&\s*body\.decision\s*!==\s*'rejected'\)/s,
  'decision verb must be matched exactly and refused otherwise, never defaulted to approved',
);
expectMatches(
  'apps/console/app/api/dossiers/[id]/decision/route.ts',
  /INVALID_DECISION/,
  'an unrecognised decision verb must be refused by name',
);

expectIncludes(
  'apps/console/app/harness/[...path]/route.ts',
  "import { requireSameOrigin } from '@/server/machineAuth';",
  'harness proxy must import the same-origin guard',
);
expectMatches(
  'apps/console/app/harness/[...path]/route.ts',
  /request\.method\s*!==\s*'GET'[\s\S]*request\.method\s*!==\s*'HEAD'[\s\S]*request\.method\s*!==\s*'OPTIONS'[\s\S]*const\s+origin\s*=\s*requireSameOrigin\(request\);\s*if\s*\(origin\)\s*return\s+origin;/s,
  'harness proxy must guard non-read methods with same-origin checks',
);

expectMatches(
  'apps/console/app/api/dossiers/[id]/receipt/route.ts',
  /const\s+filenameId\s*=\s*id\.replace\(\s*\/\[\^A-Za-z0-9\._-\]\/g,\s*'_'\s*\)\.slice\(0,\s*120\)\s*\|\|\s*'change';/s,
  'receipt filename must be sanitized and length-limited',
);
expectIncludes(
  'apps/console/app/api/dossiers/[id]/receipt/route.ts',
  'filename="airlock-receipt-${filenameId}.json"',
  'receipt download must use the sanitized filename',
);

for (const rel of [
  'packages/mcp/src/tools.ts',
  'scripts/verify-sqlite-migration.mjs',
  'scripts/verify-sqlite-erasure-scope.mjs',
]) {
  expectMatches(rel, /Authorization|authorization/, 'writer must send Authorization when AIRLOCK_API_TOKEN is configured');
  expectIncludes(rel, 'AIRLOCK_API_TOKEN', 'writer must read AIRLOCK_API_TOKEN');
}

if (failures.length > 0) {
  console.error('\nConsole write-surface checks failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('Console write surface is guarded.');

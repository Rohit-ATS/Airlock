/**
 * Every load-bearing claim in the README, resolved to a real file and line.
 *
 * A README is a sales document until somebody checks it, and the checking is
 * the expensive part: a reader who cannot confirm a claim in a few seconds does
 * not conclude "unproven", they conclude "untrue", and they apply that verdict
 * to the claims they did not check either. One unverifiable line discredits
 * twenty good ones.
 *
 * So the claims are data, here, rather than prose in a document nobody can run:
 *
 *   - each one names a file and an anchor — an exact fragment of the code that
 *     implements it — and this script resolves that anchor to a line number;
 *   - an anchor that is missing, or that appears more than once and so does not
 *     identify a line, is a failure;
 *   - `--emit` writes the table back into README.md between its markers, so the
 *     line numbers a reader clicks are generated from the code rather than
 *     typed in and left to rot.
 *
 * That last part is the point. `npm test` runs this, so moving the code that
 * backs a claim without moving the claim fails the build — the same trick the
 * capability registry and the policy doc already use. A claim that cannot drift
 * out of date is worth more than a claim that is merely true today.
 *
 * Run: node scripts/verify-claims.mjs [--emit]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `anchor` is matched literally, and must appear exactly once in `file`.
 *
 * Prefer a fragment that would have to change if the behaviour changed — a
 * signature, a guard, the line that actually decides — over a comment, which
 * can survive the deletion of everything it describes.
 */
const CLAIMS = [
  {
    group: 'The gate',
    claim: 'An approval for an unproven change cannot be constructed: `ApprovalGrant` carries a module-private symbol only `openGate` can mint.',
    file: 'packages/contract/src/gate.ts',
    anchor: "const GATE_WITNESS: unique symbol",
    run: 'npm run build --workspace @airlock/contract',
    sees: 'Compiles. Weaken the type and the build fails — see the next row.',
  },
  {
    group: 'The gate',
    claim: 'Six attempts to forge a grant are asserted as compile errors. Weaken the type and `tsc` fails on the now-unused `@ts-expect-error`.',
    file: 'packages/contract/src/gate.typetest.ts',
    anchor: '// @ts-expect-error - a hand-written grant is not a grant',
    run: 'npm run build --workspace @airlock/contract',
    sees: 'Six `@ts-expect-error` lines, each a forgery the compiler rejects.',
  },
  {
    group: 'The gate',
    claim: 'A detected injection seals the gate **before** the certificate is examined — step 2 of 7, ahead of proof integrity.',
    file: 'packages/contract/src/gate.ts',
    anchor: "if (hasUnclearedInjection(dossier)) return sealed('INJECTION_DETECTED');",
    run: 'node --test packages/contract/test/quarantine.test.mjs',
    sees: 'The ordering is pinned by test, not left to code review.',
  },
  {
    group: 'The gate',
    claim: "The verifier's own `match` flag is never trusted. AIRLOCK recomputes `pre === post_rollback` itself.",
    file: 'packages/contract/src/gate.ts',
    anchor: "if (c.pre !== c.post_rollback) return sealed('CHECKSUM_MISMATCH');",
    run: 'node --test packages/contract/test/gate.test.mjs',
    sees: 'A dossier claiming `match:true` over differing checksums is still sealed.',
  },
  {
    group: 'The gate',
    claim: 'A claim of danger is believed; a claim of safety is recomputed. Drift seals the gate even when the drift checker reported everything fine.',
    file: 'packages/contract/src/gate.ts',
    anchor: 'export function hasDrifted',
    run: 'node --test packages/contract/test/policy.test.mjs',
    sees: '`drifted:false` with a production checksum that does not match still seals.',
  },
  {
    group: 'The gate',
    claim: 'Break-glass is not an approval: `BreakGlassOverride` carries a different private symbol, and no function accepts both.',
    file: 'packages/contract/src/gate.ts',
    anchor: "const GLASS_WITNESS: unique symbol",
    run: 'node --test packages/contract/test/policy.test.mjs',
    sees: 'Two of the six compile-error forgeries are exactly this swap.',
  },
  {
    group: 'The gate',
    claim: 'The same rule runs server-side. Approving over HTTP with no browser involved is refused identically.',
    file: 'apps/console/src/data/dossierStore.ts',
    anchor: 'const gate = openGate(dossier, viewer, { policy: activePolicy() });',
    run: "curl -s -XPOST localhost:3000/api/dossiers/dos_currency_fix/decision -H 'Content-Type: application/json' -d '{\"decision\":\"approved\"}'",
    sees: '`{"error":"CERTIFICATE_FAILED"}` and HTTP 403.',
  },

  {
    group: 'Policy',
    claim: 'A quorum counts people, not clicks — signatures collapse by identity, so one approver signing twice is one approver.',
    file: 'packages/contract/src/dossier.ts',
    anchor: 'export function approversFor',
    run: 'node --test packages/contract/test/policy.test.mjs',
    sees: 'Two signatures from one identity leave the change still waiting.',
  },
  {
    group: 'Policy',
    claim: 'No standing production access: every access grant must carry an expiry, so the default state is that nobody holds the keys.',
    file: 'packages/contract/src/policy.ts',
    anchor: 'require_expiry: boolean;',
    run: 'npm run check:fixtures',
    sees: '`access-grant.standing.json` is refused for `GRANT_WITHOUT_EXPIRY`.',
  },
  {
    group: 'Policy',
    claim: 'The shipped `airlock.policy.yaml` is byte-identical to the compiled default, so the documented policy and the enforced one cannot disagree.',
    file: 'scripts/check-policy.mjs',
    anchor: 'const shipped = resolvedRules(DEFAULT_POLICY);',
    run: 'npm run check:policy',
    sees: '`airlock.policy.yaml checks out — 7 classes, identical to the shipped default.`',
  },

  {
    group: 'The ledger',
    claim: 'Every decided change is sealed with the hash of the one before it, so editing any historical record breaks every link after it.',
    file: 'packages/contract/src/receipt.ts',
    anchor: 'return sha256(canonicalJson({ seq, prev: prevHash, body: receiptBody(dossier) }));',
    run: 'npm run verify:ledger',
    sees: 'Each record listed with its hash, and the head hash of the chain.',
  },
  {
    group: 'The ledger',
    claim: 'Tampering is detected at the record where it happened, not merely somewhere in the file.',
    file: 'packages/contract/src/receipt.ts',
    anchor: "else if (receipt.prev_hash !== prev) fault = 'broken-link';",
    run: 'node --test packages/contract/test/receipt.test.mjs',
    sees: 'Edit, reorder and delete are each caught, at the right index.',
  },

  {
    group: 'The agent',
    claim: 'There is no tool that applies a change to production. Nine tools ship; exactly one is destructive, and the harness holds it for a human.',
    file: 'packages/mcp/src/tools.ts',
    anchor: "name: 'airlock_request_approval',",
    run: 'node --test packages/mcp/test/server.test.mjs',
    sees: 'The tool list is asserted whole — a tenth tool fails the test.',
  },
  {
    group: 'The agent',
    claim: 'The agent may open a pull request and may not merge one. `merge_pull_request` is on a deny-list checked independently of the allow-list.',
    file: 'scripts/check-agents.mjs',
    anchor: "'merge_pull_request',",
    run: 'npm run check:agents',
    sees: 'Four specs check out; `airlock-scout` reports no path to production at all.',
  },
  {
    group: 'The agent',
    claim: 'Untrusted excerpts are neutralised before storage, so a finding cannot carry the injection into the next prompt that summarises it.',
    file: 'packages/contract/src/quarantine.ts',
    anchor: 'export function neutralise',
    run: 'node --test packages/contract/test/quarantine.test.mjs',
    sees: 'The stored excerpt is defanged; the raw payload is never persisted.',
  },

  {
    group: 'Evidence',
    claim: 'A capability lamp cannot be lit from application code. The only writer is the detector fold over the real event stream.',
    file: 'packages/contract/src/detectors.ts',
    anchor: 'export function detect(',
    run: 'node --test packages/contract/test/harness.test.mjs',
    sees: 'Noise, repeated connectors and prose that merely mentions a chart light nothing.',
  },
  {
    group: 'Evidence',
    claim: 'The observer is a faithful passthrough: same chunks, same objects, same order, none added, none lost — even when a detector throws.',
    file: 'apps/console/src/server/observedServer.ts',
    anchor: 'export function withHarnessObserver',
    run: 'node --test packages/contract/test/observer.test.mjs',
    sees: 'A realistic turn stream is driven through it and checked both ways: what lit, and what must stay dark.',
  },
  {
    group: 'Evidence',
    claim: 'An unsourced claim says it is unsourced, rather than defaulting to a grade that makes every number look accounted for.',
    file: 'packages/contract/src/provenance.ts',
    anchor: "grade: 'UNSOURCED',",
    run: 'node --test packages/contract/test/provenance.test.mjs',
    sees: 'A figure the agent asserted never acquires a link to an event that did not produce it.',
  },

  {
    group: 'After the change',
    claim: 'No proven inverse, no undo. A SCOPE certificate never earns one, because you cannot un-send forty thousand emails.',
    file: 'packages/contract/src/undo.ts',
    anchor: 'export function hasProvenInverse',
    run: 'node --test packages/contract/test/undo.test.mjs',
    sees: 'No arrangement of policy, window and clock produces an undo without a proven inverse.',
  },
  {
    group: 'After the change',
    claim: 'The undo window is measured on the server from `audit.applied_at`, so a sleeping laptop cannot extend it.',
    file: 'packages/contract/src/undo.ts',
    anchor: 'export function undoExpiresAt',
    run: 'node --test packages/contract/test/undo.test.mjs',
    sees: 'A late press is refused with the closing time quoted back.',
  },
  {
    group: 'After the change',
    claim: 'Unreviewed code does not open the gate, and a fix that predates the finding is not a fix.',
    file: 'packages/contract/src/review.ts',
    anchor: 'export function isAddressed',
    run: 'node --test packages/contract/test/review.test.mjs',
    sees: 'A commit earlier than the finding leaves it outstanding. Nits never block.',
  },
  {
    group: 'After the change',
    claim: 'The binding budget ceiling is the one furthest consumed, not the first declared.',
    file: 'packages/contract/src/budget.ts',
    anchor: '// The binding ceiling is the one furthest consumed',
    run: 'node --test packages/contract/test/budget.test.mjs',
    sees: 'A run cannot pass its token cap while the console reassures everybody about dollars.',
  },

  {
    group: 'The benchmark',
    claim: "Models are scored by executing their own SQL and comparing bytes — the gate's rule, `pre === post_rollback`, not a rubric and not an LLM judge.",
    file: 'benchmark/run.mjs',
    anchor: 'verified: pre === postRollback',
    run: 'node scripts/check-benchmark.mjs',
    sees: 'Every table, column and index the tasks name really exists in the database.',
  },
  {
    group: 'The benchmark',
    claim: 'Forward SQL that does not run is scored as neither a pass nor a refusal, so a model cannot be rewarded for writing SQL that never parsed.',
    file: 'benchmark/run.mjs',
    anchor: "return { outcome: 'invalid', kind: 'forward_sql_failed' };",
    run: 'node scripts/check-benchmark.mjs',
    sees: 'The `Unscored` column in docs/BENCHMARK.md is that outcome, reported rather than averaged away.',
  },
];

/* -------------------------------------------------------------------------- */

const RED = '[31m';
const DIM = '[2m';
const OFF = '[0m';

const fileCache = new Map();
function readLines(file) {
  if (!fileCache.has(file)) {
    fileCache.set(file, fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/));
  }
  return fileCache.get(file);
}

const results = [];
const failures = [];

for (const claim of CLAIMS) {
  let lines;
  try {
    lines = readLines(claim.file);
  } catch {
    failures.push(`${claim.file} does not exist. The claim points at nothing:\n    "${claim.claim}"`);
    continue;
  }

  const hits = [];
  lines.forEach((line, i) => {
    if (line.includes(claim.anchor)) hits.push(i + 1);
  });

  if (hits.length === 0) {
    failures.push(
      `${claim.file} no longer contains:\n    ${claim.anchor}\n  which is the evidence for:\n    "${claim.claim}"`,
    );
    continue;
  }
  if (hits.length > 1) {
    failures.push(
      `${claim.file} contains this ${hits.length} times, so it does not identify a line (${hits.join(', ')}):\n    ${claim.anchor}`,
    );
    continue;
  }

  results.push({ ...claim, line: hits[0] });
}

/* -------------------------------------------------------------------------- */
/* --emit: write the table back into the README                               */
/* -------------------------------------------------------------------------- */

const BEGIN = '<!-- BEGIN CLAIMS -->';
const END = '<!-- END CLAIMS -->';

if (process.argv.includes('--emit')) {
  if (failures.length > 0) {
    console.error('Refusing to emit a claims table while a claim is unanchored.\n');
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
  }

  const out = [];
  out.push(BEGIN);
  out.push('');
  out.push('<!-- Generated by scripts/verify-claims.mjs. Do not edit by hand: run `npm run verify:claims -- --emit`. -->');
  out.push('');

  let group = null;
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      out.push('');
      out.push(`**${group}**`);
      out.push('');
      out.push('| The claim | The code | Run this | What you see |');
      out.push('| --- | --- | --- | --- |');
    }
    const where = `[\`${path.basename(r.file)}:${r.line}\`](${r.file}#L${r.line})`;
    const cells = [r.claim, where, `\`${r.run}\``, r.sees].map((v) => String(v).replace(/\|/g, '\\|'));
    out.push(`| ${cells.join(' | ')} |`);
  }

  out.push('');
  out.push(END);

  const readmePath = path.join(root, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const start = readme.indexOf(BEGIN);
  const stop = readme.indexOf(END);
  if (start === -1 || stop === -1) {
    console.error(`README.md is missing the ${BEGIN} / ${END} markers.`);
    process.exit(1);
  }

  const next = readme.slice(0, start) + out.join('\n') + readme.slice(stop + END.length);
  fs.writeFileSync(readmePath, next, 'utf8');
  console.log(`README claims table written — ${results.length} claims, ${new Set(results.map((r) => r.group)).size} groups.`);
  process.exit(0);
}

/* -------------------------------------------------------------------------- */
/* Default: check, and print where each claim lives                            */
/* -------------------------------------------------------------------------- */

let group = null;
for (const r of results) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n${group}`);
  }
  console.log(`  ok  ${r.file}:${r.line}`);
  console.log(`      ${DIM}${r.claim}${OFF}`);
}

if (failures.length > 0) {
  console.error(`\n${RED}${failures.length} claim(s) no longer point at the code that backs them.${OFF}\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error('Either the code moved and the anchor needs updating, or the behaviour went');
  console.error('away and the claim needs deleting. Do not delete the check.');
  process.exit(1);
}

console.log(`\n${results.length} claims, every one anchored to a line that exists.`);

// The README's table is generated from this file, so a claim can be true here
// and stale there. Check that they agree.
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const block = readme.slice(readme.indexOf(BEGIN), readme.indexOf(END));
const stale = results.filter((r) => !block.includes(`${r.file}#L${r.line}`));
if (stale.length > 0) {
  console.error(`\n${RED}The README table is out of date for ${stale.length} claim(s):${OFF}\n`);
  for (const s of stale) console.error(`  ${s.file}:${s.line} — ${s.claim}`);
  console.error('\nRun: npm run verify:claims -- --emit');
  process.exit(1);
}
console.log('The README table agrees with all of them.');

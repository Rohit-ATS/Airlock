/**
 * Verify the AIRLOCK change ledger, or a single detached receipt.
 *
 *   node scripts/verify-ledger.mjs                        # the local ledger
 *   node scripts/verify-ledger.mjs path/to/ledger.json
 *   node scripts/verify-ledger.mjs path/to/receipt.json   # one detached receipt
 *
 * The point of this script is that it needs nothing from us. An auditor with a
 * copy of the repository and a copy of the ledger can run it and find out
 * whether any decided change has been altered since it was sealed — without
 * access to the console, the database, or anybody's word for it.
 *
 * Exit code 0 means the chain is intact. Exit code 1 means it is not, and the
 * output says exactly which record broke it and how.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChain, verifyDetached, safeParseDossier } from '../packages/contract/dist/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const DEFAULTS = [
  path.join(root, 'apps', 'console', '.airlock', 'ledger.json'),
  path.join(root, '.airlock', 'ledger.json'),
];

const arg = process.argv[2];
const target = arg ? path.resolve(arg) : DEFAULTS.find((p) => existsSync(p));

if (!target || !existsSync(target)) {
  console.error('No ledger found. Start the console once to create one, or pass a path:');
  console.error('  node scripts/verify-ledger.mjs path/to/ledger.json');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(target, 'utf8'));

/* --- a single detached receipt -------------------------------------------- */

if (raw && raw.airlock === '1' && raw.receipt && raw.body) {
  const verdict = await verifyDetached(raw);
  console.log(`Detached receipt for ${raw.body.dossier_id ?? '(unknown change)'}`);
  console.log(`  sealed at : ${raw.receipt.sealed_at}`);
  console.log(`  claimed   : ${raw.receipt.hash}`);
  console.log(`  recomputed: ${verdict.recomputed}`);
  console.log('');
  console.log(verdict.ok ? `PASS — ${verdict.message}` : `FAIL — ${verdict.message}`);
  process.exit(verdict.ok ? 0 : 1);
}

/* --- the whole ledger ------------------------------------------------------ */

const entries = Array.isArray(raw) ? raw : Object.values(raw);
const dossiers = [];
for (const entry of entries) {
  const parsed = safeParseDossier(entry);
  if (!parsed.success) {
    console.error(`Skipping a record that does not match the contract: ${entry?.dossier_id ?? '(no id)'}`);
    continue;
  }
  dossiers.push(parsed.data);
}

const sealed = dossiers.filter((d) => d.receipt !== null).sort((a, b) => a.receipt.seq - b.receipt.seq);
const unsealed = dossiers.length - sealed.length;

console.log(`AIRLOCK ledger — ${target}`);
console.log(`  ${dossiers.length} record(s), ${sealed.length} sealed, ${unsealed} still in flight`);
console.log('');

const verdict = await verifyChain(sealed);

for (const link of verdict.links) {
  const mark = link.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} #${String(link.seq).padStart(3, '0')}  ${link.dossier_id.padEnd(24)} ${link.expected.slice(7, 27)}…`);
  if (!link.ok) {
    console.log(`         fault      : ${link.fault}`);
    console.log(`         recomputed : ${link.actual || '(none)'}`);
  }
}

console.log('');
if (verdict.ok) {
  console.log(`PASS — the chain is intact across ${verdict.length} sealed record(s).`);
  console.log(`Head: ${verdict.head}`);
  console.log('');
  console.log('Keep that head hash somewhere we cannot reach. Any future edit to any');
  console.log('record above will change it, and you will be able to tell.');
  process.exit(0);
}

console.error(`FAIL — the chain breaks at record ${verdict.brokenAt} (${verdict.links[verdict.brokenAt]?.dossier_id}).`);
console.error('Every record after that point is no longer trustworthy.');
process.exit(1);

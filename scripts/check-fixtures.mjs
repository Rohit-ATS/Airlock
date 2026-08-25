/**
 * Check the console fixtures against the contract, the gate and the ledger.
 *
 * The fixtures are the first thing a judge sees, so they must be exactly what
 * they claim to be. This script asserts three things:
 *
 *   1. every fixture parses against the Change Dossier contract;
 *   2. every fixture produces the gate verdict its filename implies, so a
 *      fixture named `.standing.json` really is refused for having no expiry
 *      rather than for some unrelated reason we did not notice;
 *   3. the sealed history verifies as an unbroken hash chain.
 *
 * Run with `npm run check:fixtures`. It is also what CI runs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeParseDossier, openGate, verifyChain } from '../packages/contract/dist/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'contracts', 'examples');

/** An approver who is nobody's requester, so self-approval never masks the real reason. */
const APPROVER = { email: 'judge@airlock.dev', role: 'approver' };

/**
 * What each fixture must do at the gate, five minutes after it was verified.
 *
 * `OPEN:final` means the approve control renders and applies the change.
 * `OPEN:countersign` means it renders and collects one of two signatures.
 */
const EXPECTED = {
  dos_tier_migration: 'OPEN:final',
  dos_currency_fix: 'CERTIFICATE_FAILED',
  dos_erasure_dana: 'OPEN:final',
  dos_access_oncall: 'OPEN:countersign',
  dos_access_standing: 'GRANT_WITHOUT_EXPIRY',
  dos_refund_stripe: 'POLICY_AMOUNT_CEILING',
  dos_incident_email: 'POLICY_PEOPLE_CEILING',
  dos_replica_scaledown: 'PRODUCTION_DRIFTED',
  dos_orders_backfill: 'POLICY_LOCK_CEILING',
  dos_orders_index: 'ALREADY_APPLIED',
  // Applied, health-checked clean, and taken back anyway inside the window. The
  // gate is closed for the ordinary reason — it already went in — and the undo
  // is a later fact recorded outside the seal.
  dos_plan_column: 'ALREADY_APPLIED',
  dos_gdpr_batch: 'ALREADY_APPLIED',
  dos_bucket_delete: 'ALREADY_DECIDED',
  dos_email_unique: 'ALREADY_APPLIED',
};

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const failures = [];
const parsed = new Map();

for (const file of files) {
  const raw = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  const result = safeParseDossier(raw);
  if (!result.success) {
    failures.push(`${file}: does not match the contract\n${JSON.stringify(result.error.issues, null, 2)}`);
    continue;
  }

  const d = result.data;
  parsed.set(d.dossier_id, d);

  const expected = EXPECTED[d.dossier_id];
  if (!expected) {
    failures.push(`${file}: fixture ${d.dossier_id} has no expected gate verdict. Add one to check-fixtures.mjs.`);
    continue;
  }

  // Evaluate as if we are looking at it shortly after verification, so a
  // freshness window does not mask the reason the fixture exists to show.
  const verifiedAt = d.certificate?.verified_at ?? d.created_at;
  const now = new Date(new Date(verifiedAt).getTime() + 5 * 60 * 1000);
  const decision = openGate(d, APPROVER, { now });

  const actual =
    decision.state === 'OPEN' ? (decision.grant.final ? 'OPEN:final' : 'OPEN:countersign') : decision.reason;

  if (actual !== expected) {
    failures.push(
      `${file}: expected the gate to say ${expected}, got ${actual}` +
        (decision.state === 'SEALED' ? `\n    ${decision.message}` : ''),
    );
  } else {
    const detail = decision.state === 'OPEN' ? `${decision.grant.seals_held}/${decision.grant.seals_required} signed` : '';
    console.log(`  ok  ${d.dossier_id.padEnd(24)} ${actual.padEnd(24)} ${detail}`);
  }
}

/* --- the sealed history must verify as a chain ---------------------------- */

const history = [...parsed.values()]
  .filter((d) => d.receipt !== null)
  .sort((a, b) => a.receipt.seq - b.receipt.seq);

const chain = await verifyChain(history);
if (!chain.ok) {
  failures.push(
    `ledger chain broken at index ${chain.brokenAt} (${chain.links[chain.brokenAt]?.dossier_id}): ` +
      `${chain.links[chain.brokenAt]?.fault}`,
  );
} else {
  console.log(`  ok  ledger chain             ${chain.length} sealed records, head ${chain.head.slice(0, 20)}…`);
}

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${files.length} fixtures check out.`);

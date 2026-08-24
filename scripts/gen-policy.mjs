/**
 * Generate docs/POLICY.md from the shipped policy.
 *
 * Same discipline as CAPABILITIES.md: the policy object in
 * packages/contract/src/policy.ts is what the gate evaluates, so the document
 * describing it is derived from it rather than written beside it. A policy
 * document that disagrees with the policy is worse than no document.
 *
 * Run: node scripts/gen-policy.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DEFAULT_POLICY, resolvedRules, CHANGE_CLASS_COPY } = await import(
  pathToFileURL(path.join(root, 'packages/contract/dist/index.js')).href
);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const money = (minor) => `£${(minor / 100).toLocaleString('en-GB')}`;
const count = (n) => (n === null ? '—' : n.toLocaleString('en-GB'));
const mins = (s) => (s % 3600 === 0 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);

const lines = [];

lines.push('# AIRLOCK policy');
lines.push('');
lines.push('> **Generated file.** Edit `packages/contract/src/policy.ts` and run');
lines.push('> `node scripts/gen-policy.mjs`. Do not edit this by hand.');
lines.push('');
lines.push(`Policy \`${DEFAULT_POLICY.name}\`, version ${DEFAULT_POLICY.version}.`);
lines.push('');
lines.push('The certificate answers *"is this change what it claims to be?"*. Policy answers a');
lines.push('different question: *"is this change allowed at all, by whom, and right now?"*');
lines.push('');
lines.push('A proof cannot answer that, because it is not a property of the change — it is a');
lines.push('property of the organisation. Both are evaluated by');
lines.push('[`openGate`](../packages/contract/src/gate.ts), so a change that is genuinely proven');
lines.push('and genuinely not permitted is sealed for the second reason and told so precisely.');
lines.push('');

lines.push('## At a glance');
lines.push('');
lines.push('| Change class | Certificate | Approvers | Proof valid for | Ceilings | Break-glass |');
lines.push('| --- | --- | --- | --- | --- | --- |');

for (const { cls, rule } of resolvedRules(DEFAULT_POLICY)) {
  const ceilings = [];
  if (rule.max_records !== null) ceilings.push(`${count(rule.max_records)} records`);
  if (rule.max_people !== null) ceilings.push(`${count(rule.max_people)} people`);
  if (rule.max_amount_minor !== null) ceilings.push(money(rule.max_amount_minor));
  if (rule.require_expiry) ceilings.push('every grant expires');
  lines.push(
    `| **${cls}** | ${rule.requires} | ${rule.quorum} | ${mins(rule.freshness_seconds)} | ${
      ceilings.length ? ceilings.join('<br>') : '—'
    } | ${rule.break_glass ? 'permitted' : 'no'} |`,
  );
}

lines.push('');
lines.push('## Each class, and why');
lines.push('');

for (const { cls, rule } of resolvedRules(DEFAULT_POLICY)) {
  lines.push(`### ${cls} — ${CHANGE_CLASS_COPY[cls].title}`);
  lines.push('');
  lines.push(CHANGE_CLASS_COPY[cls].blurb);
  lines.push('');
  if (rule.note) {
    lines.push(`> ${rule.note}`);
    lines.push('');
  }
  lines.push(`- **Certificate required:** \`${rule.requires}\``);
  lines.push(
    `- **Approvers:** ${rule.quorum}${rule.quorum > 1 ? ' distinct people — a quorum counts people, not clicks' : ''}`,
  );
  lines.push(`- **Self-approval:** ${rule.allow_self_approval ? 'permitted' : 'refused — the requester may not approve'}`);
  lines.push(`- **Certificate freshness:** ${mins(rule.freshness_seconds)} after verification`);
  if (rule.max_records !== null) lines.push(`- **Record ceiling:** ${count(rule.max_records)}`);
  if (rule.max_people !== null) lines.push(`- **People ceiling:** ${count(rule.max_people)}`);
  if (rule.max_amount_minor !== null) lines.push(`- **Amount ceiling:** ${money(rule.max_amount_minor)}`);
  if (rule.require_expiry) lines.push('- **Expiry:** every principal in the change must carry one');
  if (rule.blackout.length === 0) {
    lines.push('- **Change freeze:** none');
  } else {
    for (const w of rule.blackout) {
      const days = w.days.length === 7 ? 'every day' : w.days.map((d) => DAYS[d]).join(', ');
      lines.push(`- **Change freeze:** ${days}, ${w.from}–${w.to} ${w.tz} — ${w.reason}`);
    }
  }
  lines.push(`- **Break-glass:** ${rule.break_glass ? 'permitted for this class' : 'forbidden for this class'}`);
  lines.push('');
}

lines.push('## What is deliberately absent');
lines.push('');
lines.push('There is no change freeze on `ERASURE`, `MONEY_MOVEMENT`, `ACCESS_GRANT`,');
lines.push('`SCHEMA_MIGRATION` or `DATA_OPERATION`. A freeze that blocks a right-to-erasure');
lines.push('request trades a legal problem for an operational one, and a freeze that blocks an');
lines.push('access grant means the on-call engineer cannot get into the system during the');
lines.push('incident the freeze exists to prevent. This is asserted in the test suite, so it');
lines.push('cannot be quietly reversed.');
lines.push('');

lines.push('## Break-glass');
lines.push('');
lines.push('Break-glass does **not** open the gate. It cannot: `BreakGlassOverride` carries a');
lines.push('different private symbol from `ApprovalGrant`, and no function accepts both — which');
lines.push('is asserted at compile time in');
lines.push('[`gate.typetest.ts`](../packages/contract/src/gate.typetest.ts). What it does is');
lines.push('record that a named human, during an incident, chose to go around a sealed door,');
lines.push('with a written reason of at least 40 characters, permanently, in the same ledger.');
lines.push('');
lines.push('The argument for having it at all: people do this anyway. In every organisation');
lines.push('there is a moment where the safe path is unavailable and somebody opens a psql');
lines.push('session instead. A control plane that pretends otherwise does not prevent the');
lines.push('override — it only ensures there is no record of it.');
lines.push('');
lines.push('It requires **two** switches, both off by default: the class must permit it in the');
lines.push('table above, and the deployment must set `AIRLOCK_BREAK_GLASS=1`.');
lines.push('');

lines.push('## Every reason the gate can refuse');
lines.push('');
lines.push('| Seal reason | Source |');
lines.push('| --- | --- |');
const SEALS = [
  ['ALREADY_APPLIED', 'audit'],
  ['ALREADY_DECIDED', 'audit'],
  ['NO_CERTIFICATE', 'certificate'],
  ['CERTIFICATE_PENDING', 'certificate'],
  ['CERTIFICATE_FAILED', 'certificate'],
  ['CHECKSUM_MISSING', 'proof integrity'],
  ['CHECKSUM_MISMATCH', 'proof integrity — recomputed, never trusted'],
  ['ROLLBACK_NOT_PROVEN', 'proof integrity'],
  ['SCOPE_NOT_COMPUTED', 'proof integrity'],
  ['SCOPE_UNBOUNDED', 'proof integrity'],
  ['PRODUCTION_DRIFTED', 'the world moved — recomputed, never trusted'],
  ['CERTIFICATE_STALE', 'policy — freshness'],
  ['POLICY_WRONG_CERTIFICATE', 'policy — required certificate kind'],
  ['POLICY_RECORD_CEILING', 'policy — ceiling'],
  ['POLICY_PEOPLE_CEILING', 'policy — ceiling'],
  ['POLICY_AMOUNT_CEILING', 'policy — ceiling'],
  ['POLICY_BLACKOUT', 'policy — change freeze'],
  ['GRANT_WITHOUT_EXPIRY', 'policy — no standing access'],
  ['SELF_APPROVAL', 'policy — separation of duties'],
  ['ROLE_NOT_APPROVER', 'role'],
];
for (const [reason, source] of SEALS) lines.push(`| \`${reason}\` | ${source} |`);
lines.push('');
lines.push('Order matters. The gate checks audit state, then whether a proof exists, then');
lines.push('whether the proof holds, then whether it is still true of production, then policy,');
lines.push('and only last whether *you* may act — because being told "you lack permission" when');
lines.push('the real answer is "this change is unprovable" wastes the more important fact.');
lines.push('');

fs.writeFileSync(path.join(root, 'docs/POLICY.md'), lines.join('\n'), 'utf8');
console.log(`wrote docs/POLICY.md (${resolvedRules(DEFAULT_POLICY).length} classes)`);

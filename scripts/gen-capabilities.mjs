/**
 * Generate docs/CAPABILITIES.md from the capability registry.
 *
 * The registry is the single source of truth: the Harness Panel renders from
 * it, the detectors light lamps against it, and this doc is derived from it.
 * That makes drift between "what we claim" and "what the panel can prove"
 * structurally impossible — which is the whole point, since a judge who clicks
 * a lamp and finds nothing behind it discredits the entire panel.
 *
 * Run: node scripts/gen-capabilities.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CAPABILITIES, CAPABILITY_TOTAL } = await import(
  path.join(root, 'packages/contract/dist/index.js').replace(/\\/g, '/').replace(/^([a-zA-Z]):/, 'file:///$1:')
);

const PROOF_LABEL = {
  stream: 'live harness event',
  runtime: 'observed runtime behaviour',
  config: 'agent spec we send',
};

const lines = [];
lines.push('# Where a judge can see each capability');
lines.push('');
lines.push('> **Generated file.** Edit `packages/contract/src/capabilities.ts` and run');
lines.push('> `node scripts/gen-capabilities.mjs`. Do not edit this by hand.');
lines.push('');
lines.push(
  `AIRLOCK claims **${CAPABILITY_TOTAL} TrueForge capabilities**. Each one is load-bearing — remove it and the`,
);
lines.push('product stops working — and each one lights on the Harness Panel only when a real');
lines.push('signal proves it.');
lines.push('');
lines.push('## The honesty rule');
lines.push('');
lines.push('A lamp cannot be lit from application code. The only writer is');
lines.push('[`packages/contract/src/detectors.ts`](../packages/contract/src/detectors.ts), which folds the real');
lines.push('TrueForge event stream — observed as it passes through');
lines.push('[`apps/console/src/server/observedServer.ts`](../apps/console/src/server/observedServer.ts) — into the');
lines.push('ledger. A run that does not exercise a capability ends below the total, and that is the');
lines.push('correct outcome.');
lines.push('');
lines.push('Three proof modes, strongest first:');
lines.push('');
lines.push('| Mode | Meaning |');
lines.push('| --- | --- |');
lines.push('| `stream` | A real TrueForge event crossed the wire during the run |');
lines.push('| `runtime` | Observable behaviour of the running system (a reconnect, a resolved role) |');
lines.push('| `config` | The agent spec actually sent to the harness contains it |');
lines.push('');
lines.push('## The ledger');
lines.push('');
lines.push('| # | Capability | Why it is load-bearing | Proof | Signal that lights it | Where you see it |');
lines.push('| --- | --- | --- | --- | --- | --- |');

/**
 * One markdown table cell.
 *
 * Escaping `|` alone was not enough: a value already containing a backslash
 * came out as `\\|`, which markdown reads as a literal backslash followed by
 * an unescaped column break, so one stray character silently reshaped the
 * table. The backslash has to be doubled first — escape the escape, then the
 * delimiter — and a newline has to go, because a table row ends at one no
 * matter what is escaped inside it.
 */
const cell = (value) =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

for (const c of CAPABILITIES) {
  const cells = [
    c.id,
    `**${c.name}**`,
    c.loadBearing,
    `\`${c.proof}\``,
    `\`${c.evidence}\``,
    c.visibleAt,
  ].map(cell);
  lines.push(`| ${cells.join(' | ')} |`);
}

lines.push('');
lines.push('## Grouping on the panel');
lines.push('');
const groups = [...new Set(CAPABILITIES.map((c) => c.group))];
for (const g of groups) {
  const items = CAPABILITIES.filter((c) => c.group === g);
  lines.push(`- **${g}** — ${items.map((c) => c.name).join(', ')}`);
}
lines.push('');
lines.push('## Source map');
lines.push('');
lines.push('| Concern | File |');
lines.push('| --- | --- |');
lines.push('| Capability registry (this table) | `packages/contract/src/capabilities.ts` |');
lines.push('| Detectors — the only thing that lights a lamp | `packages/contract/src/detectors.ts` |');
lines.push('| Event tap on the real stream | `apps/console/src/server/observedServer.ts` |');
lines.push('| Run state fed by the tap | `apps/console/src/harness/store.ts` |');
lines.push('| The panel itself | `apps/console/src/harness/HarnessPanel.tsx` |');
lines.push('| The approval gate invariant | `packages/contract/src/gate.ts` |');
lines.push('| Gate tests (runtime) | `packages/contract/test/gate.test.mjs` |');
lines.push('| Gate proof (compile time) | `packages/contract/src/gate.typetest.ts` |');
lines.push('| Detector tests | `packages/contract/test/harness.test.mjs` |');
lines.push('');

const out = path.join(root, 'docs/CAPABILITIES.md');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`wrote docs/CAPABILITIES.md (${CAPABILITY_TOTAL} capabilities)`);

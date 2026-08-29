/**
 * Re-date the shipped demo fixtures so the console is demonstrable today.
 *
 *   npm run demo:refresh
 *
 * The seed already lands every fixture two minutes in the past, and it does
 * that correctly — once. `seedIfEmpty` never runs again on a ledger that has
 * anything in it, so a checkout seeded yesterday is a checkout where every
 * certificate has expired and all thirteen open changes are sealed
 * CERTIFICATE_STALE. The gate is right, the console looks broken, and the one
 * human moment the product exists for cannot be reached at all.
 *
 * That is what this fixes, and the boundaries are the whole point:
 *
 *   - **Only shipped fixtures.** The ids are read from `contracts/examples/`.
 *     A real change — one an agent opened, one a webhook started — is never
 *     touched. This re-dates demo data; it does not rewrite a record of
 *     something that happened.
 *   - **Only undecided changes.** Anything approved, rejected or applied is in
 *     the hash chain and its timestamps are load-bearing. History stays where
 *     it is.
 *   - **The gate is not touched.** Freshness is still enforced exactly as
 *     before, and these certificates will expire again on their own. Leave the
 *     console open past the window and you will watch it happen, which is the
 *     rule working rather than the rule being bypassed.
 *
 * Run it before a demo. `npm run up` runs it for you.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';
const GREEN = '\x1b[32m';
const AMBER = '\x1b[33m';

const contract = await import(pathToFileURL(path.join(root, 'packages/contract/dist/index.js')).href).catch(
  () => null,
);
if (!contract) {
  console.error('Build the contract first: npm run build --workspace @airlock/contract');
  process.exit(1);
}
const { freshenFixtures, fixtureAgeSeconds, openGate, parseDossier } = contract;

/**
 * Where the console keeps its ledger.
 *
 * `AIRLOCK_DATA_DIR` is `./.airlock` by default and the app resolves it against
 * *its own* working directory, which is `apps/console` — not the repo root. A
 * script run from the root that resolves the same string against the root looks
 * in a directory that does not exist and cheerfully reports nothing to do. So
 * the candidates are tried in the order the app would produce them, and the
 * first that exists wins.
 */
function ledgerPath() {
  const fromEnv = readEnv('AIRLOCK_DATA_DIR');
  const candidates = [];
  if (fromEnv) {
    if (path.isAbsolute(fromEnv)) candidates.push(fromEnv);
    else {
      candidates.push(path.resolve(root, 'apps', 'console', fromEnv));
      candidates.push(path.resolve(root, fromEnv));
    }
  }
  candidates.push(path.join(root, 'apps', 'console', '.airlock'));
  candidates.push(path.join(root, '.airlock'));

  for (const dir of candidates) {
    const file = path.join(dir, 'ledger.json');
    if (fs.existsSync(file)) return file;
  }
  return path.join(candidates[0] ?? path.join(root, '.airlock'), 'ledger.json');
}

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const text = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm').exec(text);
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The fixtures that ship with the repo, by id. Anything else is somebody's real
 * change and is never touched.
 *
 * The shipped object is kept, not just the id, because re-dating is not the only
 * way a demo fixture drifts. Signatures drift too, and they drift *because of our
 * own checks*: `check-demo-ui.mjs` asserts that `dos_access_oncall` offers a
 * countersign control by pressing it, and `check-console-http.mjs` replays the
 * documented approvals against a running console. Either one leaves that fixture
 * holding a real countersignature, so the next run finds one of two signatures
 * already held, correctly declines to offer the same person the second, and
 * fails with "no countersign control".
 *
 * The check was right both times. The fixture had moved. That made the whole
 * suite pass once per machine and fail on every re-run, which is the worst
 * failure mode a demo check can have — it is green when you write it and red
 * when you rehearse.
 */
function shippedFixtures() {
  const dir = path.join(root, 'contracts', 'examples');
  const byId = new Map();
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    try {
      const fixture = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (fixture?.dossier_id) byId.set(fixture.dossier_id, fixture);
    } catch {
      // A fixture that will not parse is check-fixtures' problem, not ours.
    }
  }
  return byId;
}

const file = ledgerPath();
if (!fs.existsSync(file)) {
  console.log(`${DIM}No ledger at ${path.relative(root, file)} — nothing to refresh; it will seed fresh.${OFF}`);
  process.exit(0);
}

const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
const shipped = shippedFixtures();
const ids = new Set(shipped.keys());

const entries = Object.entries(ledger);
const fixtures = entries.filter(([id, d]) => ids.has(id) && !d.receipt && !d.approval?.decision && !d.audit?.applied_at);
const untouched = entries.length - fixtures.length;

if (fixtures.length === 0) {
  console.log(`${DIM}Nothing to refresh: ${entries.length} record(s), none of them open shipped fixtures.${OFF}`);
  process.exit(0);
}

const staleBy = fixtureAgeSeconds(fixtures.map(([, d]) => d));
const freshened = freshenFixtures(
  fixtures.map(([, d]) => d),
  new Date(),
);

const next = { ...ledger };
let unsigned = 0;
freshened.forEach((d, i) => {
  const id = fixtures[i][0];

  /*
   * Restore the shipped signature list along with the dates.
   *
   * Only for open shipped fixtures — the filter above has already excluded
   * anything decided, applied or carrying a receipt, so nothing in a hash chain
   * can reach this line. Within that set the shipped value is the truth: these
   * are demo data, and a seal one of our own test replays added is not a record
   * of a person deciding anything.
   */
  const want = shipped.get(id)?.signatures ?? [];
  const have = d.signatures ?? [];
  if (JSON.stringify(have) !== JSON.stringify(want)) unsigned += 1;

  next[id] = { ...d, signatures: want };
});

fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');

console.log('');
console.log(`${BOLD}Demo fixtures refreshed${OFF}`);
console.log(`   ${GREEN}ok${OFF}   ${fixtures.length} open fixture(s) re-dated ${DIM}(they were ${fmt(staleBy)} stale)${OFF}`);
if (unsigned > 0) {
  console.log(`   ${GREEN}ok${OFF}   ${unsigned} fixture(s) restored to their shipped signatures`);
}
console.log(`   ${DIM}left alone: ${untouched} sealed, decided or real record(s)${OFF}`);

// Say how many are now actually approvable. That number is the whole reason
// this script exists, and printing it means a silent failure cannot hide.
try {
  const viewer = { email: 'local-admin', role: 'approver' };
  const open = Object.values(next)
    .map((d) => {
      try {
        return parseDossier(d);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((d) => !d.approval?.decision)
    .filter((d) => openGate(d, viewer).state === 'OPEN');
  const label = open.length === 0 ? `${AMBER}none${OFF}` : `${GREEN}${open.length}${OFF}`;
  console.log(`   ${DIM}approvable now:${OFF} ${label} ${DIM}${open.map((d) => d.dossier_id).join(', ')}${OFF}`);
} catch {
  // The count is a courtesy; failing to compute it must not fail the refresh.
}
console.log('');

function fmt(seconds) {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

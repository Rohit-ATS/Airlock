/**
 * Configure the harness sandbox.
 *
 *   DAYTONA_API_KEY=dtn_… npm run harness:sandbox
 *
 * The sandbox is not optional for this project. It is one of the three things
 * the hackathon says a judge has to actually see — a real tool reached, code run
 * in a sandbox, and a pause before something irreversible — and for AIRLOCK it
 * is load-bearing rather than a box to tick: the shadow branch, the forward
 * run, the rollback and all three checksums happen there. No sandbox, no
 * certificate. No certificate, no gate.
 *
 * TrueForge 0.1.4 supports exactly one provider. The server validates
 * `manifest.type` against the literal string "daytona" and rejects everything
 * else, so there is no local or Docker-backed fallback to reach for. That is
 * worth writing down because it is not obvious from the outside: the API looks
 * pluggable, and it is not.
 *
 * Getting a key is free and takes about a minute at https://app.daytona.io —
 * sign in, Keys, Create Key. Put it in the repo-root .env as DAYTONA_API_KEY and
 * run this. It is read from there rather than passed on the command line so it
 * does not end up in a shell history or a screen recording.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8791';

/** Real process environment wins, so a one-off override still works. */
function apiKey() {
  if (process.env.DAYTONA_API_KEY) return process.env.DAYTONA_API_KEY.trim();
  try {
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const m = /^DAYTONA_API_KEY=(.+)$/m.exec(env);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const key = apiKey();
if (!key) {
  console.error('No DAYTONA_API_KEY found, in the environment or in .env.\n');
  console.error('The sandbox is where every checksum in this project is produced, so');
  console.error('without it the agent can plan a migration and can never prove one.\n');
  console.error('  1. https://app.daytona.io  ->  sign in  ->  Keys  ->  Create Key');
  console.error('  2. add DAYTONA_API_KEY=dtn_… to .env in the repo root');
  console.error('  3. npm run harness:sandbox\n');
  console.error('The free tier is enough for a demo. .env is gitignored.');
  process.exit(2);
}

const manifest = {
  type: 'daytona',
  auth: { api_key: key },
  // A verification run is a forward migration, a rollback and three checksums
  // over a shadow copy. Two minutes is generous for the demo dataset and still
  // short enough that a hung sandbox fails rather than bills.
  exec_timeout_ms: 120_000,
  auto_stop_interval_in_minutes: 15,
  auto_archive_interval_in_minutes: 60,
  auto_delete_interval_in_minutes: 1440,
};

const res = await fetch(new URL('/api/v1/settings/sandbox-providers', BASE), {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ manifest }),
});

const body = await res.text();
if (!res.ok) {
  console.error(`The harness refused the sandbox configuration (${res.status}):`);
  console.error(body.slice(0, 600));
  // The harness collapses every 401 and 403 from Daytona into one sentence
  // about credentials, and that sentence is wrong far more often than it is
  // right. Ask Daytona directly and say which of the two it actually is.
  await explain(key);
  process.exit(1);
}

console.log(`Sandbox provider configured on ${BASE}.`);

// Ask the server what it thinks rather than trusting the write. This is the
// same rule the gate applies to a verifier's own `match` flag: a claim of
// success from the thing that just acted is not evidence.
const check = await fetch(new URL('/api/v1/capabilities', BASE));
const caps = await check.json().catch(() => null);
const enabled = caps?.data?.sandbox?.enabled === true;

console.log(`  sandbox  ${enabled ? 'enabled' : 'still reporting disabled'}`);
console.log(`  skills   ${caps?.data?.skill?.enabled ? 'available' : (caps?.data?.skill?.reason ?? 'unavailable')}`);

if (!enabled) {
  console.error('\nThe key was accepted but the server still reports no sandbox.');
  console.error('Check the key is valid and not expired: npm run harness:logs');
  process.exit(1);
}

console.log('\nRe-register the agents so they pick up the sandbox and the skill packs:');
console.log('  npm run harness:setup');

/**
 * Say which failure this actually is, by asking Daytona rather than the harness.
 *
 * TrueForge tests `statusCode === 401 || statusCode === 403` and reports both as
 * "Daytona rejected the API key — check the credentials". Those are two very
 * different problems and only one of them is about the key being wrong:
 *
 *   401  the key is bad, revoked, or from another account.
 *   403  the key is *fine* and lacks a permission.
 *
 * The second is the common one, and the harness's wording sends you to
 * regenerate a key that was never the problem. What TrueForge needs is snapshot
 * creation — it registers its sandbox image as a Daytona snapshot named
 * `trueforge-build-<tag>` before it can start anything — and a Daytona key
 * created with only sandbox permissions can create sandboxes all day and still
 * get 403 on that one call.
 *
 * So this reproduces the exact request TrueForge makes and reads the status.
 * Costs one HTTP call on a path that has already failed, and turns an hour of
 * looking in the wrong place into a sentence.
 */
async function explain(apiKey) {
  const api = process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api';
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };

  const probe = async (path, init) => {
    try {
      const r = await fetch(new URL(api + path), { headers, signal: AbortSignal.timeout(20_000), ...init });
      return r.status;
    } catch {
      return null;
    }
  };

  console.error('\n--- what Daytona says about this key -------------------------------');

  const canRead = await probe('/sandbox');
  if (canRead === null) {
    console.error('Daytona could not be reached from here at all. That is a network');
    console.error('problem, not a credentials problem — check egress and try again.');
    return;
  }
  if (canRead === 401) {
    console.error('  list sandboxes    401  — the key really is rejected.');
    console.error('\nThis one IS the credentials. Create a fresh key and update .env:');
    console.error('  https://app.daytona.io  ->  Keys  ->  Create Key');
    return;
  }
  console.error(`  list sandboxes    ${canRead}  — the key authenticates.`);

  // The call TrueForge actually fails on. A public image is used deliberately:
  // if this is refused, the problem cannot be the private sandbox registry.
  const canBuild = await probe('/snapshots', {
    method: 'POST',
    body: JSON.stringify({ name: `airlock-permission-probe-${Date.now()}`, imageName: 'alpine:3.19' }),
  });
  console.error(`  create snapshot   ${canBuild}  — this is the call TrueForge fails on.`);

  if (canBuild === 403) {
    console.error('\nThe key is valid and lacks one permission.');
    console.error('');
    console.error('TrueForge registers its sandbox image as a Daytona snapshot before it can');
    console.error('start anything, so it needs snapshot creation — not just sandbox creation.');
    console.error('The harness reports this as "check the credentials", which it is not.');
    console.error('');
    console.error('  1. https://app.daytona.io  ->  Keys  ->  Create Key');
    console.error('  2. grant the SNAPSHOTS permissions (create/read/delete) as well as SANDBOXES');
    console.error('  3. replace DAYTONA_API_KEY in .env with the new key');
    console.error('  4. npm run harness:sandbox');
  } else if (canBuild !== null && canBuild >= 200 && canBuild < 300) {
    console.error('\nDaytona accepted that snapshot from here, so the permission is present.');
    console.error('The harness may be unable to reach Daytona from inside its container:');
    console.error('  docker compose -f harness/docker-compose.yml exec server \\');
    console.error("    node -e \"fetch('https://app.daytona.io/api/sandbox').then(r=>console.log(r.status))\"");
  }
}

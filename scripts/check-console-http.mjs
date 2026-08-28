/**
 * The console, exercised over real HTTP.
 *
 * Everything else in this repository is tested as a function. The gate is tested
 * as a function, the policy engine is tested as a function, the receipt chain is
 * tested as a function — and all of that is worth having. But the thing a judge
 * opens, and the thing the README hands them a `curl` for, is an HTTP server,
 * and until this file existed nothing asserted that the server behaved the way
 * the documentation said it did.
 *
 * That gap was not theoretical. Three defects lived in it:
 *
 *   1. `POST /api/dossiers/{id}/decision` read
 *      `body.decision === 'rejected' ? 'rejected' : 'approved'`, so every input
 *      that was not the exact string "rejected" approved the change. A tense
 *      typo — `{"decision":"reject"}` — approved a schema migration and
 *      answered 200. The unit tests could not see it, because the bug was in
 *      the route rather than in `decide()`.
 *
 *   2. The README's forged-dossier transcript — the one it introduces with
 *      "both of these are transcripts, not illustrations" — could not run at
 *      all against a production server, because `POST /api/dossiers` requires a
 *      machine token and the documented command never sent one.
 *
 *   3. On a fresh clone with no harness running, viewer resolution fell back to
 *      `requester`, so every approve control was absent and the demo's
 *      centrepiece could not be performed by anybody who had not already set
 *      the project up. It worked on the author's machine and nowhere else.
 *
 * All three are the same failure: a claim about the running system, checked only
 * by reading it. So this boots the built console on an ephemeral port, against a
 * throwaway ledger, and replays the documented interactions against it.
 *
 * It is hermetic on purpose, and the mechanism matters: the child runs with its
 * cwd set to an empty temporary directory and the app located with
 * `next start <dir>`. The console's `.env` loader searches relative to cwd, so
 * this is what makes "a fresh clone with nothing configured" reproducible on a
 * machine that has a fully configured `.env` — which is exactly the machine the
 * demo is recorded on, and exactly why defect 3 survived so long.
 *
 * Run: node scripts/check-console-http.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const consoleDir = path.join(root, 'apps', 'console');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const TOKEN = 'airlock-test-token-do-not-use-in-production';
/** A port nothing is listening on, to stand for a harness that is down. */
const DEAD_HARNESS = 'http://127.0.0.1:9';

let pass = 0;
const failures = [];

function check(condition, label, detail) {
  if (condition) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push({ label, detail });
    console.log(`  FAIL ${label}\n         ${detail}`);
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Boot the built console in a controlled posture.
 *
 * `cwd` is a scratch directory rather than the repo, so the console's `.env`
 * search finds nothing and the caller's `env` is the entire configuration.
 */
function startConsole({ port, dataDir, cwd, env }) {
  const child = spawn(process.execPath, [nextBin, 'start', consoleDir], {
    cwd,
    env: {
      ...process.env,
      // Strip every key the console reads from the ambient environment, so a
      // developer's shell cannot change the posture under test.
      TRUEFORGE_BASE_URL: undefined,
      NEXT_PUBLIC_TRUEFORGE_BASE_URL: undefined,
      AIRLOCK_LOCAL_OPERATOR: undefined,
      AIRLOCK_NO_SEED: undefined,
      AIRLOCK_BREAK_GLASS: undefined,
      NODE_ENV: 'production',
      PORT: String(port),
      AIRLOCK_DATA_DIR: dataDir,
      AIRLOCK_API_TOKEN: TOKEN,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  return { child, log: () => log };
}

async function waitForReady(base, child, log, deadlineMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    if (child.exitCode !== null) {
      throw new Error(`console exited with code ${child.exitCode} before becoming ready:\n${log()}`);
    }
    try {
      const res = await fetch(`${base}/api/config`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`console did not become ready within ${deadlineMs}ms:\n${log()}`);
}

function makeClient(base) {
  return async function req(method, p, { body, headers } = {}) {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(headers ?? {}),
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };
}

/** Boot a console, hand it to `body`, and always tear it down. */
async function withConsole(env, body) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'airlock-data-'));
  const cwd = mkdtempSync(path.join(tmpdir(), 'airlock-cwd-'));
  const { child, log } = startConsole({ port, dataDir, cwd, env });
  try {
    await waitForReady(base, child, log);
    await body(makeClient(base), base);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
    for (const dir of [dataDir, cwd]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 1. A fresh clone: nothing configured, one local operator, said out loud      */
/* -------------------------------------------------------------------------- */

async function freshClone() {
  console.log('\nA fresh clone — nothing configured at all');
  await withConsole({ AIRLOCK_BREAK_GLASS: '1' }, async (req, base) => {
    {
      const r = await req('GET', '/api/me');
      check(r.json?.role === 'approver', 'the local operator may approve', `role=${r.json?.role}`);
      check(r.json?.standalone === true, 'and the console says it is standalone', `standalone=${r.json?.standalone}`);
      check(r.json?.authenticated === false, 'without claiming anybody authenticated them', `authenticated=${r.json?.authenticated}`);
    }

    {
      const r = await req('GET', '/api/dossiers');
      check(r.status === 200 && r.json?.dossiers?.length === 18, 'the queue seeds 18 changes', `got ${r.status}, ${r.json?.dossiers?.length} dossiers`);
    }

    console.log('\n  A decision verb is matched exactly, never defaulted');
    for (const [body, why] of [
      ['{"decision":"reject"}', 'a tense typo'],
      ['{"decision":"REJECTED"}', 'the wrong case'],
      ['{"decision":"no"}', 'an unrecognised verb'],
      ['{"decision":null}', 'an explicit null'],
      ['{}', 'no decision at all'],
      ['', 'an empty body'],
    ]) {
      const r = await req('POST', '/api/dossiers/dos_tier_migration/decision', { body });
      check(
        r.status === 400 && r.json?.error === 'INVALID_DECISION',
        `${why.padEnd(24)} → 400 INVALID_DECISION`,
        `got ${r.status} ${r.json?.error ?? r.text.slice(0, 120)}`,
      );
      const after = await req('GET', '/api/dossiers');
      const d = after.json?.dossiers?.find((x) => x.dossier_id === 'dos_tier_migration');
      check(d?.approval?.decision === null, `${why.padEnd(24)} left the change undecided`, `decision=${JSON.stringify(d?.approval?.decision)}`);
    }

    console.log('\n  DEMO.md: the six refusals, over HTTP with no browser');
    for (const [id, expected] of [
      ['dos_currency_fix', 'CERTIFICATE_FAILED'],
      ['dos_access_standing', 'GRANT_WITHOUT_EXPIRY'],
      ['dos_refund_stripe', 'POLICY_AMOUNT_CEILING'],
      ['dos_incident_email', 'POLICY_PEOPLE_CEILING'],
      ['dos_replica_scaledown', 'PRODUCTION_DRIFTED'],
      ['dos_orders_backfill', 'POLICY_LOCK_CEILING'],
    ]) {
      const r = await req('POST', `/api/dossiers/${id}/decision`, { body: { decision: 'approved' } });
      check(r.status === 403 && r.json?.error === expected, `${id.padEnd(24)} → 403 ${expected}`, `got ${r.status} ${r.json?.error ?? r.text.slice(0, 120)}`);
    }

    console.log('\n  DEMO.md: the four undo refusals');
    for (const [id, expected] of [
      ['dos_plan_column', 'ALREADY_UNDONE'],
      ['dos_gdpr_batch', 'UNPROVEN'],
      ['dos_orders_index', 'CLOSED'],
      ['dos_email_unique', 'SUPERSEDED'],
    ]) {
      const r = await req('GET', `/api/dossiers/${id}/undo`);
      check(r.json?.state === expected, `${id.padEnd(24)} undo → ${expected}`, `got ${r.status} state=${r.json?.state}`);
    }

    console.log('\n  Machine writes are authenticated');
    {
      const a = await req('POST', '/api/dossiers', { body: { dossier_id: 'nope' } });
      check(a.status === 401, 'no token → 401', `got ${a.status}`);
      const b = await req('POST', '/api/dossiers', { body: { dossier_id: 'nope' }, headers: { authorization: 'Bearer wrong' } });
      check(b.status === 401, 'a wrong token → 401', `got ${b.status}`);
    }

    console.log('\n  README: a dossier that lies about its own checksums');
    {
      const list = await req('GET', '/api/dossiers');
      const src = list.json?.dossiers?.find((d) => d.dossier_id === 'dos_tier_migration');
      const liar = JSON.parse(JSON.stringify(src));
      liar.dossier_id = 'dos_liar';
      liar.certificate.checksums.post_rollback = 'sha256:' + 'd'.repeat(64);
      liar.certificate.checksums.match = true;
      const put = await req('POST', '/api/dossiers', { body: liar, headers: { authorization: `Bearer ${TOKEN}` } });
      check(put.status === 200, 'the forgery is accepted for storage', `got ${put.status} ${put.text.slice(0, 200)}`);
      const dec = await req('POST', '/api/dossiers/dos_liar/decision', { body: { decision: 'approved' } });
      check(
        dec.status === 403 && dec.json?.error === 'CHECKSUM_MISMATCH',
        'approving the forgery → 403 CHECKSUM_MISMATCH',
        `got ${dec.status} ${dec.json?.error ?? dec.text.slice(0, 200)}`,
      );
    }

    console.log('\n  Cross-origin writes, unsigned webhooks and unknown changes');
    {
      const a = await req('POST', '/api/dossiers/dos_tier_migration/decision', {
        body: { decision: 'approved' },
        headers: { origin: 'https://evil.example' },
      });
      check(a.status === 403, 'cross-origin decision → 403', `got ${a.status}`);
      const b = await req('POST', '/api/webhook/github', { body: {} });
      check([401, 403, 503].includes(b.status), 'unsigned webhook refused', `got ${b.status}`);
      const c = await req('GET', '/api/dossiers/dos_nope/receipt');
      check(c.status === 404, 'receipt for an unknown change → 404', `got ${c.status}`);
      const d = await req('POST', '/api/dossiers/dos_nope/decision', { body: { decision: 'approved' } });
      check(d.status === 404, 'decision on an unknown change → 404', `got ${d.status}`);
    }

    console.log('\n  Every read route answers, every page renders');
    {
      for (const p of ['/api/config', '/api/me', '/api/posture', '/api/activity', '/api/dossiers/dos_orders_index/receipt']) {
        const r = await req('GET', p);
        check(r.status === 200, `GET ${p}`, `got ${r.status} ${r.text.slice(0, 120)}`);
      }
      for (const p of ['/', '/console', '/control']) {
        const res = await fetch(base + p);
        const html = await res.text();
        check(res.status === 200 && html.length > 1000, `GET ${p}`, `got ${res.status}, ${html.length} bytes`);
      }
    }

    console.log('\n  DEMO.md: the approvals a judge is told to perform');
    {
      const r = await req('POST', '/api/dossiers/dos_tier_migration/decision', { body: { decision: 'approved' } });
      check(r.status === 200 && r.json?.state === 'decided', 'dos_tier_migration approves', `got ${r.status} ${r.text.slice(0, 200)}`);

      const c = await req('POST', '/api/dossiers/dos_access_oncall/decision', { body: { decision: 'approved' } });
      check(c.status === 200 && c.json?.state === 'countersigned', 'dos_access_oncall takes one signature of two', `got ${c.status} state=${c.json?.state}`);

      const again = await req('POST', '/api/dossiers/dos_access_oncall/decision', { body: { decision: 'approved' } });
      check(again.status === 403 && again.json?.error === 'SELF_APPROVAL', 'the same person signing twice → SELF_APPROVAL', `got ${again.status} ${again.json?.error}`);

      const rej = await req('POST', '/api/dossiers/dos_plan_name_retire/decision', { body: { decision: 'rejected', reason: 'not this week' } });
      check(rej.status === 200, 'an explicit rejection is accepted', `got ${rej.status} ${rej.text.slice(0, 160)}`);

      const after = await req('GET', '/api/dossiers');
      const d = after.json?.dossiers?.find((x) => x.dossier_id === 'dos_plan_name_retire');
      check(d?.approval?.decision === 'rejected', 'the rejection is recorded as a rejection', `got ${JSON.stringify(d?.approval?.decision)}`);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* 2. A configured harness that is down: still nobody's approver                */
/* -------------------------------------------------------------------------- */

async function configuredButUnreachable() {
  console.log('\nA harness was configured and is not answering');
  console.log('  (the audit property: a dropped container must not mint approvers)');
  await withConsole({ TRUEFORGE_BASE_URL: DEAD_HARNESS }, async (req) => {
    const me = await req('GET', '/api/me');
    check(me.json?.role === 'requester', 'the caller is a requester', `role=${me.json?.role}`);
    check(me.json?.standalone === false, 'and is NOT told this is standalone mode', `standalone=${me.json?.standalone}`);

    const r = await req('POST', '/api/dossiers/dos_tier_migration/decision', { body: { decision: 'approved' } });
    check(
      r.status === 403 && r.json?.error === 'ROLE_NOT_APPROVER',
      'a proven, permitted change still cannot be approved',
      `got ${r.status} ${r.json?.error ?? r.text.slice(0, 160)}`,
    );

    // The console must stay readable: a requester can inspect everything.
    const list = await req('GET', '/api/dossiers');
    check(list.status === 200 && list.json?.dossiers?.length === 18, 'but every change is still readable', `got ${list.status}`);
  });
}

/* -------------------------------------------------------------------------- */
/* 3. Standalone switched off deliberately                                     */
/* -------------------------------------------------------------------------- */

async function strictOverride() {
  console.log('\nStandalone switched off deliberately (AIRLOCK_LOCAL_OPERATOR=0)');
  await withConsole({ AIRLOCK_LOCAL_OPERATOR: '0' }, async (req) => {
    const me = await req('GET', '/api/me');
    check(me.json?.role === 'requester', 'nothing is configured, and still nobody approves', `role=${me.json?.role}`);
    const r = await req('POST', '/api/dossiers/dos_tier_migration/decision', { body: { decision: 'approved' } });
    check(r.status === 403 && r.json?.error === 'ROLE_NOT_APPROVER', 'the gate stays shut', `got ${r.status} ${r.json?.error}`);
  });
}

async function main() {
  if (!existsSync(path.join(consoleDir, '.next'))) {
    console.error(
      'The console is not built. Run:\n  npm run build --workspace @airlock/console\n' +
      '(`npm test` builds it for you; this check needs the production server.)',
    );
    process.exit(1);
  }

  await freshClone();
  await configuredButUnreachable();
  await strictOverride();

  console.log('');
  if (failures.length > 0) {
    console.error(`Console HTTP checks failed — ${failures.length} of ${pass + failures.length}:\n`);
    for (const f of failures) console.error(`  - ${f.label}\n      ${f.detail}`);
    process.exit(1);
  }

  console.log(`Console HTTP surface checks out — ${pass} assertions against a running server.`);
}

main().catch((error) => {
  console.error(`\ncheck-console-http failed to run: ${error?.stack ?? error}`);
  process.exit(1);
});

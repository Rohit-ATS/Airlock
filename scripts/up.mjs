/**
 * Bring the whole of AIRLOCK up, with one command, from a cold machine.
 *
 *   npm run up
 *
 * There are four moving parts — a Postgres/Redis/TrueForge stack in Docker, the
 * AIRLOCK MCP server on the host, the harness wiring that introduces them, and
 * the console — and until now bringing them up meant running four commands in
 * the right order and knowing which failures were fatal. That is a bad thing to
 * hand a stranger with a clone of the repo and twenty minutes, and it is a
 * worse thing to do live in front of a judge.
 *
 * The design rule here is that every step either proves it worked or stops and
 * says what to do. A script that prints "done" while the harness is still
 * booting is how you end up debugging a console that was never going to work.
 *
 *   npm run up            bring everything up
 *   npm run up -- --fast  skip the console rebuild if the build looks current
 *   PORT=3001 npm run up  serve the console somewhere else
 *   npm run down          stop what this started
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consoleDir = path.join(root, 'apps', 'console');
const logDir = path.join(root, '.airlock-logs');

const PORT = Number(process.env.PORT ?? 3000);
const HARNESS = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8791';
const MCP_PORT = Number(process.env.AIRLOCK_MCP_PORT ?? 8975);
const FAST = process.argv.includes('--fast');

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const AMBER = '\x1b[33m';

let step = 0;
const say = (msg) => console.log(msg);
const heading = (msg) => console.log(`\n${BOLD}${++step}. ${msg}${OFF}`);
const ok = (msg) => console.log(`   ${GREEN}ok${OFF}   ${msg}`);
const note = (msg) => console.log(`   ${DIM}${msg}${OFF}`);
const warn = (msg) => console.log(`   ${AMBER}warn${OFF} ${msg}`);

/** Stop, and say what to do about it. A vague failure here costs an hour. */
function die(what, remedy) {
  console.error(`\n   ${RED}stop${OFF} ${what}`);
  if (remedy) console.error(`   ${DIM}${remedy}${OFF}`);
  console.error('');
  process.exit(1);
}

/**
 * Run an external command — `docker`, `powershell`.
 *
 * No shell. Windows will not resolve a bare `docker` without PATHEXT, so the
 * `.exe` is named explicitly instead: going through a shell would mean every
 * argument is concatenated rather than escaped, which Node now warns about and
 * which is a genuinely bad habit in a script that handles paths.
 */
const exe = (cmd) => (process.platform === 'win32' ? `${cmd}.exe` : cmd);
const run = (cmd, args, opts = {}) =>
  spawnSync(exe(cmd), args, { cwd: root, encoding: 'utf8', shell: false, ...opts });

/**
 * Run something with this same Node.
 *
 * Deliberately *not* through a shell. `process.execPath` is
 * `C:\Program Files\nodejs\node.exe` on a default Windows install, and a shell
 * splits that at the space — `'C:\Program' is not recognized`. Spawning the
 * executable directly needs no quoting and no PATH lookup.
 */
const runNode = (args, opts = {}) =>
  spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', shell: false, ...opts });

const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until `check` returns true, or give up and say so. */
async function waitFor(label, check, { timeoutMs = 120_000, everyMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`   ${DIM}waiting for ${label}${OFF}`);
  for (;;) {
    if (await check()) {
      process.stdout.write('\r\x1b[K');
      return true;
    }
    if (Date.now() > deadline) {
      process.stdout.write('\r\x1b[K');
      return false;
    }
    process.stdout.write('.');
    await sleep(everyMs);
  }
}

async function reachable(url, { expect = null } = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (expect !== null && res.status !== expect) return false;
    return res.ok || res.status === expect;
  } catch {
    return false;
  }
}

/* --- 1. preflight ---------------------------------------------------------- */

heading('Preflight');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 14)) {
  die(`Node ${process.versions.node} is too old.`, 'This project needs Node >= 22.14.');
}
ok(`node ${process.versions.node}`);

if (run('docker', ['--version']).status !== 0) {
  die('Docker is not on PATH.', 'Install Docker Desktop, or start the harness yourself and re-run with the stack already up.');
}
if (run('docker', ['info']).status !== 0) {
  die('Docker is installed but not running.', 'Start Docker Desktop and run this again.');
}
ok('docker is running');

const envFile = path.join(root, '.env');
if (!fs.existsSync(envFile)) {
  const example = path.join(root, '.env.example');
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, envFile);
    warn('.env did not exist — copied .env.example. Add your model key before a real run.');
  } else {
    die('.env is missing and there is no .env.example to copy.');
  }
} else {
  ok('.env found');
}

// Read it the same way the app does, so this reports what the app will see.
let envText = fs.readFileSync(envFile, 'utf8');
const envHas = (key) => new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(envText);
if (!envHas('OPENAI_API_KEY') && !process.env.OPENAI_API_KEY) {
  warn('No OPENAI_API_KEY. The stack will come up; a turn will fail until you add one.');
} else {
  ok('model key present');
}

/*
 * The machine-write token, minted here if it does not exist.
 *
 * `next start` runs with NODE_ENV=production, so the console refuses every
 * unauthenticated write into the ledger — correctly. But nothing generated the
 * token, and nothing checked for it, so a cold clone came up looking perfectly
 * healthy and then failed the *first* `airlock_open_change` with "refusing
 * machine writes". The agent then reported, quite reasonably, that AIRLOCK was
 * misconfigured, which is a terrible sentence to read for the first time in
 * front of an audience.
 *
 * Generated rather than prompted for: it is a shared secret between processes
 * on this machine with no counterpart anywhere else, so there is nothing for a
 * human to decide and no reason to make them decide it. Written to .env so the
 * console, the MCP server and the verifier scripts all read the same value.
 */
if (!envHas('AIRLOCK_API_TOKEN') && !process.env.AIRLOCK_API_TOKEN) {
  const token = `alk_${randomBytes(32).toString('hex')}`;
  const block =
    '\n## Machine-to-machine writes into the ledger. Generated by `npm run up`.\n' +
    '## The MCP server and the verifier scripts send it as `Authorization: Bearer`;\n' +
    '## the console compares it timing-safely. Local to this machine; never commit .env.\n' +
    `AIRLOCK_API_TOKEN=${token}\n`;
  fs.appendFileSync(envFile, envText.endsWith('\n') ? block : `\n${block}`);
  envText = fs.readFileSync(envFile, 'utf8');
  ok('machine-write token generated');
} else {
  ok('machine-write token present');
}

const harnessEnv = path.join(root, 'harness', '.env');
if (!fs.existsSync(harnessEnv)) {
  // The compose file declares `env_file: [.env]` relative to harness/.
  fs.copyFileSync(envFile, harnessEnv);
  note('harness/.env created from .env (compose reads that one)');
}

fs.mkdirSync(logDir, { recursive: true });

/* --- 2. the harness -------------------------------------------------------- */

heading('TrueForge harness (Docker)');

if (await reachable(`${HARNESS}/healthz`)) {
  ok(`already healthy at ${HARNESS}`);
} else {
  note('docker compose up -d');
  const up = run('docker', ['compose', '-f', 'harness/docker-compose.yml', 'up', '-d'], { stdio: 'inherit' });
  if (up.status !== 0) die('docker compose failed.', 'Run `npm run harness:logs` to see why.');

  const healthy = await waitFor(`${HARNESS}/healthz`, () => reachable(`${HARNESS}/healthz`), { timeoutMs: 180_000 });
  if (!healthy) die('The harness did not become healthy.', 'Run `npm run harness:logs` to see why.');
  ok(`healthy at ${HARNESS}`);
}

/* --- 3. the MCP server ----------------------------------------------------- */

heading('AIRLOCK MCP server');

const mcpUrl = `http://localhost:${MCP_PORT}/healthz`;
if (await reachable(mcpUrl)) {
  ok(`already serving on :${MCP_PORT}`);
} else {
  const out = fs.openSync(path.join(logDir, 'mcp.log'), 'a');
  const child = spawn(process.execPath, ['packages/mcp/bin/airlock-mcp.mjs', '--http', String(MCP_PORT)], {
    cwd: root,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  if (!(await waitFor(`:${MCP_PORT}`, () => reachable(mcpUrl), { timeoutMs: 60_000 }))) {
    die('The MCP server did not come up.', `See ${path.relative(root, path.join(logDir, 'mcp.log'))}`);
  }
  ok(`serving on :${MCP_PORT}  ${DIM}(log: .airlock-logs/mcp.log)${OFF}`);
}

/* --- 4. wiring ------------------------------------------------------------- */

heading('Wiring the harness to AIRLOCK');

const setup = runNode(['scripts/harness-setup.mjs'], { stdio: 'pipe' });
if (setup.status !== 0) {
  console.error(setup.stdout ?? '');
  console.error(setup.stderr ?? '');
  die('harness-setup failed.');
}
// Echo the lines that say what was actually registered.
for (const line of (setup.stdout ?? '').split('\n')) {
  if (/^\s{2}(models|connector|tools|gate|model|sandbox|skills|connectors)\s/.test(line)) say(`   ${DIM}${line.trim()}${OFF}`);
}
ok('provider, connector and agent registered');

/* --- 5. the demo fixtures, re-dated --------------------------------------- */

/*
 * Before the console starts, not after.
 *
 * A certificate has a freshness window of ten to thirty minutes, and the seed
 * only ever runs against an empty ledger. So a checkout used yesterday opens
 * today with every undecided fixture expired and every gate sealed
 * CERTIFICATE_STALE — the rule working exactly as designed, and a console that
 * looks broken, with the one human moment the product exists for unreachable.
 *
 * `demo-refresh.mjs` exists to prevent that and its header said "npm run up
 * runs it for you". It did not: nothing here called it. It also could not have
 * worked if it had, because the helpers it imports were never re-exported from
 * the contract's barrel, so it threw on every invocation.
 *
 * The ordering matters: the store caches the ledger in memory on first read, so
 * re-dating the file after the console is serving would leave the console
 * showing the stale copy it had already loaded.
 *
 * A failure here is a warning rather than a stop. It touches demo data only,
 * and refusing to bring up a working stack over it would be the wrong trade —
 * but it is said out loud, because silence is what let this rot.
 */
heading('Demo fixtures');

const refresh = runNode(['scripts/demo-refresh.mjs'], { stdio: 'pipe' });
if (refresh.status === 0) {
  const lines = (refresh.stdout ?? '').split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim());
  const redated = lines.find((l) => /re-dated/.test(l));
  const approvable = lines.find((l) => /approvable|open at the gate/i.test(l));
  ok(redated ? redated.replace(/^ok\s+/, '') : 'nothing needed re-dating');
  if (approvable) note(approvable.replace(/^ok\s+/, ''));
} else {
  warn('demo-refresh failed — open fixtures may be past their freshness window.');
  for (const line of `${refresh.stdout ?? ''}${refresh.stderr ?? ''}`.split('\n').filter(Boolean).slice(-4)) {
    note(line.trim());
  }
  note('The stack is fine; the seeded certificates may all read CERTIFICATE_STALE.');
}

/* --- 6. the console -------------------------------------------------------- */

heading(`Console on :${PORT}`);

freePort(PORT);

const buildId = path.join(consoleDir, '.next', 'BUILD_ID');
const needsBuild = !FAST || !fs.existsSync(buildId) || sourceNewerThan(buildId);
if (needsBuild) {
  note('next build (a stale .next is the single most common cause of a blank console)');
  /*
   * `--webpack`, for the same reason `apps/console/package.json` passes it.
   *
   * Next 16 runs Turbopack by default and *refuses to build* when it finds a
   * `webpack` config and no `turbopack` one — which this project has, to alias
   * away an optional `ai` import that `@openuidev/react-headless` never
   * executes. Without the flag the build dies with "Call retries were exceeded"
   * and a WorkerError, which reads like a broken machine rather than a missing
   * argument. `npm run build` had the flag and this did not, so the two ways of
   * building the console disagreed.
   */
  const buildArgs = [nextBin, 'build', '--webpack'];
  const build = runNode(buildArgs, { cwd: consoleDir, stdio: 'pipe' });
  if (build.status !== 0) {
    // This repo lives under OneDrive on the author's machine, where sync can
    // pull files out from under a build. One retry turns that from a failure
    // into a hiccup.
    warn('build failed once, retrying');
    const again = runNode(buildArgs, { cwd: consoleDir, stdio: 'inherit' });
    if (again.status !== 0) die('The console build failed twice.', 'Nothing else is running that could be clobbering .next?');
  }
  ok('built');
} else {
  ok('build is current, reusing it');
}

const consoleOut = fs.openSync(path.join(logDir, 'console.log'), 'a');
const server = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
  cwd: consoleDir,
  detached: true,
  stdio: ['ignore', consoleOut, consoleOut],
  windowsHide: true,
});
server.unref();

const base = `http://localhost:${PORT}`;
if (!(await waitFor(base, () => reachable(`${base}/console`), { timeoutMs: 120_000 }))) {
  die('The console did not start.', `See ${path.relative(root, path.join(logDir, 'console.log'))}`);
}
ok(`serving  ${DIM}(log: .airlock-logs/console.log)${OFF}`);

/* --- 6. prove it ----------------------------------------------------------- */

heading('Checking it actually works');

const checks = [
  ['landing', `${base}/`],
  ['console', `${base}/console`],
  ['control room', `${base}/control`],
  ['config', `${base}/api/config`],
  ['harness proxy', `${base}/harness/healthz`],
  ['harness direct', `${HARNESS}/healthz`],
  ['mcp', mcpUrl],
];

let failed = 0;
for (const [label, url] of checks) {
  const good = await reachable(url);
  if (!good) failed++;
  console.log(`   ${good ? `${GREEN}ok${OFF}  ` : `${RED}FAIL${OFF}`} ${label.padEnd(15)} ${DIM}${url}${OFF}`);
}

// The tool list is the one check that proves the container can reach back to
// the host. Everything else can pass while that is broken.
try {
  const res = await fetch(`${HARNESS}/api/v1/mcp-servers/airlock/tools`, { signal: AbortSignal.timeout(20_000) });
  const tools = (await res.json())?.data ?? [];
  if (tools.length > 0) console.log(`   ${GREEN}ok${OFF}   ${'airlock tools'.padEnd(15)} ${DIM}${tools.length} discovered through the container${OFF}`);
  else {
    failed++;
    console.log(`   ${RED}FAIL${OFF} airlock tools   ${DIM}none discovered — the harness cannot reach the host MCP${OFF}`);
  }
} catch {
  failed++;
  console.log(`   ${RED}FAIL${OFF} airlock tools   ${DIM}could not ask the harness${OFF}`);
}

if (failed > 0) {
  console.error(`\n${RED}${failed} check(s) failed.${OFF} Logs are in .airlock-logs/.\n`);
  process.exit(1);
}

console.log(`\n${BOLD}AIRLOCK is up.${OFF}\n`);
console.log(`   landing        ${BOLD}${base}${OFF}`);
console.log(`   console        ${BOLD}${base}/console${OFF}`);
console.log(`   control room   ${BOLD}${base}/control${OFF}`);
console.log('');
console.log(`   ${BOLD}see it work:   npm run demo${OFF}   ${DIM}three real changes, proven live, ~90 seconds${OFF}`);
console.log('');
console.log(`   ${DIM}seed the db:   npm run seed:supabase -- --reset    (once — the demo needs real rows)${OFF}`);
console.log(`   ${DIM}drive a turn:  npm run harness:turn -- "Check the gate on dos_tier_migration."${OFF}`);
console.log(`   ${DIM}stop it all:   npm run down${OFF}`);
console.log('');

/* --- helpers --------------------------------------------------------------- */

/** Whatever is on this port, it is not ours and it is in the way. */
function freePort(port) {
  if (process.platform === 'win32') {
    const found = run('powershell', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
    ]);
    const pids = (found.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const pid of pids) {
      run('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]);
      note(`stopped pid ${pid}, which was holding :${port}`);
    }
  } else {
    const found = run('sh', ['-c', `lsof -ti tcp:${port} || true`]);
    for (const pid of (found.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean)) {
      run('sh', ['-c', `kill -9 ${pid} || true`]);
      note(`stopped pid ${pid}, which was holding :${port}`);
    }
  }
}

/** Is any console source newer than the last build? */
function sourceNewerThan(marker) {
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|css|mjs|json)$/.test(entry.name)) {
        const m = fs.statSync(full).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(path.join(consoleDir, 'src'));
  walk(path.join(consoleDir, 'app'));
  walk(path.join(root, 'packages', 'contract', 'src'));
  try {
    return newest > fs.statSync(marker).mtimeMs;
  } catch {
    return true;
  }
}

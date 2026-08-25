/**
 * Stop everything `npm run up` started.
 *
 *   npm run down             stop the console, the MCP server and the harness
 *   npm run down -- --keep-data   leave the Postgres volume alone (default)
 *   npm run down -- --purge       remove the volume too, for a clean slate
 *
 * The default deliberately keeps the Postgres volume. Sessions and turns live
 * there, and "stop the stack" should not quietly mean "throw away the run you
 * were about to demo".
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PORT = Number(process.env.PORT ?? 3000);
const MCP_PORT = Number(process.env.AIRLOCK_MCP_PORT ?? 8975);
const PURGE = process.argv.includes('--purge');

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';
const GREEN = '\x1b[32m';

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

const ok = (msg) => console.log(`   ${GREEN}ok${OFF}   ${msg}`);
const note = (msg) => console.log(`   ${DIM}${msg}${OFF}`);

function killPort(port, label) {
  let killed = 0;
  if (process.platform === 'win32') {
    const found = run('powershell', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
    ]);
    for (const pid of (found.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      run('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]);
      killed++;
    }
  } else {
    const found = run('sh', ['-c', `lsof -ti tcp:${port} || true`]);
    for (const pid of (found.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean)) {
      run('sh', ['-c', `kill -9 ${pid} || true`]);
      killed++;
    }
  }
  if (killed) ok(`${label} stopped (:${port})`);
  else note(`${label} was not running (:${port})`);
}

console.log(`\n${BOLD}Stopping AIRLOCK${OFF}\n`);

killPort(PORT, 'console');
killPort(MCP_PORT, 'mcp server');

const args = ['compose', '-f', 'harness/docker-compose.yml', 'down'];
if (PURGE) args.push('--volumes');
const down = run('docker', args);
if (down.status === 0) ok(`harness stopped${PURGE ? ' and its volume removed' : ''}`);
else note('docker compose down did not run — Docker may already be stopped');

if (!PURGE) note('Postgres volume kept. Use `npm run down -- --purge` to wipe it.');
console.log('');

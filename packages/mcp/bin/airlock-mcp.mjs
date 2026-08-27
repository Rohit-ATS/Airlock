#!/usr/bin/env node
/**
 * AIRLOCK MCP server, stdio transport.
 *
 * Mount it from a TrueForge agent spec:
 *
 *   { "name": "airlock",
 *     "command": "node",
 *     "args": ["/path/to/Airlock/packages/mcp/bin/airlock-mcp.mjs"],
 *     "enable_tools": ["@all"],
 *     "require_approval_for_tools": ["airlock_request_approval"] }
 *
 * Reads AIRLOCK_CONSOLE_URL (default http://localhost:3000). Inside a
 * container that must be http://host.docker.internal:3000 — localhost in a
 * container is the container.
 *
 * Prefers the single-file bundle, which carries its own dependencies. That
 * matters when this runs somewhere the repository's node_modules does not
 * reach: bind-mounted into Docker, where the workspace symlink for
 * @airlock/contract does not survive, or installed from npm. Falls back to the
 * plain tsc output so `npm run build --workspace @airlock/contract` alone is
 * enough for development.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read the repo-root `.env`, before anything that reads `process.env` loads.
 *
 * This server is started detached by `scripts/up.mjs`, and npm does not load a
 * `.env` for a script it runs — so a value put in the one obvious place reached
 * the console, the harness scripts and the verifier, and never reached the one
 * process that had to authenticate to write. `AIRLOCK_API_TOKEN` failed exactly
 * that way: the console correctly refused every `airlock_open_change` with
 * "refusing machine writes" while the token sat in `.env`, spelled right,
 * being read by everything else.
 *
 * The console solves the same problem in `apps/console/src/data/env.ts`, and
 * the comment there is worth repeating: the expensive part was not the bug, it
 * was that the bug was quiet.
 *
 * Real process environment always wins, so `AIRLOCK_API_TOKEN=x npm run mcp`
 * still overrides. Order matters — this must run before `tools.js` is imported,
 * because that module snapshots `process.env` at load.
 */
function loadRootEnv() {
  // bin -> packages/mcp -> packages -> repo root
  const candidates = [
    path.resolve(here, '..', '..', '..', '.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const file of candidates) {
    let text;
    try {
      if (!existsSync(file)) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // an unreadable .env is not worth refusing to start over
    }
    // Split on CRLF *or* LF: a carriage return is a line terminator in JS, so a
    // `.env` written on Windows silently defeats a regex anchored with `$`.
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1];
      if (process.env[key] !== undefined && process.env[key] !== '') continue;
      process.env[key] = match[2].trim().replace(/^["']|["']$/g, '');
    }
    return file;
  }
  return null;
}

loadRootEnv();

const bundle = path.join(here, '..', 'dist', 'airlock-mcp.bundle.mjs');
const plain = path.join(here, '..', 'dist', 'index.js');

const entry = existsSync(bundle) ? bundle : plain;

if (!existsSync(entry)) {
  process.stderr.write(
    '[airlock-mcp] not built. Run: npm run build --workspace @airlock/mcp\n',
  );
  process.exit(1);
}

const { main } = await import(pathToUrl(entry));

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`[airlock-mcp] fatal: ${error?.stack ?? error}\n`);
  process.exit(1);
});

/** Windows needs a file:// URL for a dynamic import of an absolute path. */
function pathToUrl(p) {
  return new URL(`file://${p.startsWith('/') ? '' : '/'}${p.split(path.sep).join('/')}`).href;
}

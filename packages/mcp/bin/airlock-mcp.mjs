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
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
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

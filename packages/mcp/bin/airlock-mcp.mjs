#!/usr/bin/env node
/**
 * AIRLOCK MCP server, stdio transport.
 *
 * Mount it from a TrueForge agent spec:
 *
 *   { "name": "airlock",
 *     "command": "npx",
 *     "args": ["-y", "@airlock/mcp"],
 *     "enable_tools": ["@all"],
 *     "require_approval_for_tools": ["airlock_request_approval"] }
 *
 * Reads AIRLOCK_CONSOLE_URL (default http://localhost:3000).
 */
import { main } from '../dist/index.js';

main().catch((error) => {
  process.stderr.write(`[airlock-mcp] fatal: ${error?.stack ?? error}\n`);
  process.exit(1);
});

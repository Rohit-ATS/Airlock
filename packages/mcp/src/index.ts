/**
 * AIRLOCK, as an MCP server.
 *
 * Mounting this in a TrueForge agent spec is what makes least privilege
 * structural rather than aspirational. The agent keeps read-only connectors to
 * production for investigation, and its only route *towards* production is
 * `airlock_request_approval` — a tool listed in `require_approval_for_tools`,
 * which the harness holds until a human answers.
 *
 * The consequence is worth stating plainly, because it is the difference
 * between a demo and a control plane: there is no code path, in the agent or in
 * any subagent it spawns, that changes production without a person. Not because
 * the model was instructed not to. Because the tool that would do it does not
 * exist, and the tool that asks for it is held.
 */
import { McpServer, log } from './protocol.js';
import { airlockTools, CONSOLE_URL } from './tools.js';

export { McpServer, log } from './protocol.js';
export { airlockTools } from './tools.js';
export { serveHttp } from './http.js';

const INSTRUCTIONS = [
  'AIRLOCK is the change-control gate for irreversible production work.',
  '',
  'The order of operations is fixed, and skipping a step wastes a human being\'s attention:',
  '  1. airlock_read_policy   — learn what this class of change requires before you plan it.',
  '  2. airlock_open_change   — record what you intend to do and its inverse.',
  '  3. run the verification against a shadow copy, then airlock_attach_certificate.',
  '  4. airlock_check_gate    — confirm it would open.',
  '  5. airlock_request_approval — hand it to a human. This one is held for approval.',
  '',
  'There is no tool that applies a change to production. That is not an omission.',
].join('\n');

/**
 * Start the server on whichever transport was asked for.
 *
 * stdio by default, because that is what a local MCP client speaks. HTTP when
 * `--http` or `AIRLOCK_MCP_HTTP_PORT` is given, because TrueForge attaches
 * *remote* MCP servers and only remote ones — a stdio-only build cannot be
 * mounted by the harness this exists for.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const server = new McpServer({
    name: 'airlock',
    version: '0.1.0',
    instructions: INSTRUCTIONS,
  });

  for (const tool of airlockTools()) server.tool(tool);

  const flag = argv.indexOf('--http');
  const port =
    flag !== -1 && argv[flag + 1] && /^\d+$/.test(argv[flag + 1]!)
      ? Number(argv[flag + 1])
      : flag !== -1
        ? 8975
        : process.env.AIRLOCK_MCP_HTTP_PORT
          ? Number(process.env.AIRLOCK_MCP_HTTP_PORT)
          : null;

  log(`ready — ${airlockTools().length} tools, console at ${CONSOLE_URL}`);

  if (port !== null) {
    const { serveHttp } = await import('./http.js');
    await serveHttp({ server, port, path: process.env.AIRLOCK_MCP_HTTP_PATH ?? '/mcp' });
    return;
  }

  await server.listen();
}

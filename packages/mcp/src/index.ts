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

export async function main(): Promise<void> {
  const server = new McpServer({
    name: 'airlock',
    version: '0.1.0',
    instructions: INSTRUCTIONS,
  });

  for (const tool of airlockTools()) server.tool(tool);

  log(`ready — ${airlockTools().length} tools, console at ${CONSOLE_URL}`);
  await server.listen();
}

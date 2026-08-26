/**
 * The AIRLOCK MCP server, tested against a real stdio handshake.
 *
 * The properties under test are the ones the privilege model rests on:
 *
 *   - exactly one tool is annotated destructive, and it is the one the agent
 *     spec holds for approval. If someone adds a second write path, this fails.
 *   - there is no tool that applies a change to production.
 *   - a malformed request cannot take the server down, because a crashed MCP
 *     server looks to the model like a tool that is merely unavailable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'bin', 'airlock-mcp.mjs');

/** Send a batch of JSON-RPC lines, collect every response, then close. */
function converse(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Point at a port nothing is listening on, so any tool that reaches for
      // the console fails fast rather than hanging the test suite.
      env: { ...process.env, AIRLOCK_CONSOLE_URL: 'http://127.0.0.1:9' },
    });

    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', () => {
      const lines = out.trim() ? out.trim().split('\n') : [];
      try {
        resolve({ responses: lines.map((l) => JSON.parse(l)), stderr: err });
      } catch (error) {
        reject(new Error(`unparseable stdout:\n${out}\n\n${error}`));
      }
    });

    // A string is written verbatim, so a test can send something that is not
    // JSON at all. Anything else is encoded.
    for (const m of messages) child.stdin.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`);
    child.stdin.end();
  });
}

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {} },
};

test('the server completes an MCP handshake', async () => {
  const { responses } = await converse([INIT]);
  const init = responses.find((r) => r.id === 1);
  assert.ok(init, 'no response to initialize');
  assert.equal(init.result.serverInfo.name, 'airlock');
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools, 'must advertise tools');
  assert.match(init.result.instructions, /There is no tool that applies a change to production/);
});

test('nothing but the protocol is written to stdout', async () => {
  const { responses, stderr } = await converse([INIT]);
  assert.equal(responses.length, 1, 'exactly one response, no stray output');
  // The readiness line must go to stderr, or it would corrupt the stream.
  assert.match(stderr, /ready — 12 tools/);
});

test('exactly one tool is destructive, and it is the approval request', async () => {
  const { responses } = await converse([INIT, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const tools = responses.find((r) => r.id === 2).result.tools;

  const destructive = tools.filter((t) => t.annotations?.destructiveHint === true);
  assert.deepEqual(
    destructive.map((t) => t.name),
    ['airlock_request_approval'],
    'the set of tools the harness must hold for a human has changed — update the agent specs',
  );

  // Every one of these writes to the *dossier* and none to production. The
  // list is pinned so adding one more is a deliberate act with a test change
  // attached, rather than something that happens quietly on a Thursday.
  const writes = tools.filter((t) => t.annotations?.readOnlyHint !== true);
  assert.deepEqual(writes.map((t) => t.name).sort(), [
    'airlock_attach_certificate',
    'airlock_attach_code_changes',
    'airlock_attach_code_review',
    'airlock_open_change',
    'airlock_report_untrusted',
    'airlock_request_approval',
    'airlock_resolve_context',
    'airlock_verify_change',
  ]);
});

test('there is no tool that applies a change to production', async () => {
  const { responses } = await converse([INIT, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const names = responses.find((r) => r.id === 2).result.tools.map((t) => t.name);
  for (const forbidden of ['apply', 'execute', 'run', 'commit', 'deploy', 'merge']) {
    assert.equal(
      names.some((n) => n.includes(forbidden)),
      false,
      `a tool named *${forbidden}* would be a second route to production`,
    );
  }
});

test('every tool carries a description and an input schema', async () => {
  const { responses } = await converse([INIT, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  for (const tool of responses.find((r) => r.id === 2).result.tools) {
    assert.ok(tool.description?.length > 40, `${tool.name} needs a real description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} needs an object schema`);
  }
});

test('the policy tool answers without touching the console', async () => {
  const { responses } = await converse([
    INIT,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'airlock_read_policy', arguments: { change_class: 'ACCESS_GRANT' } },
    },
  ]);
  const call = responses.find((r) => r.id === 2);
  assert.equal(call.result.isError, false);
  const text = call.result.content[0].text;
  assert.match(text, /approvers required\s*:\s*2/);
  assert.match(text, /every grant must carry an expiry/);
});

test('an unknown change class is refused with the list of valid ones', async () => {
  const { responses } = await converse([
    INIT,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'airlock_read_policy', arguments: { change_class: 'DROP_EVERYTHING' } },
    },
  ]);
  const call = responses.find((r) => r.id === 2);
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /SCHEMA_MIGRATION/);
});

test('a tool failure is reported as content, not as a dead server', async () => {
  // The console is unreachable in this test, so the call must fail — and the
  // model must be able to read why rather than see the connection drop.
  const { responses } = await converse([
    INIT,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'airlock_list_changes', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
  ]);
  const call = responses.find((r) => r.id === 2);
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /airlock_list_changes failed/);
  // Still alive afterwards.
  assert.ok(responses.find((r) => r.id === 3), 'the server must survive a failing tool call');
});

test('an unknown tool is refused by name', async () => {
  const { responses } = await converse([
    INIT,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'airlock_apply_to_production', arguments: {} } },
  ]);
  const call = responses.find((r) => r.id === 2);
  assert.equal(call.result.isError, true);
  assert.match(call.result.content[0].text, /No such tool: airlock_apply_to_production/);
});

test('malformed input does not take the server down', async () => {
  const { responses } = await converse([
    'not json at all {{{',
    { jsonrpc: '1.0', id: 2, method: 'initialize' },
    INIT,
    { jsonrpc: '2.0', id: 4, method: 'no/such/method' },
    { jsonrpc: '2.0', id: 5, method: 'ping' },
  ]);
  const byId = new Map(responses.filter((r) => r.id !== null).map((r) => [r.id, r]));
  const codes = responses.map((r) => r.error?.code);

  assert.ok(codes.includes(-32700), 'unparseable line -> parse error');
  assert.equal(byId.get(2)?.error.code, -32600, 'wrong protocol version -> invalid request');
  assert.ok(byId.get(1)?.result, 'a valid initialize still succeeds afterwards');
  assert.equal(byId.get(4)?.error.code, -32601, 'unknown method -> method not found');
  assert.ok(byId.get(5)?.result, 'the server is still answering at the end');
});

test('notifications receive no response', async () => {
  const { responses } = await converse([
    INIT,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    { jsonrpc: '2.0', id: 9, method: 'ping' },
  ]);
  assert.deepEqual(
    responses.map((r) => r.id),
    [1, 9],
    'a notification must not produce a reply',
  );
});

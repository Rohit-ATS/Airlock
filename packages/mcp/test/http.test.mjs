import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'bin', 'airlock-mcp.mjs');

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

test('HTTP MCP requires bearer auth before dispatching JSON-RPC', async () => {
  const token = 'amcp_test_token';
  const port = 20_000 + Math.floor(Math.random() * 10_000);
  const child = spawn(process.execPath, [entry, '--http', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AIRLOCK_MCP_HTTP_TOKEN: token,
      AIRLOCK_CONSOLE_URL: 'http://127.0.0.1:9',
    },
  });

  try {
    await waitForHttp(`http://127.0.0.1:${port}/healthz`);

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);

    const unauth = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(INIT),
    });
    assert.equal(unauth.status, 401);
    assert.equal(unauth.headers.get('access-control-allow-origin'), null);

    const batch = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([INIT, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]),
    });
    assert.equal(batch.status, 401);

    const authed = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(INIT),
    });
    assert.equal(authed.status, 200);
    const body = await authed.json();
    assert.equal(body.result.serverInfo.name, 'airlock');
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('close', resolve));
  }
});

async function waitForHttp(url) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

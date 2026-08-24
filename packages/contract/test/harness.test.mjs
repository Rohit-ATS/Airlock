/**
 * The Harness Panel is only as honest as these detectors. These tests pin the
 * two properties that matter:
 *   1. a real event lights the right lamp;
 *   2. nothing else lights any lamp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessLedger, CAPABILITIES, CAPABILITY_TOTAL, parseDossier, safeParseDossier } from '../dist/index.js';

const ev = (type, fields = {}) => ({ type, id: 'evt_' + Math.random().toString(36).slice(2), createdAt: '2026-08-24T09:00:00Z', ...fields });

test('an empty run lights nothing', () => {
  const l = new HarnessLedger();
  assert.equal(l.litCount, 0);
  assert.equal(l.events().length, 0);
});

test('sandbox.created lights the sandbox capability', () => {
  const l = new HarnessLedger();
  const fresh = l.observe(ev('sandbox.created', { sandboxId: 'sbx_1', threadId: null }));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].capability, 5);
  assert.equal(fresh[0].evidence, 'sandbox.created');
  assert.ok(l.isLit(5));
});

test('one MCP server lights remote-MCP but not multiple-MCP', () => {
  const l = new HarnessLedger();
  l.observe(ev('mcp.initialize', { threadId: 'main', mcpServers: [{ id: '1', name: 'supabase' }] }));
  assert.ok(l.isLit(1), 'remote MCP should be lit');
  assert.ok(!l.isLit(3), 'a single server must not light "multiple MCP servers"');
});

test('a second distinct MCP server lights multiple-MCP', () => {
  const l = new HarnessLedger();
  l.observe(ev('mcp.initialize', { threadId: 'main', mcpServers: [{ id: '1', name: 'supabase' }] }));
  l.observe(ev('mcp.initialize', { threadId: 'main', mcpServers: [{ id: '2', name: 'github' }] }));
  assert.ok(l.isLit(3));
  assert.match(l.events().find((e) => e.capability === 3).detail, /supabase/);
});

test('the same server twice does not fake a second server', () => {
  const l = new HarnessLedger();
  l.observe(ev('mcp.initialize', { mcpServers: [{ id: '1', name: 'supabase' }] }));
  l.observe(ev('mcp.initialize', { mcpServers: [{ id: '1', name: 'supabase' }] }));
  assert.ok(!l.isLit(3), 'repeating one connector must not count as two');
});

test('thread.created lights subagents; a second model lights model routing', () => {
  const l = new HarnessLedger();
  l.observe(ev('thread.created', { threadId: 't1', title: 'blast-radius-scout', agentInfo: { name: 'scout', input: '', model: 'anthropic/claude-sonnet-4-6' } }));
  assert.ok(l.isLit(8));
  assert.ok(!l.isLit(18), 'one model is not routing');

  l.observe(ev('thread.created', { threadId: 't2', title: 'lock-analyst', agentInfo: { name: 'analyst', input: '', model: 'zai/glm-5.2' } }));
  assert.ok(l.isLit(18), 'two distinct models is routing');
});

test('approval and question events light their own capabilities and no others', () => {
  const l = new HarnessLedger();
  l.observe(ev('tool.approval_required', { threadId: 'main', toolCalls: [{ id: 'c1', sourceEventId: 'm1' }] }));
  assert.deepEqual(l.events().map((e) => e.capability), [13]);

  l.observe(ev('tool.response_required', { threadId: 'main', toolCalls: [{ id: 'c2', sourceEventId: 'm2' }] }));
  assert.deepEqual(l.events().map((e) => e.capability), [13, 14]);
});

test('snake_case wire events are read as well as camelCase', () => {
  const l = new HarnessLedger();
  l.observe({ type: 'sandbox.created', id: 'e1', created_at: '2026-08-24T09:00:00Z', sandbox_id: 'sbx', thread_id: null });
  assert.ok(l.isLit(5));

  const l2 = new HarnessLedger();
  l2.observe({ type: 'mcp.initialize', id: 'e2', created_at: 'x', mcp_servers: [{ id: '1', name: 'stripe' }] });
  assert.ok(l2.isLit(1));
});

test('generative UI lights only on a real OpenUI block', () => {
  const l = new HarnessLedger();
  l.observe(ev('model.message', { threadId: 'main', content: 'Here is a plain prose answer about charts and tables.' }));
  assert.ok(!l.isLit(15), 'mentioning a chart is not rendering one');

  l.observe(ev('model.message', { threadId: 'main', content: 'Report:\n```openui\n<Card/>\n```' }));
  assert.ok(l.isLit(15));
});

test('web search lights only for a search server, not any tool call', () => {
  const l = new HarnessLedger();
  l.observe(ev('model.message', {
    threadId: 'main',
    toolCalls: [{ id: 'c1', type: 'function', function: { name: 'execute_sql', arguments: '{}' }, toolInfo: { type: 'mcp', serverId: '1', serverName: 'supabase', name: 'execute_sql' } }],
  }));
  assert.ok(!l.isLit(4));

  l.observe(ev('model.message', {
    threadId: 'main',
    toolCalls: [{ id: 'c2', type: 'function', function: { name: 'web_search', arguments: '{}' }, toolInfo: { type: 'mcp', serverId: '2', serverName: 'exa', name: 'web_search' } }],
  }));
  assert.ok(l.isLit(4));
});

test('a lamp records when it FIRST lit and is never re-lit', () => {
  const l = new HarnessLedger();
  const first = l.observe(ev('sandbox.created', { sandboxId: 'a', createdAt: '2026-08-24T09:00:00Z' }));
  const second = l.observe(ev('sandbox.created', { sandboxId: 'b', createdAt: '2026-08-24T10:00:00Z' }));
  assert.equal(first.length, 1);
  assert.equal(second.length, 0, 'a re-proof emits nothing new');
  assert.equal(l.events().find((e) => e.capability === 5).detail, 'sandbox a');
});

test('proveOutOfBand requires explicit evidence and is idempotent', () => {
  const l = new HarnessLedger();
  const a = l.proveOutOfBand(21, 'GET /api/v1/auth/me -> oidc-connected', 'role=approver');
  assert.equal(a.capability, 21);
  assert.equal(a.evidence, 'GET /api/v1/auth/me -> oidc-connected');
  assert.equal(l.proveOutOfBand(21, 'again'), null, 'cannot re-prove a lit lamp');
});

test('unknown and irrelevant events light nothing', () => {
  const l = new HarnessLedger();
  for (const t of ['turn.created', 'model.message.delta', 'thread.done', 'something.else', 'user.message']) {
    l.observe(ev(t, { threadId: 'main', content: 'hello' }));
  }
  assert.equal(l.litCount, 0, `noise lit: ${JSON.stringify(l.events())}`);
});

test('the ledger can never exceed the declared capability total', () => {
  const l = new HarnessLedger();
  const events = [
    ev('mcp.initialize', { mcpServers: [{ id: '1', name: 'supabase' }] }),
    ev('mcp.initialize', { mcpServers: [{ id: '2', name: 'github' }] }),
    ev('mcp.auth_required', { mcpServers: [{ id: '2', name: 'github', authUrl: 'https://x' }] }),
    ev('sandbox.created', { sandboxId: 's' }),
    ev('thread.created', { threadId: 't1', title: 'a', agentInfo: { name: 'a', input: '', model: 'm1' } }),
    ev('thread.created', { threadId: 't2', title: 'b', agentInfo: { name: 'b', input: '', model: 'm2' } }),
    ev('tool.approval_required', { threadId: 'main', toolCalls: [] }),
    ev('tool.response_required', { threadId: 'main', toolCalls: [] }),
  ];
  for (const e of events) l.observe(e);
  assert.ok(l.litCount <= CAPABILITY_TOTAL);
  for (const e of l.events()) {
    assert.ok(CAPABILITIES.some((c) => c.id === e.capability), `lamp ${e.capability} is not a declared capability`);
  }
});

test('every declared capability is unique, ordered, and states its evidence', () => {
  const ids = CAPABILITIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate capability ids');
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'capabilities must be declared in id order');
  for (const c of CAPABILITIES) {
    assert.ok(c.evidence.length > 0, `capability ${c.id} declares no evidence`);
    assert.ok(c.loadBearing.length > 20, `capability ${c.id} does not say why it is load-bearing`);
    assert.ok(['stream', 'runtime', 'config'].includes(c.proof));
  }
});

test('dossier round-trips through parse with defaults applied', () => {
  const minimal = {
    dossier_id: 'd1',
    change_class: 'DATA_OPERATION',
    request: 'correct the currency on EU invoices',
    requested_by: 'rohit@airlock.dev',
    created_at: '2026-08-24T09:00:00Z',
    target: {},
  };
  const d = parseDossier(minimal);
  assert.equal(d.started_by, 'ui');
  assert.deepEqual(d.target.systems, ['postgres']);
  assert.equal(d.certificate, undefined, 'a fresh dossier has no certificate');
  assert.equal(d.approval.role_required, 'approver');
  assert.deepEqual(JSON.parse(JSON.stringify(parseDossier(d))), JSON.parse(JSON.stringify(d)));
});

test('a malformed checksum is rejected at the contract boundary', () => {
  const bad = safeParseDossier({
    dossier_id: 'd1',
    change_class: 'SCHEMA_MIGRATION',
    request: 'x',
    requested_by: 'r',
    created_at: '2026-08-24T09:00:00Z',
    target: {},
    certificate: { kind: 'UNDO', status: 'PROVEN', checksums: { pre: 'nope', post: 'nope', post_rollback: 'nope', match: true } },
  });
  assert.equal(bad.success, false, 'a checksum that is not sha256 must not parse');
});

test('an exclusion without a reason is rejected', () => {
  const bad = safeParseDossier({
    dossier_id: 'd1',
    change_class: 'ERASURE',
    request: 'erase a person',
    requested_by: 'r',
    created_at: '2026-08-24T09:00:00Z',
    target: {},
    certificate: {
      kind: 'SCOPE',
      status: 'PROVEN',
      scope: { records: [], exclusions: [{ system: 'postgres', table: 'invoices', reason: '' }] },
    },
  });
  assert.equal(bad.success, false, 'an exclusion with no stated reason is not an exclusion');
});

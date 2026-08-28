import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFailure, isRetryable, summariseEvents, unwrapEvents } from '../dist/index.js';

/**
 * The activity feed, tested against a real capture.
 *
 * `fixtures/session-events.json` is not hand-written. It is the verbatim body
 * of `GET /api/v1/sessions/{id}/events` from TrueForge 0.1.4 after a real turn
 * that called `airlock_read_policy`. That matters, because every mistake this
 * module made on the first attempt was a wrong guess about the shape of that
 * response, and a fixture invented from the same wrong guess would have agreed
 * with the bug.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const captured = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'session-events.json'), 'utf8'));

test('the event is nested inside an envelope, and unwrapping finds it', () => {
  // Read naively, every element has no `type` at all — a confidently empty feed.
  assert.equal(captured.data[0].type, undefined);
  assert.equal(typeof captured.data[0].event.type, 'string');

  const events = unwrapEvents(captured);
  assert.equal(events.length, 6);
  assert.ok(events.every((e) => typeof e.type === 'string'));
});

test('the harness returns newest first; the feed reads forwards', () => {
  assert.equal(captured.data[0].event.type, 'turn.done', 'capture should start at the end');
  const events = unwrapEvents(captured);
  assert.equal(events[0].type, 'turn.created');
  assert.equal(events[events.length - 1].type, 'turn.done');
});

test('a bare array and already-unwrapped events are both accepted', () => {
  const plain = captured.data.map((row) => row.event);
  assert.equal(unwrapEvents(plain).length, 6);
  assert.equal(unwrapEvents({ data: plain }).length, 6);
});

test('anything unusable yields nothing rather than throwing', () => {
  assert.deepEqual(unwrapEvents(null), []);
  assert.deepEqual(unwrapEvents({}), []);
  assert.deepEqual(unwrapEvents({ data: [{ nope: 1 }] }), []);
});

test('the real run summarises into what the agent actually did', () => {
  const summary = summariseEvents(unwrapEvents(captured));

  assert.equal(summary.status, 'done');
  assert.equal(summary.heldOn, null);
  // The tool name lives at tool_calls[].function.name on this server.
  assert.deepEqual(summary.tools, ['airlock_read_policy']);
  assert.deepEqual(summary.servers, ['airlock']);
  assert.ok(summary.startedAt);
  assert.ok(summary.endedAt);
});

test('run-level events carry no thread and still land in the main lane', () => {
  const summary = summariseEvents(unwrapEvents(captured));
  assert.deepEqual(
    summary.lanes.map((l) => l.thread),
    ['main'],
  );
  assert.ok(summary.lanes[0].steps.length >= 4);
});

test('no thread.created is emitted, and a lane exists anyway', () => {
  const events = unwrapEvents(captured);
  assert.equal(
    events.filter((e) => e.type === 'thread.created').length,
    0,
    'this harness announces no threads — the lane must not depend on it',
  );
  assert.equal(summariseEvents(events).lanes.length, 1);
});

/* --- the pause, which is the one that must not be got wrong ---------------- */

test('a done turn carrying required_actions is held, not finished', () => {
  const held = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'x' },
    {
      type: 'turn.done',
      id: '2',
      created_at: 'y',
      state: { status: 'done', required_actions: [{ type: 'tool_approval' }] },
    },
  ]);
  assert.equal(held.status, 'held');
  assert.equal(held.heldOn, 'an approval');
});

test('an approval request names the tool being held', () => {
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'x' },
    {
      type: 'tool.approval_required',
      id: '2',
      created_at: 'y',
      tool_calls: [{ id: 'c1', function: { name: 'airlock_request_approval' } }],
    },
  ]);
  assert.equal(summary.status, 'held');
  assert.equal(summary.heldOn, 'airlock_request_approval');
});

test('a failed turn is reported as failed, not as done', () => {
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'x' },
    { type: 'turn.done', id: '2', created_at: 'y', state: { status: 'error' } },
  ]);
  assert.equal(summary.status, 'error');
});

test('no events is idle, not running', () => {
  assert.equal(summariseEvents([]).status, 'idle');
});

test('camelCase from the SDK reads the same as snake_case from the wire', () => {
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', createdAt: 'x', threadId: 'main' },
    { type: 'mcp.initialize', id: '2', createdAt: 'y', threadId: 'main', mcpServers: [{ name: 'airlock' }] },
  ]);
  assert.deepEqual(summary.servers, ['airlock']);
  assert.equal(summary.lanes[0].thread, 'main');
});

test('a subagent gets its own lane when one is announced', () => {
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'a' },
    { type: 'model.message', id: '2', created_at: 'b', thread_id: 'main', content: 'planning' },
    { type: 'thread.created', id: '3', created_at: 'c', thread_id: 'sub-1', agent_info: { name: 'scout' } },
    { type: 'model.message', id: '4', created_at: 'd', thread_id: 'sub-1', content: 'scouting' },
  ]);
  assert.deepEqual(
    summary.lanes.map((l) => l.thread),
    ['main', 'sub-1'],
  );
});

/**
 * Failures, tested against the message that actually killed a run.
 *
 * The string below is verbatim from `state.message` on a real `turn.done` after
 * the change-control agent hit OpenAI's per-minute token ceiling mid-turn. It is
 * kept whole, rather than trimmed to the interesting substring, because every
 * property asserted here — the 429, the prose retry interval, the "Request
 * failed" prefix that a careless classifier buckets as a generic provider
 * error — is a real feature of what providers actually send.
 */
const RATE_LIMIT_MESSAGE =
  'Request failed (429): Rate limit reached for gpt-4.1 in organization org-7NwExuwokpTftGUyl90VGDSD ' +
  'on tokens per min (TPM): Limit 30000, Used 26713, Requested 7669. Please try again in 8.764s. ' +
  'Visit https://platform.openai.com/account/rate-limits to learn more.';

test('a held tool is named, even though the hold event carries only call ids', () => {
  /*
   * The shape below is verbatim from a real run. `tool.approval_required`
   * carries `{ id, source_event_id }` per call and no name at all, so the feed
   * used to render "unknown tool" — while what was actually being held was
   * arbitrary SQL against production.
   */
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'a' },
    {
      type: 'model.message',
      id: '2',
      created_at: 'b',
      thread_id: 'main',
      tool_calls: [
        { id: 'call_A', function: { name: 'execute_sql' }, tool_info: { server_name: 'supabase', type: 'mcp' } },
        { id: 'call_B', function: { name: 'list_tables' }, tool_info: { server_name: 'supabase', type: 'mcp' } },
      ],
    },
    {
      type: 'tool.approval_required',
      id: '3',
      created_at: 'c',
      thread_id: 'main',
      tool_calls: [{ id: 'call_A', source_event_id: '2' }, { id: 'call_B', source_event_id: '2' }],
    },
  ]);

  assert.equal(summary.status, 'held');
  assert.equal(summary.heldOn, 'supabase·execute_sql, supabase·list_tables');
  assert.ok(
    summary.steps.some((s) => s.kind === 'held' && s.label.includes('supabase·execute_sql')),
    'the held row must name the tool a person is being asked to approve',
  );
});

test('an unresolvable held call degrades to "a tool" rather than inventing one', () => {
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'a' },
    // No preceding model.message, so nothing can name this call.
    { type: 'tool.approval_required', id: '2', created_at: 'b', tool_calls: [{ id: 'call_orphan' }] },
  ]);
  assert.equal(summary.status, 'held');
  assert.equal(summary.heldOn, 'a tool');
});

test('a failed turn carries the provider’s own sentence, not just "failed"', () => {
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'x' },
    {
      type: 'turn.done',
      id: '2',
      created_at: 'y',
      state: { status: 'error', message: RATE_LIMIT_MESSAGE },
    },
  ]);

  assert.equal(summary.status, 'error');
  assert.equal(summary.failure.kind, 'RATE_LIMITED');
  // Verbatim. An operator has to be able to paste this into a provider dashboard.
  assert.equal(summary.failure.message, RATE_LIMIT_MESSAGE);
  assert.equal(summary.failure.retryAfterSeconds, 8.764);

  const last = summary.steps[summary.steps.length - 1];
  assert.equal(last.kind, 'failed', 'a failure must not wear the same chip as a completed turn');
  assert.equal(last.detail, RATE_LIMIT_MESSAGE);
});

test('"Request failed (429)" is a rate limit, not a generic provider error', () => {
  // Ordering regression: a `PROVIDER` test for "request failed" placed before
  // the rate-limit test would swallow every 429 OpenAI sends.
  assert.equal(classifyFailure(RATE_LIMIT_MESSAGE).kind, 'RATE_LIMITED');
});

test('the retry interval is read when named, and null when it is not', () => {
  assert.equal(classifyFailure('Rate limited. Please try again in 250ms.').retryAfterSeconds, 0.25);
  // Null and zero are different facts. Zero would render as "retry now".
  assert.equal(classifyFailure('Rate limit reached for gpt-4.1.').retryAfterSeconds, null);
});

test('the buckets separate what an operator waits out from what they must fix', () => {
  assert.equal(classifyFailure('Request failed (401): Incorrect API key provided.').kind, 'MODEL_AUTH');
  assert.equal(
    classifyFailure("This model's maximum context length is 128000 tokens.").kind,
    'CONTEXT_OVERFLOW',
  );
  assert.equal(classifyFailure('Request failed (503): upstream connect error').kind, 'PROVIDER');
  assert.equal(classifyFailure('the wheels came off').kind, 'UNKNOWN');
});

test('a retry is offered only where sending the same request again could work', () => {
  assert.equal(isRetryable(classifyFailure(RATE_LIMIT_MESSAGE)), true);
  assert.equal(isRetryable(classifyFailure('Request failed (503): upstream connect error')), true);
  // A key that is wrong stays wrong, and an error nobody described is not one
  // to encourage anyone to repeat.
  assert.equal(isRetryable(classifyFailure('Request failed (401): Incorrect API key provided.')), false);
  assert.equal(isRetryable(classifyFailure('the wheels came off')), false);
});

test('a turn that did not fail carries no failure at all', () => {
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'x' },
    { type: 'turn.done', id: '2', created_at: 'y', state: { status: 'completed' } },
  ]);
  assert.equal(summary.status, 'done');
  assert.equal(summary.failure, null, 'status and failure must travel together');
});

test('a session that recovered does not keep flying the failure flag', () => {
  /*
   * The real shape of the first session this was checked against: a turn killed
   * by a 429, then a second turn that worked. The summary describes where the
   * session stands now, so a populated `failure` next to `status: 'done'` would
   * paint a red banner over a run that had already recovered.
   */
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'a' },
    { type: 'turn.done', id: '2', created_at: 'b', state: { status: 'error', message: RATE_LIMIT_MESSAGE } },
    { type: 'turn.created', id: '3', created_at: 'c' },
    { type: 'turn.done', id: '4', created_at: 'd', state: { status: 'completed' } },
  ]);

  assert.equal(summary.status, 'done');
  assert.equal(summary.failure, null, 'the later success supersedes the earlier failure');
  // The failed turn is still in the feed. It did happen, and that is history.
  assert.ok(
    summary.steps.some((s) => s.kind === 'failed' && s.detail === RATE_LIMIT_MESSAGE),
    'the failed turn keeps its own row',
  );
});

test('a failure the harness declined to explain still reports as failed', () => {
  // The harness is not obliged to send a message, and a missing reason must not
  // become a missing failure.
  const summary = summariseEvents([
    { type: 'turn.created', id: '1', created_at: 'x' },
    { type: 'turn.done', id: '2', created_at: 'y', state: { status: 'error' } },
  ]);
  assert.equal(summary.status, 'error');
  assert.equal(summary.failure, null);
  assert.equal(summary.steps[summary.steps.length - 1].label, 'turn failed');
  assert.equal(classifyFailure(null), null);
});

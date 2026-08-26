import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summariseEvents, unwrapEvents } from '../dist/index.js';

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

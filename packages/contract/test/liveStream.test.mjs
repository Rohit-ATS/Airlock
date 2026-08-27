import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detect,
  newDetectorState,
  qualifyToolCall,
  readToolCalls,
  summariseEvents,
} from '../dist/index.js';

/**
 * The live stream is not the stored stream, and the difference cost us the log.
 *
 * `fixtures/live-stream.json` is every SSE frame from one real turn against
 * TrueForge 0.1.4, parsed out of the wire and otherwise untouched. It exists
 * because the whole console was built against `GET /sessions/{id}/events` — the
 * *stored* shape — and the two surfaces do not agree about where a tool call
 * lives:
 *
 *   - stored: `model.message` carries `content` and `tool_calls`;
 *   - live: `model.message` carries neither. It is a marker with four keys.
 *     The calls arrive on `model.message.delta`.
 *
 * Everything that watched `model.message` therefore did nothing at all on a
 * live run — the sandbox log showed responses with no calls above them, lanes
 * counted zero tools, and the capability lamps that key off a tool name could
 * not light. The tests below pin the shape, because it is a third party's and
 * it will change without telling us.
 */

const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const frames = JSON.parse(fs.readFileSync(path.join(here, 'test', 'fixtures', 'live-stream.json'), 'utf8'));

/* -------------------------------------------------------------------------- */
/* The shape itself                                                           */
/* -------------------------------------------------------------------------- */

test('a streamed model.message carries no content and no tool calls', () => {
  const messages = frames.filter((f) => f.type === 'model.message');
  assert.ok(messages.length > 0, 'the capture should contain model.message frames');
  for (const message of messages) {
    assert.equal(message.tool_calls, undefined);
    assert.equal(message.content, undefined);
  }
});

test('the tool call is only ever on a delta', () => {
  const carrying = frames.filter((f) => Array.isArray(f.tool_calls));
  assert.ok(carrying.length > 0);
  for (const frame of carrying) {
    assert.equal(frame.type, 'model.message.delta', 'only deltas carry calls on the live wire');
  }
});

test('exactly one delta names the call; the rest are argument fragments', () => {
  const named = frames.flatMap((f) => readToolCalls(f));
  assert.equal(named.length, 1, 'a fragment must never be read as a second call');
  assert.equal(named[0].name, 'airlock_check_gate');
  assert.equal(named[0].server, 'airlock');
  assert.equal(named[0].kind, 'mcp');
  assert.equal(qualifyToolCall(named[0]), 'airlock·airlock_check_gate');
  assert.match(named[0].id, /^call_/);
});

test('an argument fragment yields nothing rather than a phantom tool', () => {
  // The literal shape of a continuation frame, from the capture.
  const fragment = { type: 'model.message.delta', tool_calls: [{ index: 0, function: { arguments: '{"' } }] };
  assert.deepEqual(readToolCalls(fragment), []);
});

/* -------------------------------------------------------------------------- */
/* What the console does with it                                              */
/* -------------------------------------------------------------------------- */

test('the activity feed names the tool it called, from a live stream', () => {
  const summary = summariseEvents(frames);

  assert.deepEqual(summary.tools, ['airlock_check_gate'], 'the call must be counted exactly once');

  const called = summary.steps.filter((s) => s.kind === 'tool');
  assert.equal(called.length, 1, 'sixty-two deltas, one row');
  assert.equal(called[0].label, 'airlock·airlock_check_gate');
});

test('the failed response is marked as a failure and named after its call', () => {
  const summary = summariseEvents(frames);
  const failed = summary.steps.filter((s) => s.kind === 'failed');

  // The turn itself succeeded — a tool refusing is normal, and the agent
  // recovers from it. Only the row is marked.
  assert.equal(summary.status, 'done');
  assert.equal(summary.failure, null);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].label, 'airlock·airlock_check_gate');
  assert.match(failed[0].detail, /No change with id dos_nonexistent/);
  // Unwrapped: the operator reads the sentence, not the envelope.
  assert.ok(!failed[0].detail.includes('"type":"text"'));
});

test('the capability detectors see the tool call on the live stream', () => {
  // The regression this pins: for as long as `detect` watched `model.message`
  // alone, a live run lit nothing that keys off a tool name, and a dark lamp
  // was indistinguishable from a capability that was never exercised.
  const state = newDetectorState();
  for (const frame of frames) detect(frame, state);

  assert.ok(
    state.toolSchemasLoaded.has('airlock.airlock_check_gate'),
    'the detector should have recorded the qualified tool name',
  );
  // Counted once, not once per delta.
  assert.equal(state.toolSchemasLoaded.size, 1);
});

test('folding the same run twice does not double-count a call', () => {
  // Belt and braces: if a caller ever folds both surfaces — the live stream and
  // then the stored events for the same turn — the log must not grow a second
  // copy of every call.
  const summary = summariseEvents([...frames, ...frames]);
  assert.deepEqual(summary.tools, ['airlock_check_gate']);
  assert.equal(summary.steps.filter((s) => s.kind === 'tool').length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINE_LIMIT, labelToolResponse, readToolResponse, unwrapEvents } from '../dist/index.js';

/**
 * Decoding a tool response, tested against the responses that broke the log.
 *
 * The sandbox log rendered `tool.response.content` raw, clipped at 220
 * characters. Two of the shapes in this fixture are the reason that had to
 * change, and both are real:
 *
 *   - a tool *schema*, echoed back by the harness's own `get_tool_info`, which
 *     filled the log with AIRLOCK's own prompt text and made the run look
 *     broken to anyone reading it;
 *   - an error envelope with the message nested two levels down inside a JSON
 *     string, rendered in the same grey as a success, which is how a failing
 *     run announced itself in a way nobody could see.
 *
 * The strings asserted below are lifted from `rate-limited-session.json`, so
 * they are the bytes the harness actually sent rather than a reconstruction of
 * what I remember it sending.
 */

const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const captured = JSON.parse(
  fs.readFileSync(path.join(here, 'test', 'fixtures', 'rate-limited-session.json'), 'utf8'),
);
const responses = unwrapEvents(captured)
  .filter((e) => e.type === 'tool.response')
  .map((e) => e.content);

/* -------------------------------------------------------------------------- */
/* The two shapes that broke the log                                          */
/* -------------------------------------------------------------------------- */

test('an error envelope is unwrapped to the sentence inside it', () => {
  // Real: {"error":[{"type":"text","text":"airlock_resolve_context failed: …"}]}
  const raw = responses.find((c) => c.includes('airlock_resolve_context failed'));
  assert.ok(raw, 'the capture should contain a failed tool call');

  const line = readToolResponse(raw);
  assert.equal(line.kind, 'error');
  assert.equal(line.ok, false);
  assert.match(line.text, /^airlock_resolve_context failed: No change with id/);
  // The envelope is gone; the message is not.
  assert.ok(!line.text.includes('"type":"text"'));
});

test('an error nested inside a JSON string is unwrapped all the way', () => {
  // Real, and the nastiest shape in the capture: a JSON string inside an MCP
  // text part inside an `error` key. Two levels, both of which have to come off
  // or the operator reads escaped quotes instead of the problem.
  const raw = responses.find((c) => c.includes('deferred-tools'));
  assert.ok(raw, 'the capture should contain the phantom-server error');

  const line = readToolResponse(raw);
  assert.equal(line.kind, 'error');
  assert.equal(line.ok, false);
  assert.equal(line.text, "MCP server 'deferred-tools' not found");
});

test('a tool schema is named as a schema, not rendered as prose', () => {
  // This is the exact payload that filled the console with `{"description":…`.
  const raw = JSON.stringify({
    description:
      'Record the facts you LOOKED UP for this change, instead of asking a human for them. A fact lives in a system of record — the currency on a Stripe account, a user\'s country code, a row\'s created_at, a table\'s row count — and there is exactly one right answer.',
    inputSchema: {
      type: 'object',
      required: ['dossier_id', 'facts'],
      properties: { dossier_id: { type: 'string' }, facts: { type: 'array' } },
    },
    outputSchema: null,
  });

  const line = readToolResponse(raw);
  assert.equal(line.kind, 'schema');
  assert.equal(line.ok, true);
  // Required arguments carry a star, so the shape is readable at a glance
  // without expanding anything.
  assert.equal(line.text, 'tool schema · dossier_id*, facts*');
  assert.deepEqual(line.fields, ['dossier_id', 'facts']);
  // The thing that must not happen: our own prompt text in the log.
  assert.ok(!line.text.includes('LOOKED UP'));
});

/* -------------------------------------------------------------------------- */
/* The ordinary case must stay ordinary                                       */
/* -------------------------------------------------------------------------- */

test('a real tool result passes through as itself', () => {
  const raw = responses.find((c) => c.startsWith('Opened dos_tier_nullable_column'));
  assert.ok(raw);

  const line = readToolResponse(raw);
  assert.equal(line.kind, 'text');
  assert.equal(line.ok, true);
  assert.match(line.text, /^Opened dos_tier_nullable_column \(SCHEMA_MIGRATION\)\./);
});

test('every response in the capture decodes without throwing, and none goes empty', () => {
  // A decoder that silently drops what it cannot parse is worse than one that
  // shows raw bytes: the operator cannot tell "nothing came back" from
  // "something came back and we hid it".
  for (const raw of responses) {
    const line = readToolResponse(raw);
    assert.ok(line.text.length > 0, `decoded to nothing: ${raw.slice(0, 60)}`);
    assert.ok(['text', 'error', 'schema', 'json'].includes(line.kind));
  }
  assert.equal(responses.length, 7, 'the capture should hold every response the run produced');
});

/* -------------------------------------------------------------------------- */
/* Edges                                                                      */
/* -------------------------------------------------------------------------- */

test('structured data with no envelope we know is shown compactly, not hidden', () => {
  const line = readToolResponse('{"unixEpochMS":1787775519620,"iso":"2026-08-26T20:18:39.620Z"}');
  assert.equal(line.kind, 'json');
  assert.equal(line.ok, true);
  assert.match(line.text, /unixEpochMS/);
});

test('MCP content parts are flattened to their text', () => {
  const line = readToolResponse('[{"type":"text","text":"row count: 41902"}]');
  assert.equal(line.kind, 'text');
  assert.equal(line.text, 'row count: 41902');
});

test('malformed JSON is shown as the text it is, rather than swallowed', () => {
  const line = readToolResponse('{"broken": ');
  assert.equal(line.kind, 'text');
  assert.equal(line.text, '{"broken":');
});

test('nothing in, nothing out — and no crash on the shapes a stream can produce', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.equal(readToolResponse(value).text, '');
    assert.equal(readToolResponse(value).ok, true);
  }
});

test('long results are clipped with an ellipsis, at the log line budget', () => {
  const line = readToolResponse('x'.repeat(1000));
  assert.equal(line.text.length, LINE_LIMIT + 1, 'clipped text plus the ellipsis');
  assert.ok(line.text.endsWith('…'));
});

/* -------------------------------------------------------------------------- */
/* Naming the call                                                            */
/* -------------------------------------------------------------------------- */

test('a response is labelled with the tool it came back from', () => {
  const result = readToolResponse('Opened dos_tier_nullable_column (SCHEMA_MIGRATION).');
  assert.equal(
    labelToolResponse(result, 'airlock_open_change'),
    'airlock_open_change → Opened dos_tier_nullable_column (SCHEMA_MIGRATION).',
  );

  // A schema reads as a property of the tool, not as something it returned.
  const schema = readToolResponse('{"description":"d","inputSchema":{"properties":{"a":{}}}}');
  assert.equal(labelToolResponse(schema, 'airlock_open_change'), 'airlock_open_change · tool schema · a');
});

test('an unnamed call still renders its result rather than a blank row', () => {
  // `tool.response` carries only `tool_call_id`; if the matching call was
  // never seen, the name is genuinely unknown and is not invented.
  const result = readToolResponse('done');
  assert.equal(labelToolResponse(result, null), 'done');
  assert.equal(labelToolResponse(result, undefined), 'done');
  assert.equal(labelToolResponse(readToolResponse(''), 'airlock_check_gate'), 'airlock_check_gate returned nothing');
});

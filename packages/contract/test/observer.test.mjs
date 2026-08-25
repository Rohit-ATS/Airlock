/**
 * The harness event tap, end to end.
 *
 * `harness.test.mjs` tests the detectors in isolation: given this event, does
 * that lamp light. This file tests the seam they hang from, which is where the
 * credibility of the whole Harness Panel actually lives.
 *
 * The claim on the front page is three lines long:
 *
 *   - we never synthesise an event,
 *   - we never re-order or drop one,
 *   - a capability lights only because the harness actually did the thing.
 *
 * Until now that was a comment. A passthrough that quietly dropped one event in
 * fifty would still render a perfectly plausible console — nobody would notice,
 * and every number on the panel would be wrong. So the first half of this file
 * asserts *fidelity*: same chunks, same objects, same order, none added, none
 * lost, even when a detector throws or the transport dies mid-stream.
 *
 * The second half drives a realistic turn stream through the real tap into the
 * real ledger and checks the lamps that come out the other side.
 *
 * The stream below is **constructed from the documented event schema** in
 * docs/TRUEFORGE-NOTES.md §5, not captured from a live server. It is a test
 * fixture and this file is the only place it exists — there is deliberately no
 * replay mode in the console, because a panel that can be lit from a recording
 * is a panel that proves nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeTurnStream, HarnessLedger, CAPABILITY_TOTAL } from '../dist/index.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Wrap events as the transport does: one chunk per event, with a sequence. */
function chunks(events) {
  return events.map((event, i) => ({ event, sequenceNumber: i + 1 }));
}

async function* streamOf(items) {
  for (const item of items) yield item;
}

/** Drain a stream into an array. */
async function drain(gen) {
  const out = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

const META = { sessionId: 'sess_01', resumed: false };
const noop = { onEvent: () => {} };

/* -------------------------------------------------------------------------- */
/* Fidelity — the part that makes the panel worth believing                    */
/* -------------------------------------------------------------------------- */

test('every chunk comes out, in order, as the same object', async () => {
  const input = chunks([
    { type: 'turn.created', id: 'e1' },
    { type: 'sandbox.created', id: 'e2', sandboxId: 'sbx_a' },
    { type: 'model.message', id: 'e3', content: 'hello' },
    { type: 'turn.done', id: 'e4', state: { status: 'completed' } },
  ]);

  const output = await drain(observeTurnStream(streamOf(input), META, noop));

  assert.equal(output.length, input.length, 'no chunk may be added or dropped');
  for (let i = 0; i < input.length; i += 1) {
    // Identity, not deep equality: a tap that rebuilt each chunk would pass a
    // structural check while silently discarding anything it did not model.
    assert.equal(output[i], input[i], `chunk ${i} must be the very same object`);
  }
});

test('observation sees every event, once, in stream order', async () => {
  const seen = [];
  const input = chunks([
    { type: 'turn.created', id: 'e1' },
    { type: 'mcp.initialize', id: 'e2', mcpServers: [{ name: 'airlock' }] },
    { type: 'thread.created', id: 'e3', threadId: 't1' },
    { type: 'turn.done', id: 'e4', state: {} },
  ]);

  await drain(
    observeTurnStream(streamOf(input), META, {
      onEvent: (event, meta) => seen.push([event.type, meta.sequenceNumber, meta.sessionId]),
    }),
  );

  assert.deepEqual(seen, [
    ['turn.created', 1, 'sess_01'],
    ['mcp.initialize', 2, 'sess_01'],
    ['thread.created', 3, 'sess_01'],
    ['turn.done', 4, 'sess_01'],
  ]);
});

test('a detector that throws cannot break the chat', async () => {
  // The failure mode this prevents is the expensive one: the console stops
  // streaming because a regex was wrong. A dark lamp is a much cheaper bug.
  const input = chunks([
    { type: 'turn.created', id: 'e1' },
    { type: 'model.message', id: 'e2' },
    { type: 'turn.done', id: 'e3', state: {} },
  ]);

  let calls = 0;
  const output = await drain(
    observeTurnStream(streamOf(input), META, {
      onEvent: () => {
        calls += 1;
        throw new Error('a detector blew up');
      },
    }),
  );

  assert.equal(calls, 3, 'it keeps being called after it throws');
  assert.equal(output.length, 3, 'and every event still reaches the UI');
});

test('chunks with no usable event pass through without being observed', async () => {
  const seen = [];
  const input = [
    { sequenceNumber: 1 },
    { event: null, sequenceNumber: 2 },
    { event: {}, sequenceNumber: 3 },
    { event: { type: 42 }, sequenceNumber: 4 },
    { event: { type: 'turn.done', id: 'e' }, sequenceNumber: 5 },
  ];

  const output = await drain(
    observeTurnStream(streamOf(input), META, { onEvent: (e) => seen.push(e.type) }),
  );

  assert.deepEqual(seen, ['turn.done'], 'only a real typed event is observed');
  assert.equal(output.length, 5, 'but everything is still forwarded');
});

test('a transport failure is reported and then re-thrown', async () => {
  // Swallowing it would turn a dropped connection into a stream that simply
  // stops, which is the hardest kind of bug to diagnose from a console.
  const boom = new Error('replica went away');
  async function* dying() {
    yield { event: { type: 'turn.created', id: 'e1' }, sequenceNumber: 1 };
    throw boom;
  }

  const closes = [];
  const gen = observeTurnStream(dying(), META, {
    onEvent: () => {},
    onStreamClose: (m) => closes.push(m),
  });

  await assert.rejects(() => drain(gen), /replica went away/);
  assert.equal(closes.length, 1);
  assert.equal(closes[0].error, boom, 'the real error is handed on, not a copy');
  assert.equal(closes[0].sessionId, 'sess_01');
});

test('open and close are announced exactly once on a clean stream', async () => {
  const events = [];
  await drain(
    observeTurnStream(streamOf(chunks([{ type: 'turn.done', id: 'e', state: {} }])), META, {
      onEvent: () => {},
      onStreamOpen: (m) => events.push(['open', m.resumed]),
      onStreamClose: (m) => events.push(['close', m.error === undefined]),
    }),
  );
  assert.deepEqual(events, [['open', false], ['close', true]]);
});

test('a turn with no input is announced as a resume', async () => {
  // This is the signal behind session durability and replica failover: an
  // approval, an answer or an MCP authorization coming back on a new stream.
  let resumed = null;
  await drain(
    observeTurnStream(streamOf([]), { sessionId: 'sess_02', resumed: true }, {
      onEvent: () => {},
      onStreamOpen: (m) => (resumed = m.resumed),
    }),
  );
  assert.equal(resumed, true);
});

test('an empty stream is not an error', async () => {
  const output = await drain(observeTurnStream(streamOf([]), META, noop));
  assert.deepEqual(output, []);
});

/* -------------------------------------------------------------------------- */
/* The pipeline — a realistic run, through the real tap, into the real ledger  */
/* -------------------------------------------------------------------------- */

/**
 * A turn shaped like an AIRLOCK erasure run.
 *
 * Built from the event schema in docs/TRUEFORGE-NOTES.md §5. Deliberately
 * mixes camelCase and snake_case spellings, because the HTTP surface is
 * snake_case while the TypeScript SDK camelCases the same fields, and a tap
 * that only understood one of them would light half a panel on the wrong
 * transport and nobody would find out until the demo.
 */
const RUN = [
  { type: 'turn.created', id: 'evt_001', turnId: 'turn_a', createdAt: '2026-08-24T09:00:00Z' },

  // Two connectors in one initialize: remote MCP, and more than one of them.
  {
    type: 'mcp.initialize',
    id: 'evt_002',
    createdAt: '2026-08-24T09:00:01Z',
    mcpServers: [{ name: 'airlock' }, { name: 'supabase' }],
  },

  // GitHub needs authorising in-chat before the blast-radius scan can read code.
  {
    type: 'mcp.auth_required',
    id: 'evt_003',
    created_at: '2026-08-24T09:00:04Z',
    mcp_servers: [{ name: 'github' }],
  },

  { type: 'sandbox.created', id: 'evt_004', created_at: '2026-08-24T09:00:09Z', sandbox_id: 'sbx_7f2' },

  // Two subagents on two different models: subagents, and per-task routing.
  {
    type: 'thread.created',
    id: 'evt_005',
    threadId: 'thr_scout',
    title: 'blast radius scan',
    createdAt: '2026-08-24T09:00:11Z',
    agentInfo: { name: 'airlock-scout', model: 'openai/gpt-5.2-mini' },
  },
  {
    type: 'thread.created',
    id: 'evt_006',
    thread_id: 'thr_author',
    title: 'draft the migration',
    created_at: '2026-08-24T09:00:12Z',
    agent_info: { name: 'airlock-change-control', model: 'anthropic/claude-sonnet-4-6' },
  },

  // Scope computed as one script in the sandbox rather than four hundred calls.
  {
    type: 'model.message',
    id: 'evt_007',
    threadId: 'thr_scout',
    createdAt: '2026-08-24T09:00:20Z',
    usage: { inputTokens: 18_400, outputTokens: 900 },
    toolCalls: [
      { id: 'call_1', function: { name: 'execute_code' }, toolInfo: { serverName: 'sandbox' } },
    ],
  },

  // Lock behaviour cited rather than recalled.
  {
    type: 'model.message',
    id: 'evt_008',
    thread_id: 'thr_author',
    created_at: '2026-08-24T09:00:24Z',
    usage: { input_tokens: 22_100, output_tokens: 1_400 },
    tool_calls: [{ id: 'call_2', function: { name: 'search' }, tool_info: { server_name: 'exa' } }],
  },

  // The skill body read on demand.
  {
    type: 'model.message',
    id: 'evt_009',
    threadId: 'thr_author',
    createdAt: '2026-08-24T09:00:31Z',
    toolCalls: [
      {
        id: 'call_3',
        function: { name: 'read_skill' },
        toolInfo: { serverName: 'truefoundry', type: 'truefoundry-system' },
      },
    ],
  },

  // A row-level diff too large for context, offloaded to a sandbox artifact.
  {
    type: 'tool.response',
    id: 'evt_010',
    createdAt: '2026-08-24T09:00:38Z',
    content: 'Full result written to /sandbox/verify/diff.ndjson (41,882 rows). Preview of the first 3 rows follows.',
  },

  // The agent renders its own risk table rather than describing one.
  {
    type: 'model.message',
    id: 'evt_011',
    threadId: 'thr_author',
    createdAt: '2026-08-24T09:00:44Z',
    content: 'Here is the blast radius.\n\n```openui\n{ "component": "Table" }\n```',
  },

  // A judgement call the agent must not make on its own.
  { type: 'tool.response_required', id: 'evt_012', createdAt: '2026-08-24T09:00:52Z' },

  // And the gate.
  {
    type: 'tool.approval_required',
    id: 'evt_013',
    createdAt: '2026-08-24T09:01:10Z',
    toolCalls: [{ id: 'call_9', function: { name: 'airlock_request_approval' } }],
  },

  {
    type: 'turn.done',
    id: 'evt_014',
    createdAt: '2026-08-24T09:01:11Z',
    state: {
      status: 'completed',
      requiredActions: [{ type: 'tool_approval' }],
      metrics: { totalCostInUsd: 0.6402, totalTokens: 309_774 },
    },
  },
];

test('a realistic run lights the capabilities it actually exercised', async () => {
  const ledger = new HarnessLedger();
  const input = chunks(RUN);

  const output = await drain(
    observeTurnStream(streamOf(input), META, { onEvent: (event) => ledger.observe(event) }),
  );

  assert.equal(output.length, RUN.length, 'the run still reaches the UI intact');

  const lit = new Set(ledger.events().map((e) => e.capability));

  // Everything this run genuinely did.
  for (const [capability, why] of [
    [1, 'mcp.initialize'],
    [2, 'mcp.auth_required — GitHub authorised in-chat'],
    [3, 'two distinct MCP servers'],
    [4, 'a tool call on the exa server'],
    [5, 'sandbox.created'],
    [6, 'execute_code in the sandbox'],
    [7, 'a skill body read'],
    [8, 'thread.created'],
    [11, 'a tool response offloaded to an artifact'],
    [13, 'tool.approval_required'],
    [14, 'tool.response_required'],
    [15, 'an OpenUI block'],
    [18, 'two distinct models across threads'],
  ]) {
    assert.equal(lit.has(capability), true, `capability ${capability} should be lit by ${why}`);
  }

  // And nothing it did not. These are the ones this run never touches, and a
  // panel that lit them anyway would be the exact failure the panel exists to
  // rule out.
  for (const [capability, why] of [
    [12, 'no compaction happened in a turn this short'],
    [16, 'the stream was never resumed'],
    [17, 'no replica was lost'],
    [19, 'the run was started from the UI, not the HTTP API'],
    [21, 'no OIDC role was resolved'],
    [23, 'nobody pressed ABORT — the turn completed on its own'],
  ]) {
    assert.equal(lit.has(capability), false, `capability ${capability} must stay dark: ${why}`);
  }
});

test('the ledger records when a lamp FIRST lit, and the event that proved it', async () => {
  const ledger = new HarnessLedger();
  await drain(
    observeTurnStream(streamOf(chunks(RUN)), META, { onEvent: (event) => ledger.observe(event) }),
  );

  const sandbox = ledger.events().find((e) => e.capability === 5);
  assert.ok(sandbox, 'the sandbox lamp is lit');
  assert.equal(sandbox.evidence, 'sandbox.created');
  assert.equal(sandbox.step_id, 'evt_004', 'the lamp deep-links to the step that proved it');
  assert.equal(sandbox.at, '2026-08-24T09:00:09Z', 'and records when, from the event itself');
  assert.match(sandbox.detail, /sbx_7f2/);
});

test('replaying the same run twice does not double-count anything', async () => {
  // Reconnects replay history. A ledger that re-lit on every replay would make
  // the counter a function of how many times the tab was refreshed.
  const ledger = new HarnessLedger();
  for (let pass = 0; pass < 3; pass += 1) {
    await drain(
      observeTurnStream(streamOf(chunks(RUN)), META, { onEvent: (event) => ledger.observe(event) }),
    );
  }
  const events = ledger.events();
  assert.equal(new Set(events.map((e) => e.capability)).size, events.length, 'one entry per capability');
  assert.equal(events[0].at, '2026-08-24T09:00:01Z', 'and it keeps the first sighting, not the last');
});

test('a turn cancelled by a human lights the abort capability, and only then', async () => {
  // Approval stops a change before it starts. This is the proof that the other
  // half works: a turn that a person stopped mid-flight.
  const completed = new HarnessLedger();
  await drain(
    observeTurnStream(streamOf(chunks(RUN)), META, { onEvent: (e) => completed.observe(e) }),
  );
  assert.equal(completed.isLit(23), false, 'a turn that finished normally proves nothing about cancelling');

  const aborted = new HarnessLedger();
  const stopped = [
    ...RUN.slice(0, -1),
    {
      type: 'turn.done',
      id: 'evt_014',
      createdAt: '2026-08-24T09:01:11Z',
      state: { status: 'cancelled', metrics: { totalCostInUsd: 0.21 } },
    },
  ];
  await drain(observeTurnStream(streamOf(chunks(stopped)), META, { onEvent: (e) => aborted.observe(e) }));

  assert.equal(aborted.isLit(23), true);
  const proof = aborted.events().find((e) => e.capability === 23);
  assert.equal(proof.evidence, 'turn.done with state.status = cancelled');
  assert.equal(proof.step_id, 'evt_014', 'the lamp deep-links to the cancel itself');
});

test('the panel cannot be filled from a stream alone', async () => {
  // Five of the twenty-two are established by configuration or by observed
  // runtime behaviour rather than by an event, and no amount of streaming can
  // produce them. An honest run therefore ends below the total — which is the
  // whole reason the unlit rows stay on screen.
  const ledger = new HarnessLedger();
  await drain(
    observeTurnStream(streamOf(chunks(RUN)), META, { onEvent: (event) => ledger.observe(event) }),
  );
  assert.ok(ledger.litCount < CAPABILITY_TOTAL, 'a stream alone must not be able to fill the panel');
  assert.ok(ledger.litCount >= 13, `expected a substantial run, got ${ledger.litCount}`);
});

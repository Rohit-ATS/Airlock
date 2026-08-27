import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RESUME_POLICY,
  NO_RESUMES,
  RESUME_INPUT,
  formatDelay,
  planResume,
  readTurnState,
  resumeDelayMs,
  unwrapEvents,
} from '../dist/index.js';

/**
 * Resuming a run the provider interrupted, tested against a real capture.
 *
 * `fixtures/rate-limited-session.json` is not hand-written. It is the verbatim
 * body of `GET /api/v1/sessions/{id}/events` from TrueForge 0.1.4 for a session
 * that died on an OpenAI 429 mid-run and was then resumed with an empty-input
 * turn — the exact manoeuvre this module exists to decide. Only the
 * organisation id is redacted.
 *
 * That matters more here than anywhere else in the suite, because the whole
 * feature rests on two claims about a third party's API that could not be
 * guessed and had to be observed: that a rate limit arrives as a *terminal turn
 * state* rather than an exception, and that a turn created with no input
 * continues the conversation instead of starting a new one. A fixture invented
 * from the same assumptions would have agreed with any bug I wrote.
 */

const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const captured = JSON.parse(
  fs.readFileSync(path.join(here, 'test', 'fixtures', 'rate-limited-session.json'), 'utf8'),
);

/** Jitter pinned to zero, so a backoff can be asserted as a number. */
const noJitter = () => 0;

/* -------------------------------------------------------------------------- */
/* The capture                                                                */
/* -------------------------------------------------------------------------- */

test('the captured run really did die on a provider rate limit', () => {
  const events = unwrapEvents(captured);
  const dones = events.filter((e) => e.type === 'turn.done');
  assert.equal(dones.length, 2, 'the capture should hold a failed turn and its resume');

  const outcome = readTurnState(dones[0].state);
  assert.equal(outcome.state, 'failed');
  assert.equal(outcome.failure.kind, 'RATE_LIMITED');
  assert.match(outcome.failure.message, /429/);
  // The interval is the whole reason we can do better than a fixed backoff.
  assert.equal(outcome.failure.retryAfterSeconds, 8.764);
});

test('the resume carried no input, and the run finished', () => {
  const events = unwrapEvents(captured);
  const created = events.filter((e) => e.type === 'turn.created');
  assert.equal(created.length, 2);

  // The first turn is the operator's request; the second is the resume. If this
  // ever inverts, the resume resent history — which would double the input
  // tokens of the request that was just refused for size.
  assert.equal(created[0].input.length, 1);
  assert.equal(created[0].input[0].type, 'user.message');

  // The harness drops the field entirely rather than echoing `input: []`, so a
  // reader testing `input.length` on a resumed turn throws. Anything deciding
  // "was this a resume" has to treat absent and empty as the same thing — which
  // is why the observer asks `!req.input || req.input.length === 0`.
  assert.equal(created[1].input, undefined);

  // The chain is the actual proof that no history was resent: the resume names
  // the failed turn as its parent, so the conversation continued rather than
  // restarting.
  assert.equal(created[1].previous_turn_id, created[0].turn_id);

  const dones = events.filter((e) => e.type === 'turn.done');
  assert.equal(readTurnState(dones[1].state).state, 'complete');
});

test('the plan for the captured failure is to wait roughly what the provider asked', () => {
  const events = unwrapEvents(captured);
  const failed = events.filter((e) => e.type === 'turn.done')[0];
  const outcome = readTurnState(failed.state);

  const plan = planResume(outcome.failure, NO_RESUMES, DEFAULT_RESUME_POLICY, noJitter);
  assert.equal(plan.resume, true);
  // 8.764s × 1.35 + 500ms, to the millisecond. Asserted exactly rather than as
  // a range: a backoff nobody can predict is a backoff nobody can review.
  assert.equal(plan.delayMs, 12_331);
  assert.match(plan.reason, /Rate limited by the model provider/);
});

/* -------------------------------------------------------------------------- */
/* A pause is not a failure                                                   */
/* -------------------------------------------------------------------------- */

test('a done turn holding for a human is held, never complete', () => {
  const outcome = readTurnState({
    status: 'done',
    required_actions: [{ type: 'tool.approval_required' }],
  });
  assert.equal(outcome.state, 'held');
  assert.deepEqual(outcome.actions, ['tool.approval_required']);
});

test('required actions are read in both spellings', () => {
  // The HTTP surface is snake_case and the SDK camelCases the same field.
  // Betting on one spelling here means resuming a run that is waiting for a
  // person to approve something, which is the worst outcome available.
  const snake = readTurnState({ status: 'done', required_actions: [{ type: 'tool.response_required' }] });
  const camel = readTurnState({ status: 'done', requiredActions: [{ type: 'tool.response_required' }] });
  assert.equal(snake.state, 'held');
  assert.equal(camel.state, 'held');
});

test('a held turn outranks even an error status', () => {
  // Belt and braces: if a turn somehow reports both, the human wins.
  const outcome = readTurnState({
    status: 'error',
    message: 'Request failed (429): rate limit',
    required_actions: [{ type: 'tool.approval_required' }],
  });
  assert.equal(outcome.state, 'held');
});

/* -------------------------------------------------------------------------- */
/* Reading a state                                                            */
/* -------------------------------------------------------------------------- */

test('the ordinary endings are read as themselves', () => {
  assert.equal(readTurnState({ status: 'done' }).state, 'complete');
  assert.equal(readTurnState({ status: 'cancelled' }).state, 'cancelled');
  assert.equal(readTurnState({ status: 'running' }).state, 'running');
  assert.equal(readTurnState({}).state, 'running');
  assert.equal(readTurnState(null).state, 'running');
});

test('an error the harness declined to explain is not retried', () => {
  const outcome = readTurnState({ status: 'error' });
  assert.equal(outcome.state, 'failed');
  assert.equal(outcome.failure.kind, 'UNKNOWN');
  assert.match(outcome.failure.message, /gave no reason/);

  const plan = planResume(outcome.failure);
  assert.equal(plan.resume, false);
  assert.match(plan.reason, /Not retryable/);
});

/* -------------------------------------------------------------------------- */
/* The backoff                                                                */
/* -------------------------------------------------------------------------- */

const rateLimit = (seconds) => ({
  kind: 'RATE_LIMITED',
  message: `Request failed (429): rate limit. Please try again in ${seconds}s.`,
  retryAfterSeconds: seconds,
});

test('the provider interval is padded rather than taken at face value', () => {
  // Retrying at exactly the stated instant hands the same oversized request to
  // a window that has only just refilled.
  assert.equal(resumeDelayMs(rateLimit(10), 1, DEFAULT_RESUME_POLICY, noJitter), 14_000);
});

test('with no interval, the wait doubles per attempt', () => {
  const noHint = { kind: 'PROVIDER', message: 'Request failed (503)', retryAfterSeconds: null };
  assert.equal(resumeDelayMs(noHint, 1, DEFAULT_RESUME_POLICY, noJitter), 1_000);
  assert.equal(resumeDelayMs(noHint, 2, DEFAULT_RESUME_POLICY, noJitter), 2_000);
  assert.equal(resumeDelayMs(noHint, 3, DEFAULT_RESUME_POLICY, noJitter), 4_000);
  assert.equal(resumeDelayMs(noHint, 4, DEFAULT_RESUME_POLICY, noJitter), 8_000);
});

test('no single wait exceeds the ceiling, whatever the provider asks for', () => {
  // A provider asking for an hour is not asking for a retry.
  assert.equal(resumeDelayMs(rateLimit(3600), 1, DEFAULT_RESUME_POLICY, noJitter), 60_000);
  assert.equal(resumeDelayMs(rateLimit(3600), 1, DEFAULT_RESUME_POLICY, () => 1), 60_000);
});

test('jitter widens the wait but never past the ceiling', () => {
  const full = resumeDelayMs(rateLimit(10), 1, DEFAULT_RESUME_POLICY, () => 1);
  const none = resumeDelayMs(rateLimit(10), 1, DEFAULT_RESUME_POLICY, noJitter);
  assert.ok(full > none, 'jitter should add time');
  assert.ok(full <= DEFAULT_RESUME_POLICY.maxDelayMs);
});

/* -------------------------------------------------------------------------- */
/* The ceilings                                                               */
/* -------------------------------------------------------------------------- */

test('attempts are bounded, and the last failure is quoted when they run out', () => {
  const failure = rateLimit(2);
  const spent = { attempts: DEFAULT_RESUME_POLICY.maxAttempts, waitedMs: 0 };
  const plan = planResume(failure, spent, DEFAULT_RESUME_POLICY, noJitter);
  assert.equal(plan.resume, false);
  assert.match(plan.reason, /Gave up after 6 resumes/);
  assert.match(plan.reason, /429/, 'the operator needs the provider sentence, not our summary');
});

test('total waiting is bounded independently of the attempt count', () => {
  // Four attempts left, but the clock has already run out.
  const plan = planResume(
    rateLimit(30),
    { attempts: 2, waitedMs: 295_000 },
    DEFAULT_RESUME_POLICY,
    noJitter,
  );
  assert.equal(plan.resume, false);
  assert.match(plan.reason, /waiting 295s in total/);
});

test('a failure that cannot succeed twice is never resumed', () => {
  for (const kind of ['MODEL_AUTH', 'CONTEXT_OVERFLOW', 'UNKNOWN']) {
    const plan = planResume({ kind, message: `a ${kind} failure`, retryAfterSeconds: null });
    assert.equal(plan.resume, false, `${kind} must not be resumed`);
    assert.match(plan.reason, /Not retryable/);
  }
});

test('the two retryable kinds are resumed, and say which they are', () => {
  const throttled = planResume(rateLimit(1), NO_RESUMES, DEFAULT_RESUME_POLICY, noJitter);
  assert.equal(throttled.resume, true);
  assert.match(throttled.reason, /Rate limited/);

  const upstream = planResume(
    { kind: 'PROVIDER', message: 'Request failed (502)', retryAfterSeconds: null },
    NO_RESUMES,
    DEFAULT_RESUME_POLICY,
    noJitter,
  );
  assert.equal(upstream.resume, true);
  assert.match(upstream.reason, /provider errored/);
});

test('attempts are numbered from one and reported to the operator', () => {
  const plan = planResume(rateLimit(1), { attempts: 3, waitedMs: 10_000 }, DEFAULT_RESUME_POLICY, noJitter);
  assert.equal(plan.resume, true);
  assert.equal(plan.attempt, 4);
  assert.match(plan.reason, /attempt 4 of 6/);
});

/* -------------------------------------------------------------------------- */
/* Small things that would be embarrassing to get wrong                       */
/* -------------------------------------------------------------------------- */

test('a resume carries no input at all', () => {
  assert.deepEqual([...RESUME_INPUT], []);
});

test('delays read as time, not as milliseconds', () => {
  assert.equal(formatDelay(750), '750ms');
  assert.equal(formatDelay(8_764), '8.8s');
  assert.equal(formatDelay(125_000), '2m 5s');
  assert.equal(formatDelay(120_000), '2m');
});

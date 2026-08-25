import { NextResponse } from 'next/server';
import { airlockAgentName, breakGlassEnabled, envSource, trueforgeBaseUrl } from '@/data/env';
import { activePolicy } from '@/data/policy';

export const dynamic = 'force-dynamic';

/**
 * Runtime configuration for the browser.
 *
 * The harness URL used to be a `NEXT_PUBLIC_` value inlined at build time, and
 * that was the wrong shape twice over. It meant pointing the console at a
 * different server required a rebuild — and, worse, when the value failed to
 * resolve at build time the console silently baked in its `:8790` default and
 * then failed every call to the real server on `:8791` with
 * ERR_CONNECTION_REFUSED, behind an unrelated React warning, on a page that
 * otherwise rendered perfectly. Nothing on screen said "wrong port".
 *
 * Reading it here instead means the value is resolved by the process that is
 * actually running, from the environment it is actually in, every time it is
 * asked. Change `.env`, restart, done.
 *
 * Nothing secret is exposed: this is an origin the browser is about to talk to
 * directly, and the agent name is in the repository.
 */
export async function GET() {
  const { source, searched, keys } = envSource();
  return NextResponse.json({
    // A path, not an origin: the browser calls this console and the console
    // forwards. TrueForge sends no CORS headers, so a direct call from the
    // page fails before it reaches the server.
    harnessPath: '/harness',
    // Reported for operators; the browser must not call it directly.
    trueforgeBaseUrl: trueforgeBaseUrl(),
    agentName: airlockAgentName(),
    breakGlassEnabled: breakGlassEnabled(),
    // The run budget, straight from `airlock.policy.yaml`. The console needs it
    // to enforce, and it is the same document the gate reads — a ceiling that
    // lived only in the browser would be a ceiling nobody could audit.
    budget: activePolicy().budget,
    // Which .env this process actually read. Present because the absence of
    // this line cost an hour: a console pointed at the wrong port looks
    // identical to a console pointed at the right one until something fails.
    env: { source, searched, keys, cwd: process.cwd() },
  });
}

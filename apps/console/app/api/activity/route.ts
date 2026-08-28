import { NextResponse } from 'next/server';
import { summariseEvents, unwrapEvents, type ActivitySummary } from '@airlock/contract';
import { trueforgeBaseUrl } from '@/data/env';

export const dynamic = 'force-dynamic';

/**
 * What the agent is doing, for runs nobody in this browser started.
 *
 * The DOING lane read from `RunStore`, whose only writer is the observer around
 * `createTurn` — which fires when *this tab* posts a turn through the composer.
 * Every run that matters in AIRLOCK is started by a webhook or the HTTP API and
 * never touches a browser, so the lane that exists to show autonomy was blank
 * unless a human sat down and did the thing autonomy removes.
 *
 * This route asks the harness instead. It runs server-side for two reasons that
 * are both load-bearing: TrueForge sends no CORS headers, so the page cannot
 * call it directly; and reading sessions belongs on the server anyway, since
 * that is where the credentials would live in any real deployment.
 *
 * Read-only. It creates nothing, cancels nothing and decides nothing.
 */

const BASE = trueforgeBaseUrl();

/** How many recent sessions to summarise. The console shows the newest. */
const SESSIONS = 4;

/** A poll every few seconds must not be able to wedge on a slow harness. */
const TIMEOUT_MS = 6000;

interface SessionRow {
  id: string;
  agent: string;
  createdAt: string | null;
}

/**
 * The answer, or the reason there wasn't one.
 *
 * `null` used to mean both "the harness said no" and "there was no harness to
 * ask", which is the same collapse this console exists to argue against
 * everywhere else. It mattered: with zero sessions the route reported
 * `reachable: false` against a perfectly healthy harness, and the note under it
 * had to say "no sessions, **or** the harness could not be reached" because the
 * code genuinely did not know which.
 */
type Answer = { ok: true; body: unknown } | { ok: false; detail: string };

async function ask(path: string): Promise<Answer> {
  try {
    const res = await fetch(new URL(path, BASE), {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (error) {
    // A harness that is down is a state to render, not an exception to throw.
    return { ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
  }
}

function readSessions(payload: unknown): SessionRow[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const r = row as {
        id?: unknown;
        created_at?: unknown;
        agent?: { name?: unknown };
      };
      return {
        id: typeof r.id === 'string' ? r.id : '',
        agent: typeof r.agent?.name === 'string' ? r.agent.name : 'unknown',
        createdAt: typeof r.created_at === 'string' ? r.created_at : null,
      };
    })
    .filter((row) => row.id);
}

export interface ActivityRun extends ActivitySummary {
  session_id: string;
  agent: string;
  created_at: string | null;
}

export async function GET() {
  const answer = await ask(`/api/v1/sessions?limit=${SESSIONS}`);

  // The harness did not answer. This is the case the console must never render
  // as an empty run: "nothing happened" and "nobody could ask" call for
  // completely different actions from the person reading the screen.
  if (!answer.ok) {
    return NextResponse.json({
      reachable: false,
      runs: [],
      base_url: BASE,
      detail: answer.detail,
      note: `The TrueForge harness at ${BASE} could not be reached.`,
    });
  }

  const sessions = readSessions(answer.body);

  // Reached, and genuinely idle. A true statement, and a different one.
  if (sessions.length === 0) {
    return NextResponse.json({
      reachable: true,
      runs: [],
      base_url: BASE,
      note: 'The harness is reachable and has run nothing yet.',
    });
  }

  const runs: ActivityRun[] = [];
  for (const session of sessions) {
    const events = await ask(`/api/v1/sessions/${encodeURIComponent(session.id)}/events`);
    if (!events.ok) continue;
    runs.push({
      session_id: session.id,
      agent: session.agent,
      created_at: session.createdAt,
      ...summariseEvents(unwrapEvents(events.body)),
    });
  }

  // Newest first, so the console can take the head as "the current run".
  runs.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  return NextResponse.json({ reachable: true, runs, base_url: BASE });
}

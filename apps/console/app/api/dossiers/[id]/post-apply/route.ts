import { NextResponse } from 'next/server';
import { recordPostApply } from '@/data/dossierStore';

export const dynamic = 'force-dynamic';

/**
 * The health check that runs the moment a change lands.
 *
 * This is the seam the verification engine writes through: it applies the
 * change to production, immediately re-checksums the affected tables, and posts
 * the digest here. AIRLOCK compares it against what the certificate predicted
 * and decides what that means.
 *
 * Three outcomes, and the third is the one worth having:
 *
 *   HEALTHY  production matches the certificate. Nothing to do.
 *   REVERT   it does not match, and the rollback was proven against a shadow
 *            copy. Execute it — this is the Undo Certificate paying for itself.
 *   ALARM    it does not match and there is no proven inverse. Touch nothing,
 *            get a human. Running an untested rollback against a database
 *            already in an unexpected state is how this gets worse.
 *
 * A missing `observed_checksum` is NOT_CHECKED, never HEALTHY. Silence is not
 * health, and a system that treats "I did not look" as "it is fine" is worse
 * than one with no health check at all.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let body: { observed_checksum?: string | null; duration_ms?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an empty body is a check that observed nothing, which is a valid answer */
  }

  const result = await recordPostApply(id, body.observed_checksum ?? null, {
    ...(typeof body.duration_ms === 'number' ? { durationMs: Math.trunc(body.duration_ms) } : {}),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, message: result.message }, { status: result.status });
  }

  return NextResponse.json({
    state: result.state,
    message: result.message,
    // The engine reads this to decide whether to run the inverse. AIRLOCK
    // decides *whether*; the engine does the executing.
    execute_rollback: result.state === 'REVERT',
    rollback: result.state === 'REVERT' ? result.dossier.rollback : [],
    dossier: result.dossier,
  });
}

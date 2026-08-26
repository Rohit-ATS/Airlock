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

  let body: { observed_checksum?: unknown; duration_ms?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an empty body is a check that observed nothing, which is a valid answer */
  }

  /*
   * Validate the digest before it can reach the ledger.
   *
   * `as typeof body` is a compile-time assertion and does nothing at runtime, so
   * whatever JSON arrived went straight through. A non-string `observed_checksum`
   * — an object, a number, an array — was written into the dossier, failed the
   * contract on the next read, and was then *skipped* by the loader as a
   * malformed entry. The record did not error; it disappeared. On a sealed
   * change that is the hash chain losing a link, which is the one property this
   * ledger exists to have.
   *
   * Null stays legal and means NOT_CHECKED. A check that observed nothing is a
   * valid and important answer; a check that observed nonsense is not.
   */
  const observed = body.observed_checksum;
  if (observed !== undefined && observed !== null) {
    if (typeof observed !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(observed)) {
      return NextResponse.json(
        {
          error: 'INVALID_CHECKSUM',
          message:
            'observed_checksum must be null, or "sha256:" followed by 64 lowercase hex characters. It is compared against the certificate, so a value that is not a digest cannot be compared to one.',
        },
        { status: 400 },
      );
    }
  }

  const result = await recordPostApply(id, (observed as string | null | undefined) ?? null, {
    ...(typeof body.duration_ms === 'number' && Number.isFinite(body.duration_ms)
      ? { durationMs: Math.trunc(body.duration_ms) }
      : {}),
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

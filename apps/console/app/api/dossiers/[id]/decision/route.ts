import { NextResponse } from 'next/server';
import { decide } from '@/data/dossierStore';
import { resolveViewer } from '@/data/viewer';
import { requireSameOrigin } from '@/server/machineAuth';

export const dynamic = 'force-dynamic';

/**
 * Approve or reject a change.
 *
 * The gate runs again here against the stored dossier and the server-resolved
 * viewer. A client that posts `{"decision":"approved"}` against an unproven
 * change gets the same sealed-door answer the UI would have shown it, with the
 * machine-readable reason attached.
 *
 * The response distinguishes the two successful outcomes, because they are
 * genuinely different events: `decided` means the change moved, `countersigned`
 * means one signature was recorded and the change is still waiting for a
 * different human.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = requireSameOrigin(request);
  if (origin) return origin;

  const viewer = await resolveViewer(request);

  let body: { decision?: unknown; reason?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* falls through to the missing-decision refusal below, which is correct */
  }

  /*
   * The decision verb is matched exactly, and anything else is refused.
   *
   * This used to read `body.decision === 'rejected' ? 'rejected' : 'approved'`,
   * which made approval the default for every input that was not the literal
   * string "rejected". `{"decision":"reject"}` — the same word, one tense out —
   * approved a schema migration and answered 200. So did `{"decision":"REJECTED"}`,
   * a null, and an empty body.
   *
   * Every other mutation on a dossier already fails closed: break-glass without
   * a justification is refused, clear-injection without a reason is refused, a
   * post-apply digest that is not a digest is a 400. This was the one route
   * where the permissive branch was the fallthrough, and it was the route where
   * it mattered most, because the thing on the other side of it is production.
   *
   * A decision is the one event in this system that must be deliberate. If we
   * cannot tell which one was meant, the answer is to ask again, not to guess —
   * and a system that guesses "approved" is not a change-control system.
   */
  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json(
      {
        error: 'INVALID_DECISION',
        message:
          'decision must be exactly "approved" or "rejected". A decision is never inferred from a missing or unrecognised value, because the safe guess does not exist.',
        received: body.decision === undefined ? null : body.decision,
      },
      { status: 400 },
    );
  }

  const decision = body.decision;
  const result = await decide(id, viewer, decision, body.reason);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, message: result.message }, { status: result.status });
  }

  if (result.state === 'countersigned') {
    return NextResponse.json({
      state: 'countersigned',
      outstanding: result.outstanding,
      message: `Signature recorded. ${result.outstanding} more approver${
        result.outstanding === 1 ? '' : 's'
      } required, and it cannot be you.`,
      dossier: result.dossier,
    });
  }

  return NextResponse.json({ state: 'decided', dossier: result.dossier });
}

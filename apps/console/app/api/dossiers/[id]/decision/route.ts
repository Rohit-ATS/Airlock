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

  let body: { decision?: string; reason?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an empty body is fine; decision defaults below */
  }

  const decision = body.decision === 'rejected' ? 'rejected' : 'approved';
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

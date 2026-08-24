import { NextResponse } from 'next/server';
import { decide } from '@/data/dossierStore';
import { resolveViewer } from '@/data/viewer';

export const dynamic = 'force-dynamic';

/**
 * Approve or reject a change.
 *
 * The gate runs again here against the stored dossier and the server-resolved
 * viewer. A client that posts `{"decision":"approved"}` against an unproven
 * change gets the same sealed-door answer the UI would have shown it, with the
 * machine-readable reason attached.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
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
  return NextResponse.json({ dossier: result.dossier });
}

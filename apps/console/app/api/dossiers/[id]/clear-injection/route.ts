import { NextResponse } from 'next/server';
import { clearInjection } from '@/data/dossierStore';
import { resolveViewer } from '@/data/viewer';

export const dynamic = 'force-dynamic';

/**
 * Dismiss the injection findings on a change.
 *
 * The gate seals when untrusted content the agent read was trying to give it
 * instructions. This is the way past, and it is deliberately not a quiet one:
 * an approver, a written reason, both recorded, and the findings themselves
 * kept rather than erased.
 *
 * A detector with no override gets switched off the first week somebody's
 * marketing page quotes an article about prompt injection. A detector with a
 * silent override is worse than none at all, because it produces a clean record
 * of a change nobody actually vetted.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const viewer = await resolveViewer(request);

  let body: { reason?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an empty body fails the reason check below, which is the right answer */
  }

  const result = await clearInjection(id, viewer, body.reason ?? '');

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, message: result.message }, { status: result.status });
  }

  return NextResponse.json({ state: 'cleared', message: result.message, dossier: result.dossier });
}

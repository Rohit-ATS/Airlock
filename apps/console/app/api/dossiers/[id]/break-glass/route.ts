import { NextResponse } from 'next/server';
import { breakGlass, BREAK_GLASS_ENABLED } from '@/data/dossierStore';
import { resolveViewer } from '@/data/viewer';
import { requireSameOrigin } from '@/server/machineAuth';

export const dynamic = 'force-dynamic';

/**
 * Go around a sealed gate, deliberately and permanently.
 *
 * This endpoint exists because the alternative is worse. In every organisation
 * there is a moment where the safe path is unavailable and somebody opens a
 * psql session instead; a control plane that pretends otherwise does not
 * prevent the override, it only ensures there is no record of it.
 *
 * It refuses unless four things are true: the deployment enables it, the policy
 * permits it for this class of change, the caller is an approver, and there is
 * a written reason of real length. It never mints an approval grant — the
 * override is a separate type carrying a separate witness, so the ledger can
 * always tell the two apart, and always will.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = requireSameOrigin(request);
  if (origin) return origin;

  const viewer = await resolveViewer(request);

  let body: { justification?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* falls through to the missing-justification refusal */
  }

  const result = await breakGlass(id, viewer, body.justification ?? '');
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, message: result.message }, { status: result.status });
  }
  return NextResponse.json({ state: 'decided', dossier: result.dossier });
}

/** Whether the control is worth rendering at all in this deployment. */
export async function GET() {
  return NextResponse.json({
    enabled: BREAK_GLASS_ENABLED,
    message: BREAK_GLASS_ENABLED
      ? 'Break-glass is enabled in this deployment. Every use is attributed and sealed into the ledger.'
      : 'Break-glass is switched off in this deployment. Set AIRLOCK_BREAK_GLASS=1 to enable it, deliberately.',
  });
}

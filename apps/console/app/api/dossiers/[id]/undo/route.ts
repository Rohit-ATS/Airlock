import { NextResponse } from 'next/server';
import { undoAvailability, undoChange } from '@/data/dossierStore';
import { resolveViewer } from '@/data/viewer';
import { requireSameOrigin } from '@/server/machineAuth';

export const dynamic = 'force-dynamic';

/**
 * Take an applied change back, inside its window.
 *
 * The window is evaluated here, on the server, from `audit.applied_at` and this
 * machine's clock — never from anything the client sends. That is the whole
 * point of the endpoint existing separately from the button: a countdown in a
 * browser can be paused by a sleeping laptop or wound back by a system clock,
 * and a press that was legitimate when the button was drawn is refused if it
 * arrives after the window shut. The refusal quotes the closing time back.
 *
 * `restored_checksum` is for whatever actually ran the statements — the
 * verification engine, or a human with psql. When it is absent the undo is
 * recorded as *unmeasured*, not as successful. Nothing here is entitled to
 * claim production came back simply because no error was thrown.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const origin = requireSameOrigin(request);
  if (origin) return origin;

  const viewer = await resolveViewer(request);

  let body: { reason?: string; restored_checksum?: string | null } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* an undo with no stated reason is still an undo; the default says so */
  }

  const reason = body.reason?.trim() || 'No reason given.';
  const result = await undoChange(id, viewer, reason, body.restored_checksum ?? null);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, message: result.message }, { status: result.status });
  }

  return NextResponse.json({
    state: 'undone',
    message: result.message,
    // The caller executes; AIRLOCK decided it was allowed to. These are the
    // operations that were already proven against the shadow branch — the same
    // list, in the same order.
    rollback: result.operations,
    dossier: result.dossier,
  });
}

/** What the console needs to draw the countdown, on the clock that will judge it. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const availability = await undoAvailability(id);

  if (!availability) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'No such change.' }, { status: 404 });
  }

  return NextResponse.json(availability);
}

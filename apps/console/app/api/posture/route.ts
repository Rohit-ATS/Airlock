import { NextResponse } from 'next/server';
import { ledgerHead, posture } from '@/data/dossierStore';
import { resolveViewer } from '@/data/viewer';
import { BREAK_GLASS_ENABLED } from '@/data/dossierStore';
import { loadPolicy } from '@/data/policy';

export const dynamic = 'force-dynamic';

/**
 * The control room's headline numbers.
 *
 * Posture is computed server-side against the same gate the console renders, so
 * "3 sealed" on the dashboard and three sealed doors in the queue are the same
 * three changes by construction rather than by coincidence.
 *
 * The chain head is returned but the chain is *not* verified here. The control
 * room re-verifies it in the browser, with the same `verifyChain` this server
 * would have used, because a tamper check performed by the thing that holds the
 * data proves considerably less than one performed by the reader.
 */
export async function GET(request: Request) {
  const viewer = await resolveViewer(request);
  const [p, head] = await Promise.all([posture(viewer), ledgerHead()]);

  return NextResponse.json({
    viewer: {
      email: viewer.email,
      role: viewer.role,
      type: viewer.type,
      standalone: viewer.standalone === true,
    },
    posture: p,
    ledger: head,
    breakGlassEnabled: BREAK_GLASS_ENABLED,
    // Which policy is actually in force, and whether it came from a file. "Why
    // did that go through" should have an answer that does not require reading
    // the source.
    policy: (() => {
      const { policy, source, problems } = loadPolicy();
      return { name: policy.name, version: policy.version, source, problems };
    })(),
    generated_at: new Date().toISOString(),
  });
}

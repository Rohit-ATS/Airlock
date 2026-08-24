import { NextResponse } from 'next/server';
import { resolveViewer } from '@/data/viewer';

export const dynamic = 'force-dynamic';

/** Who the console is talking to, and the evidence for capability 21. */
export async function GET(request: Request) {
  const viewer = await resolveViewer(request);
  return NextResponse.json({
    email: viewer.email,
    role: viewer.role,
    type: viewer.type,
    authenticated: viewer.authenticated,
    evidence: viewer.evidence,
  });
}

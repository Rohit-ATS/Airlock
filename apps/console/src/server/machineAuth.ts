import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/data/env';

/**
 * Machine-to-machine writes into the ledger.
 *
 * Local `next dev` stays frictionless for the demo. A production server must
 * set AIRLOCK_API_TOKEN, and writers must send it as `Authorization: Bearer`.
 */
export function requireMachineWriter(request: Request): NextResponse | null {
  const expected = env('AIRLOCK_API_TOKEN');
  if (!expected) {
    if (process.env.NODE_ENV !== 'production') return null;
    return NextResponse.json(
      {
        error: 'AIRLOCK_API_TOKEN is not set; refusing machine writes',
        message: 'Set AIRLOCK_API_TOKEN on the console and on verifier/MCP writers.',
      },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const actual = match?.[1] ?? '';
  if (!sameToken(actual, expected)) {
    return NextResponse.json({ error: 'bad machine token' }, { status: 401 });
  }

  return null;
}

/**
 * Browser-initiated mutations must come from this console's own origin.
 *
 * Curl, tests and server-to-server calls often have no Origin header, so absence
 * is not rejected. Browsers do send it for cross-origin writes, which is the
 * case this guard exists to stop.
 */
export function requireSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  let self: string;
  try {
    self = new URL(request.url).origin;
  } catch {
    return NextResponse.json({ error: 'bad request URL' }, { status: 400 });
  }

  if (origin !== self) {
    return NextResponse.json({ error: 'cross-origin write refused' }, { status: 403 });
  }

  return null;
}

function sameToken(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

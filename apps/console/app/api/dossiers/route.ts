import { NextResponse } from 'next/server';
import { listDossiers, putDossier } from '@/data/dossierStore';

export const dynamic = 'force-dynamic';

/**
 * The change queue and the ledger, in one list.
 *
 * Seeding from `contracts/examples` happens inside the store, not here, so that
 * every route sees the same ledger regardless of which one is hit first. Set
 * AIRLOCK_NO_SEED=1 to start empty.
 */
export async function GET() {
  return NextResponse.json({ dossiers: await listDossiers() });
}

/**
 * Upsert a dossier. This is the seam the verification engine writes through: it
 * runs the proof, fills in the certificate, and POSTs the result here.
 *
 * The contract is enforced on the way in, so a malformed certificate is a 400
 * rather than a broken card — and a dossier can never enter the ledger in a
 * shape the gate cannot evaluate.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  try {
    const dossier = await putDossier(body);
    return NextResponse.json({ dossier });
  } catch (error) {
    return NextResponse.json(
      { error: 'dossier does not match the contract', detail: String(error) },
      { status: 400 },
    );
  }
}

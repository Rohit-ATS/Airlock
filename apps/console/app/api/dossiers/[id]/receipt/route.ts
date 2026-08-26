import { NextResponse } from 'next/server';
import { detach } from '@airlock/contract';
import { getDossier } from '@/data/dossierStore';

export const dynamic = 'force-dynamic';

/**
 * Export a detached receipt for one decided change.
 *
 * The use case is mundane and real: an auditor asks "show me the approval for
 * the erasure you ran in August". You hand them one file. They verify it with
 *
 *     node scripts/verify-ledger.mjs receipt.json
 *
 * and satisfy themselves that the record has not been altered since it was
 * sealed — without access to the console, the database, or anybody's word for
 * it. That last part is the point: a receipt that can only be checked by the
 * system that issued it is not evidence.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dossier = await getDossier(id);

  if (!dossier) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'No such change.' }, { status: 404 });
  }

  const receipt = detach(dossier);
  if (!receipt) {
    return NextResponse.json(
      {
        error: 'NOT_SEALED',
        message: 'This change has not been decided yet, so there is nothing to attest to.',
      },
      { status: 409 },
    );
  }

  const filenameId = id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'change';
  return new NextResponse(JSON.stringify(receipt, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="airlock-receipt-${filenameId}.json"`,
    },
  });
}

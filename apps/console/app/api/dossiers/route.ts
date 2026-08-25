import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { listDossiers, putDossier, seedIfEmpty } from '@/data/dossierStore';
import { seedDisabled } from '@/data/env';

export const dynamic = 'force-dynamic';

/**
 * Seed the ledger from the contract examples the first time it is read.
 *
 * This is what makes the console show something real ninety seconds after a
 * clone, without a database or a single API key. These are console fixtures —
 * they exercise the certificate card, the queue and the ledger. They are not
 * evidence about anybody's database, and the README says exactly that.
 *
 * Set AIRLOCK_NO_SEED=1 to start with an empty ledger.
 */
async function loadExamples(): Promise<unknown[]> {
  if (seedDisabled()) return [];
  const dir = path.join(process.cwd(), '..', '..', 'contracts', 'examples');
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'));
    return await Promise.all(names.map(async (n) => JSON.parse(await fs.readFile(path.join(dir, n), 'utf8'))));
  } catch {
    return [];
  }
}

/** The change queue and the ledger, in one list. */
export async function GET() {
  const existing = await listDossiers();
  if (existing.length === 0) {
    const examples = await loadExamples();
    if (examples.length > 0) await seedIfEmpty(examples);
  }
  const dossiers = await listDossiers();
  return NextResponse.json({ dossiers });
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

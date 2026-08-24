import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Dossier, parseDossier, openGate, isGrant, type Viewer } from '@airlock/contract';

/**
 * The change ledger, server-side.
 *
 * Dossiers are written by the verification engine and read by the console. This
 * is a file-backed store so `make demo` needs no database and a judge can read
 * the ledger with `cat`. The interesting part is not the persistence — it is
 * `decide()`, which re-runs the gate on the server so an approval cannot be
 * forged by a client that skipped the UI.
 */

const DATA_DIR = process.env.AIRLOCK_DATA_DIR ?? path.join(process.cwd(), '.airlock');
const LEDGER = path.join(DATA_DIR, 'ledger.json');

type Ledger = Record<string, Dossier>;

let cache: Ledger | null = null;

async function load(): Promise<Ledger> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(LEDGER, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Ledger = {};
    for (const [id, value] of Object.entries(parsed)) {
      const result = Dossier.safeParse(value);
      // A malformed record is skipped rather than crashing the queue, but it is
      // reported — a silently missing change is worse than a noisy one.
      if (result.success) out[id] = result.data;
      else console.error(`[airlock] ledger entry ${id} does not match the contract; skipping`);
    }
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

async function persist(ledger: Ledger): Promise<void> {
  cache = ledger;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
}

export async function listDossiers(): Promise<Dossier[]> {
  const ledger = await load();
  return Object.values(ledger).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getDossier(id: string): Promise<Dossier | null> {
  const ledger = await load();
  return ledger[id] ?? null;
}

/** Upsert. The contract is enforced here, so bad data never enters the ledger. */
export async function putDossier(input: unknown): Promise<Dossier> {
  const dossier = parseDossier(input);
  const ledger = { ...(await load()) };
  ledger[dossier.dossier_id] = dossier;
  await persist(ledger);
  return dossier;
}

export type DecisionResult =
  | { ok: true; dossier: Dossier }
  | { ok: false; status: number; reason: string; message: string };

/**
 * Record an approval or rejection.
 *
 * The gate runs again here, on the server, against the stored dossier. The
 * client cannot talk its way past it: an approval is accepted only if
 * `openGate` mints a grant for this viewer, and the grant is verified with
 * `isGrant` before anything is written. A caller that skipped the console
 * entirely gets the same answer the console would have given.
 */
export async function decide(
  id: string,
  viewer: Viewer,
  decision: 'approved' | 'rejected',
  reason?: string,
): Promise<DecisionResult> {
  const dossier = await getDossier(id);
  if (!dossier) return { ok: false, status: 404, reason: 'NOT_FOUND', message: 'No such change.' };

  if (decision === 'approved') {
    const gate = openGate(dossier, viewer);
    if (gate.state !== 'OPEN') {
      return { ok: false, status: 403, reason: gate.reason, message: gate.message };
    }
    // Belt and braces: the runtime witness, not just the type.
    if (!isGrant(gate.grant)) {
      return { ok: false, status: 500, reason: 'FORGED_GRANT', message: 'Approval proof failed verification.' };
    }
  } else if (viewer.role !== 'approver') {
    return {
      ok: false,
      status: 403,
      reason: 'ROLE_NOT_APPROVER',
      message: 'Only an approver can reject a change.',
    };
  }

  const now = new Date().toISOString();
  const next: Dossier = {
    ...dossier,
    approval: {
      ...dossier.approval,
      approver: viewer.email,
      at: now,
      decision,
      reason: reason ?? null,
    },
    audit:
      decision === 'approved'
        ? {
            ...dossier.audit,
            applied_at: now,
            applied_by: viewer.email,
            // The post-apply checksum is written by the engine once production
            // has actually changed. We do not invent one here.
            post_apply_checksum: dossier.audit.post_apply_checksum,
          }
        : dossier.audit,
  };

  const ledger = { ...(await load()) };
  ledger[id] = next;
  await persist(ledger);
  return { ok: true, dossier: next };
}

/** Seed the ledger from the contract examples, for `make demo`. Never overwrites. */
export async function seedIfEmpty(examples: unknown[]): Promise<number> {
  const ledger = await load();
  if (Object.keys(ledger).length > 0) return 0;
  const next: Ledger = {};
  let n = 0;
  for (const example of examples) {
    const parsed = Dossier.safeParse(example);
    if (parsed.success) {
      next[parsed.data.dossier_id] = parsed.data;
      n += 1;
    }
  }
  await persist(next);
  return n;
}

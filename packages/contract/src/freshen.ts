/**
 * Demo fixtures that do not expire before anyone sees them.
 *
 * The problem this solves is worth stating precisely, because the obvious
 * reading of it is wrong.
 *
 * Policy gives a proof a freshness window — 600 to 3600 seconds depending on
 * the change class — and the gate refuses a certificate older than that. That
 * rule is correct and is not touched here. What was broken is the shipped
 * fixtures: they carry absolute timestamps from the day they were written, so
 * a checkout two days later has thirteen changes in the queue and **every one
 * of them sealed CERTIFICATE_STALE**. The console looks broken, the approval —
 * the single human moment the whole product exists for — cannot be reached at
 * all, and the gate is behaving perfectly the entire time.
 *
 * The fixtures were authored to mean "proven four minutes ago". Encoding that
 * as `2026-08-24T11:22:00Z` is what makes them rot. Rebasing restores the
 * meaning the author intended.
 *
 * Two rules keep this honest:
 *
 *   - **Sealed records are never touched.** A dossier with a receipt is in the
 *     hash chain; rewriting its timestamps would break the chain, and a ledger
 *     you can rewrite is not a ledger. History stays in the past, which is also
 *     where it belongs.
 *   - **Each open fixture is rebased on its own clock.** Every one is shifted so
 *     that its own proof was taken `GRACE_SECONDS` ago, and the internal gaps
 *     inside it — created → verified, and any expiry it carries — are preserved
 *     exactly.
 *
 * That second rule replaced a single uniform offset, and the reason is worth
 * recording. The fixtures were written across a working day, spanning about
 * five and a half hours, against freshness windows of ten minutes to an hour.
 * They were therefore *never* all fresh at once, and shifting them as one block
 * left the two that are supposed to be approvable still expired. Rebasing each
 * on its own clock asks the question the author was actually posing: given this
 * proof, just taken, what does the gate say?
 *
 * It does not make everything green, and that is the test of it. Eleven of the
 * thirteen open fixtures are sealed for reasons that have nothing to do with
 * time — a grant with no expiry, an unresolved fact, a detected injection,
 * production drift, three policy ceilings, a failed proof — and they stay
 * sealed. Only the two the author built to be approvable become approvable.
 *
 * And the freshness rule still bites afterwards: leave the console open long
 * enough and these certificates expire again, exactly as they should.
 */

/** How long ago a rebased proof was taken. Comfortably inside the tightest window. */
const GRACE_SECONDS = 120;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Shift every ISO-8601 timestamp in a value by `offsetMs`, structure unchanged. */
export function rebaseTimestamps<T>(value: T, offsetMs: number): T {
  if (typeof value === 'string') {
    if (!ISO.test(value)) return value;
    const shifted = new Date(new Date(value).getTime() + offsetMs);
    return (Number.isNaN(shifted.getTime()) ? value : shifted.toISOString()) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rebaseTimestamps(entry, offsetMs)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rebaseTimestamps(entry, offsetMs);
    }
    return out as unknown as T;
  }
  return value;
}

/** A record already in the hash chain. Its timestamps are load-bearing. */
function isSealed(record: unknown): boolean {
  return Boolean((record as { receipt?: unknown } | null)?.receipt);
}

function millis(raw: unknown): number {
  if (typeof raw !== 'string') return Number.NaN;
  const at = new Date(raw).getTime();
  return Number.isNaN(at) ? Number.NaN : at;
}

/**
 * The moment a record should be measured from.
 *
 * The proof's own `verified_at` when there is one, because freshness is about
 * the proof rather than the paperwork around it. Otherwise `created_at`.
 */
function anchorOf(record: unknown): number {
  const shaped = record as { created_at?: unknown; certificate?: { verified_at?: unknown } } | null;
  const verified = millis(shaped?.certificate?.verified_at);
  return Number.isNaN(verified) ? millis(shaped?.created_at) : verified;
}

/**
 * Rebase fixtures so each open one reads as having been proven just now.
 *
 * Returns them in the order given. Sealed records come back untouched, and a
 * record with no usable timestamp is passed through rather than guessed at.
 */
export function freshenFixtures<T>(records: readonly T[], now: Date = new Date()): T[] {
  const target = now.getTime() - GRACE_SECONDS * 1000;

  return records.map((record) => {
    if (isSealed(record)) return record;
    const anchor = anchorOf(record);
    if (Number.isNaN(anchor)) return record;
    // Never drag a fixture backwards: one that is already fresher than the
    // grace window is left exactly as it is.
    const offset = target - anchor;
    if (offset <= 0) return record;
    return rebaseTimestamps(record, offset);
  });
}

/**
 * How stale the freshest open fixture is, in seconds.
 *
 * Exposed so a caller can report what it found rather than shifting time
 * silently. A seed that quietly rewrites timestamps is the sort of thing that
 * should be printed, not hidden.
 */
export function fixtureAgeSeconds(records: readonly unknown[], now: Date = new Date()): number {
  const anchors = records
    .filter((record) => !isSealed(record))
    .map(anchorOf)
    .filter((at) => !Number.isNaN(at));
  if (anchors.length === 0) return 0;
  return Math.max(0, Math.round((now.getTime() - Math.max(...anchors)) / 1000));
}

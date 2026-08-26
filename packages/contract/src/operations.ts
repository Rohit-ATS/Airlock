/**
 * Binding a certificate to the statements it actually measured.
 *
 * A checksum triple answers "did the data come back?". It does not answer "come
 * back from *what*?" — and nothing in the dossier connected the two. The gate
 * read `certificate.checksums` and `dossier.rollback[].proven`, and never once
 * read `dossier.forward`.
 *
 * Which left this, found by an adversarial audit of the running system:
 *
 *   1. open a change with a trivial forward/rollback pair
 *   2. run airlock_verify_change — a genuinely PROVEN certificate, honestly
 *      measured, real digests over real rows
 *   3. re-open the same dossier_id with the destructive SQL you actually wanted
 *   4. the certificate is untouched, every gate condition still passes, and a
 *      human is shown real checksums certifying statements that are no longer
 *      in the dossier
 *
 * The proof was true. It was true about something else. That is a worse failure
 * than a fabricated checksum, because every individual number on the card
 * survives inspection — the digests really were measured, the rollback really
 * did restore, the timings really were clocked. Only the subject changed.
 *
 * So the statements are fingerprinted at verification time and the fingerprint
 * travels inside the certificate. The gate recomputes it from the dossier as it
 * stands and refuses on any difference — the same shape, and the same reasoning,
 * as recomputing `pre === post_rollback` rather than trusting `match`.
 */

/**
 * The canonical form of a change's operations.
 *
 * Order matters and is preserved: `ADD COLUMN` then `BACKFILL` is a different
 * migration from `BACKFILL` then `ADD COLUMN`, and one of them does not work.
 * Sorting here to be tidy would make two genuinely different changes hash the
 * same, which is the one thing a fingerprint must never do.
 *
 * Whitespace is collapsed and the trailing semicolon dropped, so reformatting
 * SQL does not invalidate a proof. That is a deliberate loosening: the alarm
 * has to fire on a changed *statement*, not on a changed *indentation*, or it
 * fires constantly and gets switched off. It is a fingerprint of intent, not a
 * byte-for-byte hash of the text.
 */
export function canonicalOperations(
  forward: ReadonlyArray<{ system: string; op: string }>,
  rollback: ReadonlyArray<{ system: string; op: string }>,
): string {
  const normalise = (ops: ReadonlyArray<{ system: string; op: string }>) =>
    ops.map((o) => `${o.system}${o.op.replace(/\s+/g, ' ').trim().replace(/;$/, '')}`);

  return JSON.stringify({ forward: normalise(forward), rollback: normalise(rollback) });
}

/**
 * `sha256:…` over the canonical form.
 *
 * Async because it uses WebCrypto, like the receipt chain — one hashing story
 * in the codebase rather than two.
 */
export async function operationsFingerprint(
  forward: ReadonlyArray<{ system: string; op: string }>,
  rollback: ReadonlyArray<{ system: string; op: string }>,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalOperations(forward, rollback));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

/**
 * Do the statements in this dossier still match the ones the proof was taken
 * against?
 *
 * Answers only on evidence, and the two "no evidence" cases are deliberately
 * different:
 *
 *   - a certificate with no fingerprint predates this feature, and is not
 *     accused of anything. Silence is not proof of tampering.
 *   - a certificate *with* a fingerprint that no longer matches is refused,
 *     because that is a positive reading, not an absence.
 *
 * Synchronous by design: the gate is synchronous, and it compares two strings
 * exactly as it does for production drift. The expensive half — hashing —
 * belongs to whoever did the work.
 */
export function operationsChanged(
  pinned: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (!pinned || !current) return false;
  return pinned !== current;
}

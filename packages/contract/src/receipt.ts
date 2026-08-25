/**
 * The tamper-evident change ledger.
 *
 * A change-control system whose audit log can be edited is a change-control
 * theatre. AIRLOCK's ledger is a hash chain: each decided change carries the
 * hash of the one before it, so altering any historical record — a checksum, an
 * approver, a timestamp, the justification on a break-glass — invalidates every
 * link after it, and `verifyChain` reports the exact record where the chain
 * broke.
 *
 * This does not make the ledger unforgeable. Anyone who can rewrite the file
 * can recompute the whole chain. What it makes is *tampering visible* to anyone
 * holding an older copy of a single hash — which is the property that actually
 * matters, because the person auditing you is not the person who edited it.
 *
 * Everything here runs on the Web Crypto API, which exists identically in the
 * browser and in Node 18+. That is deliberate: the landing page verifies a real
 * chain in front of the reader, using the same function the server uses. No
 * hand-rolled digest, no Node-only import, no divergence between the code that
 * proves it and the code that shows it.
 */
import type { Dossier, Receipt } from './dossier.js';

/* -------------------------------------------------------------------------- */
/* Canonicalisation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic JSON: object keys sorted, no incidental whitespace.
 *
 * Two structurally identical dossiers must hash identically regardless of the
 * order a JSON parser happened to produce their keys in, or the chain would
 * break on a round-trip through any store that does not preserve key order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * The part of a dossier a receipt commits to.
 *
 * Not the whole document: the harness event list and the running cost keep
 * changing after a decision is recorded, and a chain that breaks because a
 * token counter ticked would be a chain nobody trusts. What is committed to is
 * everything that answers "what was decided, on what evidence, by whom".
 *
 * `post_apply` is deliberately outside it too, and for a better reason than
 * convenience. A receipt seals a decision and the evidence it was taken on.
 * What production did *afterwards* — the health check, and any automatic
 * rollback — is a later fact about the world, not a revision of the decision.
 * Folding it in would mean either re-sealing a sealed record, which is exactly
 * the thing this chain exists to make impossible, or refusing to record what
 * happened. Neither is acceptable, so the two are kept apart.
 */
export function receiptBody(dossier: Dossier): Record<string, unknown> {
  return {
    dossier_id: dossier.dossier_id,
    change_class: dossier.change_class,
    request: dossier.request,
    requested_by: dossier.requested_by,
    created_at: dossier.created_at,
    certificate: dossier.certificate ?? null,
    magnitude: dossier.magnitude,
    principals: dossier.principals,
    forward: dossier.forward,
    rollback: dossier.rollback,
    signatures: dossier.signatures,
    approval: dossier.approval,
    audit: dossier.audit,
  };
}

/* -------------------------------------------------------------------------- */
/* Digest                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The two web platform pieces this file needs, declared structurally.
 *
 * Naming `SubtleCrypto` or `TextEncoder` directly would drag the DOM lib into a
 * package that also runs on a server — and quietly permit `document` in a file
 * that must never touch it. Declaring the exact shape used instead keeps the
 * dependency to two methods, visible in one place.
 */
interface Sha256Digester {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}
interface Utf8Encoder {
  encode(input: string): Uint8Array;
}

type WebPlatform = {
  crypto?: { subtle?: Sha256Digester };
  TextEncoder?: new () => Utf8Encoder;
};

let cachedEncoder: Utf8Encoder | null = null;

function platform(): { subtle: Sha256Digester; encoder: Utf8Encoder } {
  const g = globalThis as unknown as WebPlatform;
  const subtle = g.crypto?.subtle;
  if (!subtle || !g.TextEncoder) {
    throw new Error(
      'AIRLOCK receipts need the Web Crypto API and TextEncoder. Both are present in browsers and in Node 18 and later.',
    );
  }
  if (!cachedEncoder) cachedEncoder = new g.TextEncoder();
  return { subtle, encoder: cachedEncoder };
}

function hex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** sha256 of a string, rendered in AIRLOCK's `sha256:<hex>` evidence form. */
export async function sha256(input: string): Promise<string> {
  const { subtle, encoder } = platform();
  const digest = await subtle.digest('SHA-256', encoder.encode(input));
  return `sha256:${hex(digest)}`;
}

/** The genesis link. Every chain starts here, so an empty ledger still verifies. */
export const GENESIS_HASH = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Hash one link: the previous hash, the sequence number and the committed body.
 *
 * `prev_hash` and `seq` are inside the digest, not beside it, so a record
 * cannot be moved to a different position in the chain without changing its
 * hash.
 */
export async function hashLink(dossier: Dossier, seq: number, prevHash: string): Promise<string> {
  return sha256(canonicalJson({ seq, prev: prevHash, body: receiptBody(dossier) }));
}

/** Mint the receipt for a change being appended to the chain. */
export async function sealReceipt(dossier: Dossier, seq: number, prevHash: string, at?: string): Promise<Receipt> {
  return {
    seq,
    prev_hash: prevHash,
    hash: await hashLink(dossier, seq, prevHash),
    sealed_at: at ?? new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

export interface ChainLink {
  dossier_id: string;
  seq: number;
  expected: string;
  actual: string;
  ok: boolean;
  /** Which part failed, when it did. */
  fault: 'none' | 'missing-receipt' | 'wrong-sequence' | 'broken-link' | 'content-modified';
}

export interface ChainVerdict {
  ok: boolean;
  length: number;
  links: ChainLink[];
  /** Index of the first bad link, or -1. Everything after it is untrustworthy. */
  brokenAt: number;
  /** The hash a third party can hold to detect any future edit. */
  head: string;
}

/**
 * Walk the chain and report where, if anywhere, it stops being consistent.
 *
 * The input is the sealed records in the order they were sealed. A record with
 * no receipt has not been decided yet and is not part of the chain — callers
 * filter before calling, and passing one anyway is reported rather than
 * ignored.
 */
export async function verifyChain(sealed: Dossier[]): Promise<ChainVerdict> {
  const links: ChainLink[] = [];
  let prev = GENESIS_HASH;
  let brokenAt = -1;

  for (let i = 0; i < sealed.length; i += 1) {
    const dossier = sealed[i]!;
    const receipt = dossier.receipt;

    if (!receipt) {
      links.push({
        dossier_id: dossier.dossier_id,
        seq: i,
        expected: prev,
        actual: '',
        ok: false,
        fault: 'missing-receipt',
      });
      if (brokenAt < 0) brokenAt = i;
      continue;
    }

    const recomputed = await hashLink(dossier, receipt.seq, receipt.prev_hash);

    let fault: ChainLink['fault'] = 'none';
    if (receipt.seq !== i) fault = 'wrong-sequence';
    else if (receipt.prev_hash !== prev) fault = 'broken-link';
    else if (recomputed !== receipt.hash) fault = 'content-modified';

    const ok = fault === 'none';
    links.push({
      dossier_id: dossier.dossier_id,
      seq: receipt.seq,
      expected: receipt.hash,
      actual: recomputed,
      ok,
      fault,
    });
    if (!ok && brokenAt < 0) brokenAt = i;
    prev = receipt.hash;
  }

  return {
    ok: brokenAt < 0,
    length: links.length,
    links,
    brokenAt,
    head: prev,
  };
}

/* -------------------------------------------------------------------------- */
/* Detached receipts                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A single change, exportable and independently checkable.
 *
 * The use case is mundane and real: an auditor asks "show me the approval for
 * the erasure you ran in August". You hand them one file. They run
 * `npm run verify:receipt` against it and confirm the hash matches the body,
 * without access to your database, your console, or the rest of the ledger.
 */
export interface DetachedReceipt {
  airlock: '1';
  issued_at: string;
  receipt: Receipt;
  body: Record<string, unknown>;
  /**
   * Later facts about the same change: the health check, and any undo.
   *
   * These are **not covered by the hash**, and that is not an oversight — it
   * falls straight out of what a receipt is. The hash seals a decision and the
   * evidence it was taken on, at the instant it was taken. What production did
   * twenty minutes afterwards cannot be inside that seal without re-sealing a
   * sealed record, which is the exact thing this chain exists to prevent.
   *
   * But omitting them would be worse. An auditor handed one file for a change
   * that was applied and then taken back must not read a document that says
   * only "approved and applied" — technically true, and misleading in the one
   * way that matters. So they travel alongside, labelled as unsealed, and
   * `verifyDetached` says which half it actually verified.
   */
  annotations: {
    post_apply: Dossier['post_apply'];
    undo: Dossier['undo'];
  };
}

export function detach(dossier: Dossier, issuedAt?: string): DetachedReceipt | null {
  if (!dossier.receipt) return null;
  return {
    airlock: '1',
    issued_at: issuedAt ?? new Date().toISOString(),
    receipt: dossier.receipt,
    body: receiptBody(dossier),
    annotations: {
      post_apply: dossier.post_apply,
      undo: dossier.undo,
    },
  };
}

export interface DetachedVerdict {
  ok: boolean;
  recomputed: string;
  claimed: string;
  message: string;
  /**
   * What the hash did *not* cover, named rather than left for the reader to
   * notice. A verdict that says "verified" about a document containing unsealed
   * fields, without saying which, is a verdict that overstates itself.
   */
  unsealed: string[];
}

/** Verify a detached receipt on its own, with nothing else present. */
export async function verifyDetached(input: DetachedReceipt): Promise<DetachedVerdict> {
  const recomputed = await sha256(
    canonicalJson({ seq: input.receipt.seq, prev: input.receipt.prev_hash, body: input.body }),
  );
  const ok = recomputed === input.receipt.hash;

  // Only report an annotation as unsealed when it actually carries something.
  // Listing empty fields would train a reader to skim the warning.
  const unsealed: string[] = [];
  if (input.annotations?.post_apply?.checked_at) unsealed.push('post_apply');
  if (input.annotations?.undo?.undone_at) unsealed.push('undo');

  const caveat =
    unsealed.length > 0
      ? ` This document also carries later facts about the change (${unsealed.join(', ')}) which are outside the seal and were not verified by this check.`
      : '';

  return {
    ok,
    recomputed,
    claimed: input.receipt.hash,
    unsealed,
    message:
      (ok
        ? 'The receipt matches its contents. This record has not been altered since it was sealed.'
        : 'The receipt does not match its contents. This record has been altered since it was sealed.') + caveat,
  };
}

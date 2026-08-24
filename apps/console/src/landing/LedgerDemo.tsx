'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GENESIS_HASH,
  parseDossier,
  sealReceipt,
  verifyChain,
  type ChainVerdict,
  type Dossier,
} from '@airlock/contract';
import { cx } from '@/design/primitives';

/**
 * The change ledger, tamper-evident, verified in your browser.
 *
 * Three decided changes are sealed into a hash chain when this component
 * mounts. Every record commits to the hash of the one before it, so altering
 * any of them invalidates every link after it.
 *
 * The verification runs **here**, in the reader's browser, using the same
 * `verifyChain` the server would use — and that is the point. A tamper check
 * performed by the system that holds the data proves considerably less than one
 * performed by the person who does not trust it.
 *
 * Nothing is faked: `sealReceipt` and `verifyChain` are imported from the
 * contract package and computed with the Web Crypto API. Editing a record here
 * really does recompute a SHA-256 that really does stop matching.
 */

const RECORDS: Array<{ id: string; request: string; approver: string; cls: Dossier['change_class'] }> = [
  {
    id: 'dos_orders_index',
    cls: 'SCHEMA_MIGRATION',
    request: 'Add a concurrent index on orders(customer_id, created_at).',
    approver: 'sam.okafor@airlock.dev',
  },
  {
    id: 'dos_gdpr_batch',
    cls: 'ERASURE',
    request: 'Process the four right-to-erasure requests from the week of 10 August.',
    approver: 'priya.n@airlock.dev',
  },
  {
    id: 'dos_bucket_delete',
    cls: 'INFRA_MUTATION',
    request: 'Delete the airlock-uploads-legacy bucket.',
    approver: 'sam.okafor@airlock.dev',
  },
];

const ATTACKER = 'quietly.changed@airlock.dev';

function record(index: number, approver: string): Dossier {
  const spec = RECORDS[index]!;
  const at = `2026-08-2${1 + index}T14:00:00Z`;
  return parseDossier({
    dossier_id: spec.id,
    change_class: spec.cls,
    request: spec.request,
    requested_by: 'legal@airlock.dev',
    created_at: at,
    target: { systems: ['postgres'] },
    certificate: {
      kind: spec.cls === 'ERASURE' ? 'SCOPE' : 'UNDO',
      status: 'PROVEN',
      verified_at: at,
      ...(spec.cls === 'ERASURE'
        ? {
            scope: {
              records: [{ system: 'postgres', id: '4 subjects', action: 'anonymize', count: 168 }],
              exclusions: [{ system: 'postgres', table: 'invoices', reason: 'statutory retention', count: 47 }],
            },
          }
        : {
            checksums: {
              pre: `sha256:${'11'.repeat(32)}`,
              post: `sha256:${'22'.repeat(32)}`,
              post_rollback: `sha256:${'11'.repeat(32)}`,
              match: true,
            },
          }),
    },
    signatures: [{ approver, at, decision: 'approved', reason: null, break_glass: false }],
    approval: { approver, at, role_required: 'approver', decision: 'approved', reason: null },
    audit: { applied_at: at, post_apply_checksum: null, applied_by: approver },
  });
}

export function LedgerDemo() {
  /** Which record, if any, the reader has edited. */
  const [tampered, setTampered] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const [sealing, setSealing] = useState(true);

  /** The receipts, computed once against the untouched records. */
  const [receipts, setReceipts] = useState<Dossier['receipt'][]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Dossier['receipt'][] = [];
      let prev = GENESIS_HASH;
      for (let i = 0; i < RECORDS.length; i += 1) {
        const receipt = await sealReceipt(record(i, RECORDS[i]!.approver), i, prev, '2026-08-24T09:00:00Z');
        out.push(receipt);
        prev = receipt.hash;
      }
      if (!live) return;
      setReceipts(out);
      setSealing(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  /** The ledger as it stands right now, including any edit the reader made. */
  const ledger = useMemo(() => {
    if (receipts.length !== RECORDS.length) return [];
    return RECORDS.map((spec, i) => ({
      ...record(i, i === tampered ? ATTACKER : spec.approver),
      receipt: receipts[i]!,
    }));
  }, [receipts, tampered]);

  const reverify = useCallback(async () => {
    if (ledger.length === 0) return;
    setVerdict(await verifyChain(ledger));
  }, [ledger]);

  useEffect(() => {
    void reverify();
  }, [reverify]);

  const broken = verdict !== null && !verdict.ok;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {/* ------------------------------- the chain ------------------------------ */}
      <div className="panel milled overflow-hidden">
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
          <span className="legend">Sealed history</span>
          <div className="h-px flex-1 bg-hairline" />
          <span
            className={cx(
              'evidence text-[10px]',
              sealing ? 'text-ink-4' : broken ? 'text-fault' : 'text-seal',
            )}
          >
            {sealing ? 'sealing…' : broken ? `chain broken at #${verdict!.brokenAt}` : 'chain intact'}
          </span>
        </div>

        <ol>
          {ledger.map((d, i) => {
            const link = verdict?.links[i];
            const isTampered = tampered === i;
            // A record after the break is not itself edited, but nothing about
            // it can be trusted any more, and the UI has to say so.
            const downstream = broken && verdict!.brokenAt < i;

            return (
              <li
                key={d.dossier_id}
                className={cx(
                  'relative border-b border-hairline px-4 py-3 transition-colors last:border-b-0',
                  isTampered ? 'bg-fault-bg/30' : downstream ? 'bg-raised/60' : '',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cx(
                      'mt-[3px] evidence w-6 shrink-0 text-[10px]',
                      link?.ok === false ? 'text-fault' : 'text-ink-4',
                    )}
                  >
                    #{i}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-ink">{d.request}</p>

                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10.5px]">
                      <span className="text-ink-4">approved by</span>
                      <span className={cx('evidence', isTampered ? 'text-fault' : 'text-ink-2')}>
                        {d.approval.approver}
                      </span>
                      {isTampered ? <span className="text-fault">← edited by you</span> : null}
                    </div>

                    <dl className="mt-2 space-y-0.5">
                      <ChainRow label="prev" value={d.receipt!.prev_hash} tone="dim" />
                      <ChainRow
                        label="sealed"
                        value={d.receipt!.hash}
                        tone={link?.ok === false ? 'fault' : 'ok'}
                      />
                      {link && !link.ok && link.actual ? (
                        <ChainRow label="actual" value={link.actual} tone="fault" />
                      ) : null}
                    </dl>

                    {link && !link.ok ? (
                      <p className="mt-1.5 text-[10.5px] text-fault">
                        {link.fault === 'content-modified'
                          ? 'This record no longer hashes to the value it was sealed with.'
                          : link.fault === 'broken-link'
                            ? 'This record points at a predecessor that is not the one before it.'
                            : link.fault}
                      </p>
                    ) : downstream ? (
                      <p className="mt-1.5 text-[10.5px] text-ink-4">
                        Untouched — but it comes after a break, so it can no longer be trusted either.
                      </p>
                    ) : null}
                  </div>

                  <button
                    onClick={() => setTampered(isTampered ? null : i)}
                    className={cx(
                      'shrink-0 rounded-[3px] border px-2 py-1 text-[10.5px] font-medium transition-colors',
                      isTampered
                        ? 'border-hairline-2 bg-raised-2 text-ink-2 hover:bg-raised-3'
                        : 'border-fault/40 bg-fault-bg text-fault hover:brightness-125',
                    )}
                  >
                    {isTampered ? 'Undo' : 'Rewrite it'}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ------------------------------- the verdict ---------------------------- */}
      <div className="flex flex-col gap-3">
        <div
          className={cx(
            'rounded-[6px] border px-4 py-3.5',
            sealing
              ? 'border-hairline bg-panel'
              : broken
                ? 'border-fault/40 bg-fault-bg'
                : 'border-seal/40 bg-seal-bg',
          )}
        >
          <p
            className={cx(
              'evidence text-[12.5px] font-semibold tracking-[0.06em]',
              sealing ? 'text-ink-3' : broken ? 'text-fault' : 'text-seal',
            )}
          >
            {sealing ? 'COMPUTING…' : broken ? 'TAMPERING DETECTED' : 'LEDGER INTACT'}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
            {sealing
              ? 'Hashing three records into a chain with the Web Crypto API.'
              : broken
                ? `Record #${verdict!.brokenAt} does not hash to the value it was sealed with. Every record after it is now unverifiable, whether or not anybody touched it.`
                : 'Every record hashes to the value it was sealed with, and each points at the one before it.'}
          </p>
        </div>

        <div className="panel milled p-4">
          <div className="legend mb-2">Head</div>
          <p className="evidence text-[11px] leading-relaxed break-all text-ink-2">
            {verdict?.head ?? GENESIS_HASH}
          </p>
          <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-4">
            Keep this hash somewhere we cannot reach — a wiki, an email to yourself, an auditor&rsquo;s file. Any
            future edit to any record above changes it, and you will be able to tell without trusting us about
            anything.
          </p>
        </div>

        <div className="panel milled p-4 text-[11.5px] leading-relaxed text-ink-2">
          <p>
            This does not make the ledger unforgeable — anyone who can rewrite the file can recompute the whole
            chain. What it makes is <span className="text-ink">tampering visible</span> to anyone holding an older
            copy of a single hash.
          </p>
          <p className="mt-2.5 text-ink-3">
            That is the property that actually matters, because the person auditing you is not the person who
            edited it.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChainRow({ label, value, tone }: { label: string; value: string; tone: 'dim' | 'ok' | 'fault' }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="evidence w-[42px] shrink-0 text-[9.5px] text-ink-4">{label}</dt>
      <dd
        className={cx(
          'evidence min-w-0 flex-1 truncate text-[10px]',
          tone === 'fault' ? 'text-fault' : tone === 'ok' ? 'text-ink-2' : 'text-ink-4',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

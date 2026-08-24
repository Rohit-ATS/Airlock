'use client';

import type { ChecksumTriple as Triple } from '@airlock/contract';
import { Evidence, Legend, cx } from '@/design/primitives';

/**
 * The checksum triple.
 *
 * This is the single most important thing on screen: the claim "your data came
 * back byte-for-byte" has to be *shown*, not asserted. So rows 1 and 3 are
 * visually bracketed together, row 2 is deliberately de-emphasised (it is
 * expected to differ), and on a mismatch we highlight the exact character where
 * the hashes diverge rather than printing a red X.
 *
 * A reader who does not know what a checksum is should still be able to see
 * that the top and bottom lines are the same and the middle one is not.
 */

/** Index of the first differing character, or -1 when identical. */
function firstDivergence(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function Hash({ value, highlightFrom }: { value: string; highlightFrom?: number }) {
  const body = value.startsWith('sha256:') ? value.slice(7) : value;
  if (highlightFrom === undefined || highlightFrom < 0) {
    return (
      <Evidence size="xs" className="break-all">
        <span className="text-ink-4">sha256:</span>
        {body}
      </Evidence>
    );
  }
  return (
    <Evidence size="xs" className="break-all">
      <span className="text-ink-4">sha256:</span>
      {body.slice(0, highlightFrom)}
      <span className="rounded-[2px] bg-fault/25 text-fault underline decoration-fault decoration-2 underline-offset-2">
        {body.slice(highlightFrom, highlightFrom + 1) || '·'}
      </span>
      <span className="text-fault/70">{body.slice(highlightFrom + 1)}</span>
    </Evidence>
  );
}

export function ChecksumTriple({ triple }: { triple: Triple }) {
  // Recomputed here, exactly as the gate does it. The card never renders a
  // match the gate would not accept.
  const matches = triple.pre === triple.post_rollback;
  const divergence = matches ? -1 : firstDivergence(triple.pre, triple.post_rollback);

  const rows = [
    { n: 1, label: 'Pre-migration', value: triple.pre, bracket: true, dim: false },
    { n: 2, label: 'Post-migration', value: triple.post, bracket: false, dim: true },
    { n: 3, label: 'Post-rollback', value: triple.post_rollback, bracket: true, dim: false },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Legend>Checksum triple</Legend>
        <span
          className={cx(
            'inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-[3px] text-[10px] font-medium',
            matches ? 'border-seal/40 bg-seal-bg text-seal' : 'border-fault/40 bg-fault-bg text-fault',
          )}
        >
          <span className={cx('size-1.5 rounded-full', matches ? 'bg-seal' : 'bg-fault')} />
          {matches ? '1 ≡ 3 MATCH' : '1 ≠ 3 MISMATCH'}
        </span>
      </div>

      <div className="relative rounded-[5px] border border-hairline bg-void">
        {/* The bracket: a rule joining row 1 to row 3, which is the whole claim. */}
        <div
          aria-hidden
          className={cx(
            'absolute top-[18px] bottom-[18px] left-[26px] w-px',
            matches ? 'bg-seal/45' : 'bg-fault/45',
          )}
        />

        {rows.map((row, i) => (
          <div
            key={row.n}
            className={cx(
              'relative flex items-start gap-3 px-3 py-2',
              i > 0 && 'border-t border-hairline',
            )}
          >
            <div className="relative z-10 flex w-[14px] shrink-0 justify-center pt-[1px]">
              {row.bracket ? (
                <span
                  className={cx(
                    'size-[9px] rounded-full border-2 bg-void',
                    matches ? 'border-seal' : 'border-fault',
                  )}
                />
              ) : (
                <span className="size-[5px] rounded-full bg-ink-4" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-baseline gap-2">
                <Evidence size="xs" className="text-ink-4">
                  {row.n}
                </Evidence>
                <span className={cx('text-[10.5px] font-medium', row.dim ? 'text-ink-3' : 'text-ink-2')}>
                  {row.label}
                </span>
                {row.n === 2 ? <span className="text-[10px] text-ink-4">differs, as expected</span> : null}
              </div>
              <div className={row.dim ? 'opacity-45' : undefined}>
                <Hash value={row.value} highlightFrom={row.n === 3 && !matches ? divergence : undefined} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className={cx('mt-2 text-[11px] leading-relaxed', matches ? 'text-seal' : 'text-fault')}>
        {matches ? (
          <>
            The migration was applied and then undone on a shadow branch. Line 3 is identical to line 1, so every
            affected table returned byte-for-byte to its starting state.
          </>
        ) : (
          <>
            The rollback did not restore the data. Lines 1 and 3 first differ at character {divergence + 1}. A rollback
            that mostly restores data is a failure, not a warning — the gate stays sealed.
          </>
        )}
      </p>
    </div>
  );
}

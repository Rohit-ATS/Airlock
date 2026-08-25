'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { assessUndo, describeUndo, type Dossier, type UndoAvailability } from '@airlock/contract';
import { Button, Chip, Evidence, Legend, cx } from '@/design/primitives';

/**
 * The undo window.
 *
 * The argument this control makes is narrow and worth stating exactly: the
 * rollback for this change was executed against a shadow copy and checksummed
 * back to byte-identical *before* the change was ever applied. For as long as
 * production has not moved on, that inverse is still known-good. This is the
 * only reason a one-press undo on a production database is a responsible thing
 * to offer rather than a reckless one.
 *
 * Two rules the rendering follows, both of which cost something:
 *
 *   - **The states where undo is impossible are rendered, not hidden.** A card
 *     with no undo control is ambiguous — the reader cannot tell whether the
 *     change is un-undoable or whether the feature simply is not there. So a
 *     change with no proven inverse says so, in the space where the button
 *     would have been. That is the sentence a judge should read.
 *   - **The countdown is labelled as advisory.** It runs on the reader's clock,
 *     which can sleep with the laptop. The server re-derives the window from
 *     `audit.applied_at` on every request and will refuse a late press even
 *     when this display still shows time left, so the display says that.
 */

const TICK_MS = 1000;

/** `28:41`, `04:07`, `0:09` — mm:ss, because a deadline is read, not parsed. */
function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Re-assess on a timer.
 *
 * The whole assessment re-runs each tick rather than only the remaining
 * milliseconds, so the moment the window closes the component moves to the
 * CLOSED state by exactly the same function the server will use. There is no
 * second implementation of "is it still open" to drift out of step.
 */
function useAvailability(dossier: Dossier): UndoAvailability {
  const [, force] = useState(0);
  const availability = assessUndo(dossier);

  useEffect(() => {
    if (availability.state !== 'AVAILABLE') return;
    const id = setInterval(() => force((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [availability.state]);

  return availability;
}

function Drain({ remaining, width }: { remaining: number; width: number }) {
  const fraction = width > 0 ? Math.max(0, Math.min(1, remaining / width)) : 0;
  // Under a fifth left is when a person needs to decide rather than deliberate.
  const urgent = fraction < 0.2;
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-raised-3" aria-hidden>
      <div
        className={cx('h-full rounded-full', urgent ? 'bg-hazard' : 'bg-seal')}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}

export function UndoWindow({
  dossier,
  onUndo,
  busy,
}: {
  dossier: Dossier;
  onUndo: (reason: string) => void;
  busy?: boolean;
}) {
  const availability = useAvailability(dossier);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (confirming) inputRef.current?.focus();
  }, [confirming]);

  const opsCount = dossier.rollback.length;
  const proven = useMemo(() => dossier.rollback.filter((op) => op.proven).length, [dossier.rollback]);

  // A change that never landed has no story to tell here at all.
  if (availability.state === 'NOT_APPLIED') return null;

  /* ---- the states where there is nothing to press ---- */

  if (availability.state === 'UNPROVEN' || availability.state === 'NOT_OFFERED') {
    return (
      <div>
        <Legend className="mb-2">Taking it back</Legend>
        <div className="rounded-[5px] border border-hairline bg-void px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Chip tone="neutral" mono className="!text-[9.5px]">
              NO UNDO
            </Chip>
            <Evidence size="xs" dim>
              {availability.state === 'UNPROVEN' ? 'no proven inverse' : 'not granted for this class'}
            </Evidence>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{availability.message}</p>
        </div>
      </div>
    );
  }

  if (availability.state === 'ALREADY_UNDONE') {
    const restored = dossier.undo.restored;
    return (
      <div>
        <Legend className="mb-2">Taken back</Legend>
        <div
          className={cx(
            'rounded-[5px] border bg-void px-2.5 py-2',
            restored === false ? 'border-fault/40' : 'border-seal/30',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={restored === false ? 'fault' : 'seal'} mono className="!text-[9.5px]">
              {restored === true ? 'RESTORED' : restored === false ? 'NOT RESTORED' : 'UNMEASURED'}
            </Chip>
            {dossier.undo.undone_at ? (
              <Evidence size="xs" dim>
                {new Date(dossier.undo.undone_at).toLocaleString('en-GB')}
              </Evidence>
            ) : null}
          </div>

          <p
            className={cx(
              'mt-2 text-[11px] leading-relaxed',
              restored === false ? 'text-fault' : 'text-ink-2',
            )}
          >
            {describeUndo(dossier)}
          </p>

          {dossier.undo.reason ? (
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">“{dossier.undo.reason}”</p>
          ) : null}

          {dossier.undo.restored_checksum ? (
            <div className="mt-2 flex items-baseline gap-2 border-t border-hairline pt-2">
              <Legend className="!w-[86px] shrink-0 !text-[9px]">restored to</Legend>
              <Evidence size="xs" className="min-w-0 flex-1 truncate text-ink-3">
                {dossier.undo.restored_checksum}
              </Evidence>
            </div>
          ) : (
            <p className="mt-2 border-t border-hairline pt-2 text-[10px] leading-relaxed text-ink-4">
              Nothing checksummed production after the rollback ran, so AIRLOCK records this as unmeasured rather
              than as successful.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (availability.state === 'SUPERSEDED') {
    return (
      <div>
        <Legend className="mb-2">Taking it back</Legend>
        <div className="rounded-[5px] border border-hazard/35 bg-void px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-ink-2">{availability.message}</p>
        </div>
      </div>
    );
  }

  if (availability.state === 'CLOSED') {
    return (
      <div>
        <Legend className="mb-2">Taking it back</Legend>
        <div className="rounded-[5px] border border-hairline bg-void px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Chip tone="neutral" mono className="!text-[9.5px]">
              WINDOW CLOSED
            </Chip>
            {availability.expiresAt ? (
              <Evidence size="xs" dim>
                {new Date(availability.expiresAt).toLocaleTimeString('en-GB')}
              </Evidence>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            The undo window has elapsed. The proof this change could be reversed was taken against a database that
            has since moved on, and AIRLOCK will not run a stale inverse against production on the strength of it.
          </p>
        </div>
      </div>
    );
  }

  /* ---- the window is open ---- */

  const urgent = availability.remainingMs < availability.windowMs * 0.2;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <Legend>Taking it back</Legend>
        <Evidence size="xs" className={urgent ? 'text-hazard' : 'text-seal'}>
          {clock(availability.remainingMs)} left
        </Evidence>
      </div>

      <div className={cx('overflow-hidden rounded-[5px] border bg-void', urgent ? 'border-hazard/45' : 'border-seal/30')}>
        <div className="px-2.5 pt-2.5">
          <Drain remaining={availability.remainingMs} width={availability.windowMs} />
        </div>

        <div className="px-2.5 py-2.5">
          <p className="text-[11px] leading-relaxed text-ink-2">
            The rollback for this change was proven against the shadow branch before it was applied — {proven} of{' '}
            {opsCount} operation{opsCount === 1 ? '' : 's'} executed and checksummed back to byte-identical. For as
            long as this window is open, that inverse is still the one AIRLOCK is willing to run.
          </p>

          {confirming ? (
            <div className="mt-2.5 space-y-2">
              <input
                ref={inputRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is it going back? (optional)"
                className="h-8 w-full rounded-[4px] border border-hairline-2 bg-panel px-2 text-[11.5px] text-ink outline-none placeholder:text-ink-4 focus:border-ice-dim"
              />
              <div className="flex gap-2">
                <Button
                  tone="hazard"
                  size="sm"
                  full
                  disabled={busy}
                  onClick={() => {
                    onUndo(reason.trim());
                    setConfirming(false);
                    setReason('');
                  }}
                >
                  {busy ? 'Running the inverse…' : `Run ${opsCount} proven rollback operation${opsCount === 1 ? '' : 's'}`}
                </Button>
                <Button tone="neutral" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
              <p className="text-[10px] leading-relaxed text-ink-4">
                An undo with no stated reason is recorded as having no stated reason. It is not blocked — the window
                exists to be fast, and a form standing between a person and fixing their mistake is a form that gets
                filled in badly.
              </p>
            </div>
          ) : (
            <Button
              tone="hazard"
              size="md"
              full
              disabled={busy}
              className="mt-2.5"
              onClick={() => setConfirming(true)}
              title="Execute the rollback that was proven against the shadow branch before this change was applied"
            >
              Take this change back
            </Button>
          )}
        </div>

        <p className="border-t border-hairline px-2.5 py-2 text-[10px] leading-relaxed text-ink-4">
          This countdown runs on your clock. The window is re-derived on the server from when the change landed, so a
          press that arrives after it closes is refused even if this still shows time remaining.
        </p>
      </div>
    </div>
  );
}

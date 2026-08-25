'use client';

import { useState } from 'react';
import {
  KIND_COPY,
  SOURCE_COPY,
  assessQuarantine,
  type Dossier,
  type InjectionFinding,
} from '@airlock/contract';
import { Button, Chip, Evidence, Legend, cx } from '@/design/primitives';

/**
 * What the agent read that somebody else wrote.
 *
 * This block exists because the alternative — filtering the content and
 * carrying on — teaches nobody that they are under attack. A system that
 * quietly sanitises an injection produces a clean-looking change and an
 * operator who never learns their `users.bio` column is being used as a command
 * channel.
 *
 * Two rendering decisions worth defending:
 *
 *   - **The payload is shown, neutralised.** Hiding it would make the finding
 *     unarguable, and the person deciding whether this is an attack or a
 *     marketing quote about prompt injection needs to read the words. What they
 *     see has had its zero-width characters made visible and its newlines
 *     flattened, because those are exactly the properties an attacker was
 *     relying on.
 *   - **Clearing demands a written reason.** Unlike the undo window, speed is
 *     not the priority here. Undo is the safe direction; dismissing a security
 *     finding is the dangerous one, and the friction is the point.
 */

/** Long enough that "ok" is not a reason, short enough that a real one fits. */
export const MIN_CLEAR_REASON = 20;

function KindChip({ kind }: { kind: InjectionFinding['kind'] }) {
  const tone =
    kind === 'TOOL_COERCION' || kind === 'EXFILTRATION' ? 'fault' : kind === 'OBFUSCATION' ? 'neutral' : 'hazard';
  return (
    <Chip tone={tone} mono className="!text-[9px]" title={KIND_COPY[kind]}>
      {kind.replace(/_/g, ' ').toLowerCase()}
    </Chip>
  );
}

function FindingRow({ finding }: { finding: InjectionFinding }) {
  return (
    <div className="border-t border-hairline px-2.5 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <KindChip kind={finding.kind} />
        <Evidence size="xs" className="text-ink-2">
          {finding.locator}
        </Evidence>
        <span className="text-[10px] text-ink-4">rule: {finding.rule}</span>
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">{SOURCE_COPY[finding.source]}</p>
      {/* Neutralised at the point it was recorded, never the raw payload. */}
      <Evidence
        size="xs"
        className="mt-1.5 block rounded-[3px] border border-fault/25 bg-fault-bg/30 px-2 py-1.5 leading-relaxed break-words whitespace-pre-wrap text-ink-2"
      >
        {finding.excerpt}
      </Evidence>
    </div>
  );
}

export function QuarantineBlock({
  dossier,
  canClear,
  onClear,
  busy,
}: {
  dossier: Dossier;
  canClear?: boolean;
  onClear?: (reason: string) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const u = dossier.untrusted;
  const verdict = assessQuarantine(u.findings);

  // A change that read nothing untrusted says nothing. Rendering "0 findings"
  // on every card would train people to skip the block that matters.
  if (u.findings.length === 0) return null;

  const cleared = u.cleared_at !== null;
  const enough = reason.trim().length >= MIN_CLEAR_REASON;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <Legend className={cleared ? undefined : '!text-fault'}>Untrusted content</Legend>
        <Evidence size="xs" className={cleared ? 'text-ink-3' : 'text-fault'}>
          {u.findings.length} finding{u.findings.length === 1 ? '' : 's'}
          {u.scanned > 0 ? ` in ${u.scanned.toLocaleString('en-GB')} scanned` : ''}
        </Evidence>
      </div>

      <div className={cx('overflow-hidden rounded-[5px] border bg-void', cleared ? 'border-hairline' : 'border-fault/40')}>
        <p className={cx('px-2.5 py-2 text-[11px] leading-relaxed', cleared ? 'text-ink-2' : 'text-fault')}>
          {verdict.message}
        </p>

        <div className="border-t border-hairline px-2.5 py-2">
          <p className="text-[10.5px] leading-relaxed text-ink-3">
            Nothing was executed. The agent has no tool that writes to production, so the most an injection can
            achieve is composing a request that a human then reads — which is the architecture working, not a lucky
            outcome. What it changes is that this change was <em>chosen</em> while the agent was being lied to, so
            the proof attached to it is proving the wrong thing correctly.
          </p>
        </div>

        <div className="border-t border-hairline">
          {u.findings.map((f, i) => (
            <FindingRow key={`${f.locator}-${f.rule}-${i}`} finding={f} />
          ))}
        </div>

        {cleared ? (
          <div className="border-t border-hairline bg-panel px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="neutral" mono className="!text-[9px]">
                CLEARED
              </Chip>
              <Evidence size="xs" className="text-ink-2">
                {u.cleared_by}
              </Evidence>
              {u.cleared_at ? (
                <Evidence size="xs" dim>
                  {new Date(u.cleared_at).toLocaleString('en-GB')}
                </Evidence>
              ) : null}
            </div>
            {u.cleared_reason ? (
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">“{u.cleared_reason}”</p>
            ) : null}
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-4">
              The findings above are kept. Clearing dismisses them; it does not erase them, and this record is sealed
              into the ledger with the rest of the change.
            </p>
          </div>
        ) : canClear ? (
          <div className="border-t border-hairline bg-panel px-2.5 py-2">
            {open ? (
              <div className="space-y-2">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Why is this not an attack? This is recorded permanently."
                  className="w-full resize-none rounded-[4px] border border-hairline-2 bg-void px-2 py-1.5 text-[11.5px] leading-relaxed text-ink outline-none placeholder:text-ink-4 focus:border-ice-dim"
                />
                <div className="flex items-center gap-2">
                  <Button
                    tone="hazard"
                    size="sm"
                    disabled={!enough || busy}
                    onClick={() => {
                      onClear?.(reason.trim());
                      setOpen(false);
                      setReason('');
                    }}
                  >
                    Clear these findings
                  </Button>
                  <Button tone="neutral" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <span className="text-[10px] text-ink-4">
                    {enough ? 'recorded against your name' : `${MIN_CLEAR_REASON - reason.trim().length} more characters`}
                  </span>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setOpen(true)}
                className="text-[11px] text-ink-3 transition-colors hover:text-ink"
              >
                These are false positives — clear them
              </button>
            )}
          </div>
        ) : (
          <p className="border-t border-hairline bg-panel px-2.5 py-2 text-[10px] leading-relaxed text-ink-4">
            An approver can clear these findings with a written reason if they are false positives. Until then the
            gate stays sealed.
          </p>
        )}
      </div>
    </div>
  );
}

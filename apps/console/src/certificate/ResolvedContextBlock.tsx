'use client';

/**
 * What the agent looked up, and where each answer came from.
 *
 * The panel exists because "the agent filled the form in for you" is a claim,
 * and a claim about an irreversible change has to be inspectable or it is
 * worth nothing. So no value renders without its address next to it: not
 * "Stripe" but `acct_1Nx…`, not "the database" but `users.country_code`. A
 * logo is not provenance.
 *
 * Three states, and the third is the one that makes the other two believable:
 *
 *   RESOLVED   — one answer, and here is the system and the row it came from.
 *   ASKING     — more than one candidate, so a human is being asked, WITH the
 *                candidates shown. An ambiguous fact is never quietly picked.
 *   UNRESOLVED — nothing found. Rendered in the fault colour rather than left
 *                blank, because a blank field reads as "not needed".
 *
 * A panel that only ever showed the green rows would be marketing. The whole
 * value of it is that a judge can see the one that failed.
 */
import type { Dossier } from '@airlock/contract';
import { describeResolution, summariseResolution } from '@airlock/contract';
import { Legend } from '@/design/primitives';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/**
 * The chip for one fact.
 *
 * Laid out as a fixed grid rather than inline text so the values form a column
 * a reader can scan down. Provenance sits in the same row as the value it
 * belongs to, because a source list somewhere else on the page is a source list
 * nobody joins up.
 */
function FactRow({ fact }: { fact: Dossier['resolved_context']['facts'][number] }) {
  const asking = fact.status === 'AMBIGUOUS';
  const missing = fact.status === 'UNRESOLVED';

  return (
    <li
      className={cx(
        'grid grid-cols-[9rem_1fr] items-start gap-x-3 gap-y-1 border-t border-hairline px-1 py-2 first:border-t-0',
        'sm:grid-cols-[10rem_10rem_1fr]',
      )}
    >
      <span className="legend pt-0.5">{fact.label}</span>

      <span
        className={cx(
          'evidence text-[12px] leading-tight font-medium',
          asking && 'text-hazard',
          missing && 'text-fault',
          !asking && !missing && 'text-ink',
        )}
      >
        {asking ? `${fact.candidates.length} matches` : missing ? 'not found' : fact.value}
      </span>

      <span className="col-span-2 text-[11px] leading-relaxed text-ink-3 sm:col-span-1">
        {asking ? (
          <>
            <span className="text-hazard">asking — </span>
            {/* The candidates are shown here rather than only in the question,
                so the reason a human is being interrupted is visible from the
                card without opening anything. */}
            <span className="evidence text-ink-2">{fact.candidates.join(' · ')}</span>
          </>
        ) : missing ? (
          <span className="text-fault">
            nothing in {fact.system} answered for {fact.locator}
          </span>
        ) : (
          <>
            <span className="text-ink-4">←</span>{' '}
            <span className="evidence text-ink-2">{fact.system}</span>
            <span className="text-ink-4"> · </span>
            <span className="evidence">{fact.locator}</span>
            {fact.trust === 'USER_WRITABLE' ? (
              <span
                className="ml-2 rounded-[3px] border border-hazard/40 px-1 py-px text-[9.5px] tracking-[0.08em] text-hazard uppercase"
                title="This value came out of a field a person can type into. It was scanned for injection before it was stored."
              >
                user-writable
              </span>
            ) : null}
          </>
        )}
      </span>
    </li>
  );
}

export function ResolvedContextBlock({ dossier }: { dossier: Dossier }) {
  const context = dossier.resolved_context;
  const facts = context?.facts ?? [];

  // A change with nothing to look up renders nothing at all, rather than an
  // empty panel reading "0 of 0". Absence of a section is honest; a section
  // reporting nothing looks like a failure.
  if (facts.length === 0) return null;

  const summary = summariseResolution(context);
  const pinned = dossier.certificate?.context_fingerprint ?? null;
  const recheck = context?.recheck_fingerprint ?? null;
  const drifted = Boolean(pinned && recheck && pinned !== recheck);
  const unverified = Boolean(pinned && !recheck);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Legend>What the agent looked up instead of asking you</Legend>
        <span
          className={cx(
            'evidence text-[10.5px]',
            summary.asking > 0 || summary.missing > 0 ? 'text-hazard' : 'text-ink-3',
          )}
        >
          {describeResolution(context)}
        </span>
      </div>

      <ul className="rounded-[5px] border border-hairline bg-raised/40 px-2 py-1">
        {facts.map((fact) => (
          <FactRow key={fact.field} fact={fact} />
        ))}
      </ul>

      {/* The pin. This is the part that makes the panel a safety control rather
          than a convenience: the facts above are inside what the certificate
          certifies, and they are compared again before anyone is asked. */}
      {pinned ? (
        <p
          className={cx(
            'evidence mt-2 text-[10.5px] leading-relaxed',
            drifted || unverified ? 'text-fault' : 'text-ink-3',
          )}
        >
          {drifted ? (
            <>
              PINNED {pinned.slice(7, 19)}… · RE-CHECKED {recheck?.slice(7, 19)}… — a fact moved after the proof was
              taken, so the gate is sealed.
            </>
          ) : unverified ? (
            <>PINNED {pinned.slice(7, 19)}… · never re-checked — an absent check is not a passed check.</>
          ) : (
            <>
              PINNED {pinned.slice(7, 19)}… into the certificate, and re-checked identical before the gate. These facts
              are part of what was proven.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

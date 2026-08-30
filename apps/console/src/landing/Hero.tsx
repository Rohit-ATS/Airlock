'use client';

import Link from 'next/link';
import { cx } from '@/design/primitives';
import { Nav, Reveal } from './Rise';

/**
 * The hero: the question, and why it is the wrong question.
 *
 * WHAT THIS REPLACED, AND WHY
 *
 * The first version of this page was built from a visual reference — a centre
 * object with cartoon props drifting around it, a giant pixel wordmark behind,
 * four staggered display lines. It was executed carefully and it was the wrong
 * argument, in three ways that a screenshot makes obvious:
 *
 *   - The object was an illustrated retro computer orbited by a smiley face, a
 *     camera and an envelope. This product's claim is that you can hand it a
 *     production database. Emoji do not survive contact with that claim; the
 *     tone said "toy" while the copy said "root access".
 *   - The wordmark sat in white pixel letters on light grey, at 1.2:1 against
 *     its own background, and collided with the object. It read as texture.
 *   - Nothing above the fold said what AIRLOCK *is*. "Proving every irreversible
 *     change first" is a description of a feeling. A reader who does not already
 *     know what a shadow copy is learns nothing before deciding to scroll.
 *
 * So the hero is now the product's actual argument, made with the product's
 * actual output. Two panels: the request as every other approval flow presents
 * it, and the same request after AIRLOCK has run it.
 *
 * THE DIGESTS ARE REAL
 *
 * They are the sha256 triple from dropping `users.plan_name` against a shadow
 * copy of the 100,000-row demo table — the run `npm run demo` performs in Act 1.
 * That matters here more than it would on most pages: this is a project whose
 * entire pitch is that numbers on screen were measured rather than composed, and
 * a hero illustrated with `sha256:aaaa…` would be the one place it quietly was
 * not. Re-measure with `npm run demo` and these three lines are what comes back.
 *
 * THE EMPTY SLOT IS THE POINT
 *
 * The right panel has a deliberate gap where an approve control would be, and it
 * is drawn — a dashed outline with a caption — rather than merely absent. An
 * absence nobody notices makes no argument. This is the same claim the README
 * makes in type: `certificate.status !== "PROVEN"` means the gate is never
 * offered, because `ApprovalGrant` carries a symbol only `openGate` can mint.
 */

/** Act 1 of `npm run demo`, verbatim. See the note above before editing these. */
const DIGESTS = {
  pre: 'd2f21cbcb608ed22ac13e1e944e929d0c40f6be4c719e328eaeba98f3d350d21',
  post: '62dd725050452f1b9bd9bd32c9f08a6a4d6b494310921a03584486a6ede4cc83',
  rollback: 'ad8449f8165a8679dcc7ff29e50fa169fb247197fdcebf9acae8b97f682ecfc4',
} as const;

const short = (hex: string) => `sha256:${hex.slice(0, 16)}…${hex.slice(-6)}`;

export function Hero() {
  return (
    <div id="top" className="p-4 sm:p-7">
      <div className="lp-card lp-atmos lp-glow lp-lit relative flex min-h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
        <div className="lp-grid-layer" aria-hidden />
        <Nav />

        <div className="grid gap-10 px-6 pt-10 pb-16 sm:px-10 lg:grid-cols-12 lg:gap-9 lg:px-12 lg:pt-14 lg:pb-20">
          {/* ---- the argument, in words ---------------------------------- */}
          <div className="lg:col-span-5 lg:pt-6">
            <Reveal>
              <div>
                <p className="lp-mono inline-flex items-center gap-2 rounded-full border border-[var(--lp-line-2)] bg-[var(--lp-raised)] px-3 py-1.5 text-[11px] tracking-[0.12em] text-[var(--lp-ink-2)] uppercase">
                  <span className="size-1.5 rounded-full bg-[var(--lp-signal)]" aria-hidden />
                  Change control for agents with production access
                </p>

                <h1 className="lp-display mt-5 text-[clamp(2.6rem,4.9vw,4.2rem)] text-[var(--lp-ink)]">
                  <span className="block">&ldquo;Approve?&rdquo;</span>
                  <span className="block">is the wrong</span>
                  <span className="block">question.</span>
                </h1>

                <p className="mt-8 max-w-[44ch] text-[16.5px] leading-[1.6] text-[var(--lp-ink-2)]">
                  An agent asks to drop a column on a hundred thousand rows. Nobody can answer that honestly —
                  not without knowing whether the rollback actually works.
                </p>
                <p className="mt-4 max-w-[44ch] text-[16.5px] leading-[1.6] text-[var(--lp-ink-2)]">
                  So AIRLOCK does not ask it. It runs the change against a copy of your database, undoes it, and
                  checksums all three states. <span className="text-[var(--lp-ink)]">The gate opens only if the
                  data came back.</span>
                </p>

                <div className="mt-9 flex flex-wrap gap-3.5">
                  <Link
                    href="/console"
                    className="rounded-[8px] bg-[var(--lp-signal)] px-7 py-3 text-[15px] font-semibold text-[var(--color-void)] transition-[filter] hover:brightness-110"
                  >
                    Open the console
                  </Link>
                  <a
                    href="#gate"
                    className="rounded-[8px] border border-[var(--lp-line-2)] px-7 py-3 text-[15px] font-medium text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-raised-2)]"
                  >
                    Try to break the gate
                  </a>
                </div>

                <p className="lp-mono mt-6 text-[12.5px] text-[var(--lp-ink-2)]">
                  npm run demo
                  <span className="ml-2 text-[var(--lp-ink-2)] opacity-70">— three real changes, ~90s</span>
                </p>
              </div>
            </Reveal>
          </div>

          {/* ---- the same argument, as the product's own output ---------- */}
          <div className="lg:col-span-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <Reveal delay={90} className="h-full">
                <Panel
                  kicker="Every other approval flow"
                  tone="plain"
                  caption="You are being asked to trust a plan. Nothing on this screen tells you whether the rollback works."
                >
                  <Request />

                  {/*
                    The same slot the right panel fills with three digests, and it
                    is empty on purpose. Equal-height panels left a ~90px hole here
                    and the hole was the most interesting thing about the panel, so
                    it now says what it is: this is the evidence you are deciding
                    without.
                  */}
                  <dl className="mt-4 space-y-2.5">
                    <Missing label="certificate" />
                    <Missing label="rollback proof" />
                    <Missing label="blast radius" />
                  </dl>

                  <div className="mt-4 flex gap-2">
                    {/* Spans, not buttons: this is a depiction of someone else's
                        UI, and a focusable control that does nothing is a worse
                        lie than a picture of one. */}
                    <span className="flex-1 rounded-[6px] bg-[var(--lp-proven-bg)] px-3 py-2 text-center text-[12.5px] font-medium text-[var(--lp-proven)]">
                      Approve
                    </span>
                    <span className="rounded-[6px] border border-[var(--lp-line-2)] px-3 py-2 text-center text-[12.5px] text-[var(--lp-pale-2)]">
                      Reject
                    </span>
                  </div>
                </Panel>
              </Reveal>

              <Reveal delay={190} className="h-full">
                <Panel
                  kicker="AIRLOCK"
                  tone="signal"
                  verdict={
                    <span className="lp-mono rounded-[3px] border border-[var(--lp-sealed)]/40 bg-[var(--lp-sealed-bg)] px-1.5 py-[2px] text-[9.5px] tracking-[0.08em] text-[var(--lp-sealed)] uppercase">
                      gate sealed
                    </span>
                  }
                  caption="Line 3 is not line 1. The column came back; the hundred thousand values in it did not."
                >
                  <p className="text-[12.5px] leading-[1.5] text-[var(--lp-pale-2)]">
                    Ran it against a copy of the real rows. Then ran the rollback.
                  </p>

                  <dl className="mt-4 space-y-2.5">
                    <Digest label="pre" value={short(DIGESTS.pre)} />
                    <Digest label="post" value={short(DIGESTS.post)} dim />
                    <Digest label="post-rollback" value={short(DIGESTS.rollback)} bad />
                  </dl>

                  {/* The absence, drawn. */}
                  <div className="mt-4 rounded-[6px] border border-dashed border-[var(--lp-line-3)] px-3 py-3 text-center">
                    <p className="lp-mono text-[10.5px] tracking-[0.1em] text-[var(--lp-pale-3)] uppercase">
                      no approval control exists
                    </p>
                  </div>
                </Panel>
              </Reveal>
            </div>

            <Reveal delay={280}>
              <p className="mt-4 text-[13.5px] leading-[1.5] text-[var(--lp-ink-2)]">
                Not greyed out — <span className="text-[var(--lp-ink)]">never rendered.</span> The value that would
                represent permission cannot be constructed, so the agent has nothing to offer a human and nobody is
                interrupted about a change that cannot be undone.
              </p>
            </Reveal>

            {/*
              The pipeline, compressed to one line.

              This column ran out of content two thirds of the way down and left
              a 240px hole under the panels — the second most expensive empty
              space on the page after the one at the foot of the plate. It is
              also the one question the two panels above do not answer: they
              show the before and the after, and say nothing about who does
              what in between. Three steps, and the third is a person.
            */}
            <Reveal delay={340}>
              <ol className="mt-8 grid gap-px overflow-hidden rounded-[8px] border border-[var(--lp-line)] bg-[var(--lp-line)] sm:grid-cols-3">
                {FLOW.map((step) => (
                  <li key={step.n} className="bg-[var(--lp-raised)] px-4 py-4">
                    <div className="flex items-baseline gap-2.5">
                      <span className="lp-mono text-[11px] text-[var(--lp-signal)]">{step.n}</span>
                      <span className="text-[13px] font-semibold text-[var(--lp-ink)]">{step.title}</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-[1.45] text-[var(--lp-ink-3)]">{step.body}</p>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </div>

        {/* ---- right rail ------------------------------------------------ */}
        <div className="lp-rail absolute top-1/2 right-0 z-40 hidden -translate-y-1/2 flex-col gap-1 p-2 xl:flex">
          {RAIL.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target={s.href.startsWith('http') ? '_blank' : undefined}
              rel={s.href.startsWith('http') ? 'noreferrer' : undefined}
              title={s.label}
              aria-label={s.label}
              className={cx(
                'grid size-11 place-items-center rounded-[10px] text-[#f5f5f5]',
                'transition-colors hover:bg-white/25',
              )}
            >
              <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d={s.d} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ))}
        </div>

        {/*
          The base of the plate.

          There was ~180px of nothing here, which on the tallest element of the
          page is the most expensive empty space available. Four figures fill
          it, and they are the four this project can actually defend: the test
          count and the capability count are asserted by `verify-claims.mjs`
          against the README badge, the write-path count is enforced by
          `check-agents.mjs`, and the row count is what `seed:supabase --check`
          reports. A hero stat that nothing checks is the one thing this page
          cannot afford.
        */}
        <div className="mt-auto grid grid-cols-2 border-t border-[var(--lp-line)] md:grid-cols-4">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={cx(
                'px-6 py-5 sm:px-8',
                i > 0 && 'border-l border-[var(--lp-line)]',
                i === 2 && 'border-l-0 md:border-l',
                i >= 2 && 'border-t border-[var(--lp-line)] md:border-t-0',
              )}
            >
              <div
                className={cx(
                  'lp-mono text-[clamp(1.3rem,2.2vw,1.75rem)] leading-none',
                  s.tone === 'proven' ? 'text-[var(--lp-proven)]' : 'text-[var(--lp-ink)]',
                )}
              >
                {s.value}
              </div>
              <div className="lp-legend mt-2.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ---- the scroll cue -------------------------------------------- */}
        <div className="flex justify-center pb-8">
          <a
            href="#rule"
            className="lp-legend flex items-center gap-2 text-[var(--lp-ink-3)] transition-colors hover:text-[var(--lp-ink)]"
          >
            <svg width="13" height="19" viewBox="0 0 16 24" fill="none" aria-hidden>
              <rect x="0.85" y="0.85" width="14.3" height="22.3" rx="7.15" stroke="currentColor" strokeWidth="1.4" />
              <rect x="7.1" y="5" width="1.8" height="5" rx="0.9" fill="currentColor" />
            </svg>
            the rule
          </a>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One of the two hero panels.
 *
 * Both are dark on a light plate, which is the same signal the `#gate` and
 * `#ledger` bands use further down the page: you have stopped reading about the
 * product and started looking at its output.
 */
function Panel({
  kicker,
  tone,
  verdict,
  caption,
  children,
}: {
  kicker: string;
  tone: 'plain' | 'signal';
  verdict?: React.ReactNode;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <article className="lp-lit flex h-full flex-col rounded-[10px] border border-[var(--lp-line)] bg-[var(--lp-raised)] p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p
          className={cx(
            'lp-mono text-[10.5px] tracking-[0.13em] uppercase',
            tone === 'signal' ? 'text-[var(--lp-signal)]' : 'text-[var(--lp-pale-3)]',
          )}
        >
          {kicker}
        </p>
        {verdict}
      </div>

      <div className="mt-3.5 flex-1">{children}</div>

      <p className="mt-4 border-t border-[var(--lp-line)] pt-3 text-[11.5px] leading-[1.45] text-[var(--lp-pale-3)]">
        {caption}
      </p>
    </article>
  );
}

/** The change itself, worded the way an agent would put it. */
function Request() {
  return (
    <div>
      <p className="text-[12.5px] leading-[1.5] text-[var(--lp-pale-2)]">The agent wants to:</p>
      <p className="lp-mono mt-2 rounded-[5px] border border-[var(--lp-line)] bg-[var(--lp-void)] px-2.5 py-2 text-[11.5px] leading-[1.5] text-[var(--lp-pale)]">
        alter table users
        <br />
        drop column plan_name
      </p>
      <p className="lp-mono mt-2.5 text-[11.5px] text-[var(--lp-pale-3)]">100,000 rows &middot; 1 dependent index</p>
    </div>
  );
}

/**
 * One line of the checksum triple.
 *
 * Label above value rather than beside it. Side by side, a 26-character digest
 * and its label compete for a 330px column and the digest ends up truncated
 * mid-hash — which on this page of all pages reads as a number too long to be
 * bothered with, rather than as the measurement the whole argument rests on.
 */
function Digest({ label, value, dim, bad }: { label: string; value: string; dim?: boolean; bad?: boolean }) {
  return (
    <div>
      <dt className="lp-mono flex items-baseline gap-2 text-[10px] tracking-[0.1em] text-[var(--lp-pale-3)] uppercase">
        {label}
        {bad ? <span className="text-[var(--lp-sealed)] normal-case">— not line 1</span> : null}
      </dt>
      <dd
        className={cx(
          'lp-mono mt-0.5 text-[11.5px] leading-none',
          bad ? 'text-[var(--lp-sealed)]' : dim ? 'text-[var(--lp-pale-3)]' : 'text-[var(--lp-pale)]',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** A row of evidence that was never produced. The counterpart to `Digest`. */
function Missing({ label }: { label: string }) {
  return (
    <div>
      <dt className="lp-mono text-[10px] tracking-[0.1em] text-[var(--lp-pale-3)] uppercase">{label}</dt>
      {/*
        #7c828d, not the dimmer grey this started as. `check:a11y` measured that
        one at 3.12:1 on the panel's near-black and failed the build, which is the
        guard working: "absent" still has to be legible, or the panel makes its
        argument only to people with good monitors. This clears 4.99:1 and stays
        visibly quieter than the digests opposite.
      */}
      <dd className="lp-mono mt-0.5 text-[11.5px] leading-none text-[var(--lp-ink-3)]">— not attached</dd>
    </div>
  );
}

/** Four figures, each checked by something in `npm test`. See the note above. */
/** The three steps, and the fact that the last one is not the agent. */
const FLOW = [
  { n: '01', title: 'The agent opens', body: 'Writes the change and its inverse. No certificate yet, so the gate is shut by default.' },
  { n: '02', title: 'AIRLOCK proves', body: 'Runs it on a copy of the real rows, runs the rollback, checksums all three states.' },
  { n: '03', title: 'A human decides', body: 'Only reachable from a passing proof. The agent has no tool that applies anything.' },
];

const STATS = [
  { value: '0', label: 'tools that write to production', tone: 'proven' as const },
  { value: '1,000,000', label: 'rows the demo proves against', tone: 'ink' as const },
  { value: '345', label: 'tests', tone: 'ink' as const },
  { value: '23', label: 'harness capabilities', tone: 'ink' as const },
];

const RAIL = [
  {
    label: 'Repository',
    href: 'https://github.com/Rohit-ATS/Airlock',
    d: 'M8 .6a7.4 7.4 0 0 0-2.34 14.43c.37.07.5-.16.5-.35v-1.28c-2.06.45-2.5-.99-2.5-.99-.34-.86-.82-1.09-.82-1.09-.67-.46.05-.45.05-.45.74.05 1.13.77 1.13.77.66 1.13 1.74.81 2.16.62.07-.48.26-.81.47-1-1.65-.19-3.38-.83-3.38-3.67 0-.81.29-1.48.77-2-.08-.19-.33-.95.07-1.98 0 0 .63-.2 2.04.76a7 7 0 0 1 3.71 0c1.41-.96 2.03-.76 2.03-.76.4 1.03.15 1.79.07 1.98.48.52.77 1.19.77 2 0 2.85-1.74 3.48-3.39 3.66.27.23.5.68.5 1.38v2.04c0 .2.13.43.5.36A7.4 7.4 0 0 0 8 .6Z',
  },
  { label: 'Operator console', href: '/console', d: 'M2 3.2h12v9.6H2zM4.6 6l2 2-2 2M8.4 10.4H11' },
  { label: 'Control room', href: '/control', d: 'M8 1.6 14 5v6l-6 3.4L2 11V5z' },
];

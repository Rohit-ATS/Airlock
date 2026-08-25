'use client';

import Link from 'next/link';
import { CHANGE_CLASS_COPY, CHANGE_CLASSES, DEFAULT_POLICY, ruleFor } from '@airlock/contract';
import { cx } from '@/design/primitives';
import { Band, Reveal } from './Rise';
import { Wordmark } from './Wordmark';

/**
 * The body of the front door.
 *
 * Every section is full bleed and separated by one hairline. Where the earlier
 * version reached for a bordered card, this reaches for a rule and more space —
 * which is almost always the better trade, and always the cheaper one.
 */

/* -------------------------------------------------------------------------- */
/* Stack marquee                                                               */
/* -------------------------------------------------------------------------- */

const STACK = [
  'TrueForge',
  'AI Gateway',
  'Noma',
  'Qodo',
  'GitHub MCP',
  'Daytona',
  'Supabase',
  'Exa',
  'Bright Data',
  'Together AI',
  'Fireworks',
  'OpenUI',
];

export function Stack() {
  return (
    <section className="px-4 pb-4 sm:px-7 sm:pb-7"><div className="lp-card px-8 py-9 sm:px-12">
      <div className="flex flex-wrap items-baseline gap-x-10 gap-y-4">
        <span className="lp-mono text-[11px] tracking-[0.16em] uppercase text-[var(--lp-ink-2)]">Runs on</span>
        {STACK.map((name) => (
          <span key={name} className="text-[15px] font-medium text-[var(--lp-ink-2)]">
            {name}
          </span>
        ))}
      </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

export function RuleSection() {
  return (
    <Band
      id="rule"
      index="02 / 07"
      label="The rule"
      title={
        <>
          The gate is not a conditional.{' '}
          <span className="italic font-light normal-case tracking-[-0.01em] text-[var(--lp-orange-b)]">It is a type.</span>
        </>
      }
      lede={
        <>
          Every other approval flow is <em className="not-italic text-[var(--lp-ink)]">“the agent says it is going to
          do X — click yes.”</em> That asks a human to trust a plan. AIRLOCK’s gate cannot be offered until the agent
          holds a certificate: the result of having actually done the thing, and undone it, somewhere safe.
        </>
      }
    >
      <Reveal>
        <pre className="overflow-x-auto bg-[var(--lp-void)] p-8 text-[13px] leading-relaxed sm:p-10">
          <code className="evidence">
            <span className="text-[var(--lp-pale-3)]">// packages/contract/src/gate.ts</span>
            {'\n'}
            <span className="text-[#6ea8fe]">const</span> <span className="text-[var(--lp-pale)]">GATE_WITNESS</span>
            <span className="text-[var(--lp-pale-2)]">: </span>
            <span className="text-[#6ea8fe]">unique symbol</span>
            <span className="text-[var(--lp-pale-2)]"> = </span>
            <span className="text-[#5fd3a6]">Symbol</span>
            <span className="text-[var(--lp-pale-2)]">(</span>
            <span className="text-[#f2a054]">&apos;airlock.gate.witness&apos;</span>
            <span className="text-[var(--lp-pale-2)]">);</span>
            {'\n\n'}
            <span className="text-[#6ea8fe]">export interface</span>{' '}
            <span className="text-[var(--lp-pale)]">ApprovalGrant</span>
            <span className="text-[var(--lp-pale-2)]"> {'{'}</span>
            {'\n  '}
            <span className="text-[var(--lp-pale-2)]">readonly [GATE_WITNESS]: </span>
            <span className="text-[#5fd3a6]">true</span>
            <span className="text-[var(--lp-pale-2)]">;</span>
            {'   '}
            <span className="text-[var(--lp-pale-3)]">// unforgeable outside this module</span>
            {'\n'}
            <span className="text-[var(--lp-pale-2)]">{'}'}</span>
          </code>
        </pre>
      </Reveal>

      <div className="mt-16 grid gap-x-14 gap-y-12 md:grid-cols-3">
        <Point
          n="i"
          title="Never rendered"
          body="Not greyed out, not hidden behind a warning. A disabled button is a decision you can argue with; an unrepresentable state is one you cannot."
        />
        <Point
          n="ii"
          title="Six forgeries, six compile errors"
          body="Attempts to fake a grant are asserted as type errors. Weaken the type and tsc reports an unused @ts-expect-error — the build fails."
        />
        <Point
          n="iii"
          title="curl gets the same answer"
          body="The gate re-runs server-side against the stored dossier. Approving through the HTTP API with no browser involved is refused identically."
        />
      </div>
    </Band>
  );
}

function Point({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <Reveal>
      <div className="border-t border-[var(--lp-active)] pt-6">
        <span className="evidence text-[12px] text-[var(--lp-orange-b)]">{n}</span>
        <h3 className="mt-4 text-[21px] leading-tight font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--lp-ink-2)]">{body}</p>
      </div>
    </Reveal>
  );
}

/* -------------------------------------------------------------------------- */
/* Two certificates                                                            */
/* -------------------------------------------------------------------------- */

export function ProofSection() {
  return (
    <Band
      id="proof"
      index="04 / 07"
      label="Two kinds of proof"
      title={
        <>
          You cannot prove a deletion{' '}
          <span className="italic font-light normal-case tracking-[-0.01em] text-[var(--lp-orange-b)]">reversible.</span>
        </>
      }
      lede="So for the changes that genuinely cannot be undone, the agent proves the opposite thing instead — not that you can take it back, but that it knows exactly what “it” is."
    >
      <div className="grid gap-x-14 gap-y-16 lg:grid-cols-2">
        <Reveal>
          <div>
            <div className="flex items-baseline gap-3">
              <span className="evidence text-[13px] font-semibold tracking-[0.1em] text-[#0b6349]">UNDO</span>
              <span className="lp-mono text-[11px] tracking-[0.16em] uppercase text-[var(--lp-ink-2)]">for reversible work</span>
            </div>
            <h3 className="lp-display mt-6 text-[clamp(1.7rem,3vw,2.6rem)]">Three checksums</h3>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-[var(--lp-ink-2)]">
              Apply the change to a shadow branch. Apply the rollback. Checksum the affected tables a third time and
              prove the data came back <strong className="font-semibold text-[var(--lp-ink)]">byte-identical</strong>.
            </p>

            <div className="mt-9">
              <Digest label="pre" value="sha256:0234ab62abae86f9…" />
              <Digest label="post" value="sha256:9f11c7de40b1c882…" dim />
              <Digest label="post-rollback" value="sha256:0234ab62abae86f9…" match />
            </div>

            <p className="mt-6 max-w-[46ch] text-[13px] leading-relaxed text-[var(--lp-ink-2)]">
              AIRLOCK never trusts the verifier’s own <span className="evidence">match</span> flag. It recomputes{' '}
              <span className="evidence">pre === post_rollback</span> itself, so an engine bug cannot open the door.
            </p>
          </div>
        </Reveal>

        <Reveal delay={90}>
          <div>
            <div className="flex items-baseline gap-3">
              <span className="evidence text-[13px] font-semibold tracking-[0.1em] text-[var(--lp-orange-b)]">
                SCOPE
              </span>
              <span className="lp-mono text-[11px] tracking-[0.16em] uppercase text-[var(--lp-ink-2)]">for the irreversible</span>
            </div>
            <h3 className="lp-display mt-6 text-[clamp(1.7rem,3vw,2.6rem)]">Exactly what dies</h3>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-[var(--lp-ink-2)]">
              Every record that will be destroyed, across every system — plus an explicit list of what is being{' '}
              <strong className="font-semibold text-[var(--lp-ink)]">deliberately kept</strong> and the obligation
              justifying each exclusion.
            </p>

            <div className="mt-9">
              <ScopeRow kind="destroy" system="postgres" detail="4 subjects across 12 tables" count="168" />
              <ScopeRow kind="destroy" system="stripe" detail="customer + payment methods" count="4" />
              <ScopeRow kind="keep" system="invoices" detail="seven-year statutory retention" count="47" />
            </div>

            <p className="mt-6 max-w-[46ch] text-[13px] leading-relaxed text-[var(--lp-ink-2)]">
              An exclusion with no stated reason is rejected by the contract. “We kept some things” is not a scope.
            </p>
          </div>
        </Reveal>
      </div>
    </Band>
  );
}

function Digest({ label, value, match, dim }: { label: string; value: string; match?: boolean; dim?: boolean }) {
  return (
    <div className="flex items-baseline gap-5 border-t border-[var(--lp-active)] py-3.5 last:border-b">
      <span className="lp-mono text-[11px] tracking-[0.16em] uppercase text-[var(--lp-ink-2)] w-[112px] shrink-0">{label}</span>
      <span
        className={cx(
          'evidence min-w-0 flex-1 truncate text-[13px]',
          dim ? 'text-[var(--lp-ink-2)]' : 'text-[var(--lp-ink)]',
        )}
      >
        {value}
      </span>
      {match ? <span className="shrink-0 text-[12.5px] font-semibold text-[#0b6349]">match</span> : null}
    </div>
  );
}

function ScopeRow({
  kind,
  system,
  detail,
  count,
}: {
  kind: 'destroy' | 'keep';
  system: string;
  detail: string;
  count: string;
}) {
  return (
    <div className="flex items-baseline gap-5 border-t border-[var(--lp-active)] py-3.5 last:border-b">
      <span
        className={cx(
          'evidence w-[84px] shrink-0 text-[11px] tracking-[0.08em]',
          kind === 'keep' ? 'text-[#0b6349]' : 'text-[var(--lp-orange-b)]',
        )}
      >
        {kind === 'keep' ? 'KEEP' : 'DESTROY'}
      </span>
      <span className="min-w-0 flex-1 text-[14px] text-[var(--lp-ink-2)]">
        <span className="evidence text-[var(--lp-ink)]">{system}</span> — {detail}
      </span>
      <span className="evidence shrink-0 text-[14px] font-semibold">{count}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

export function PolicySection() {
  const rules = CHANGE_CLASSES.map((cls) => ({ cls, rule: ruleFor(DEFAULT_POLICY, cls) }));

  return (
    <Band
      id="policy"
      index="05 / 07"
      label="Policy"
      title={
        <>
          Allowed, by whom, and{' '}
          <span className="italic font-light normal-case tracking-[-0.01em] text-[var(--lp-orange-b)]">right now?</span>
        </>
      }
      lede="A certificate answers “is this change what it claims to be”. It cannot answer whether your organisation permits it — that is not a property of the change. Seven classes, each with its own rules, in a YAML file a team can argue with."
    >
      <Reveal>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-left">
            <thead>
              <tr>
                {['Class', 'Certificate', 'Approvers', 'Proof valid', 'Undo window', 'Break-glass'].map((h) => (
                  <th key={h} className="lp-mono text-[11px] tracking-[0.16em] uppercase text-[var(--lp-ink-2)] border-b border-[var(--lp-active)] pb-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(({ cls, rule }) => (
                <tr key={cls} className="group border-b border-[var(--lp-active)]">
                  <td className="py-5 pr-6">
                    <span className="text-[16px] font-semibold tracking-[-0.015em]">
                      {CHANGE_CLASS_COPY[cls].title}
                    </span>
                  </td>
                  <td className="py-5 pr-6">
                    <span
                      className={cx(
                        'evidence text-[12px] font-semibold tracking-[0.08em]',
                        rule.requires === 'SCOPE'
                          ? 'text-[var(--lp-orange-b)]'
                          : rule.requires === 'UNDO'
                            ? 'text-[#0b6349]'
                            : 'text-[var(--lp-ink-2)]',
                      )}
                    >
                      {rule.requires}
                    </span>
                  </td>
                  <td className="evidence py-5 pr-6 text-[14px] text-[var(--lp-ink-2)]">{rule.quorum}</td>
                  <td className="evidence py-5 pr-6 text-[14px] text-[var(--lp-ink-2)]">
                    {Math.round(rule.freshness_seconds / 60)} min
                  </td>
                  <td className="evidence py-5 pr-6 text-[14px] text-[var(--lp-ink-2)]">
                    {rule.undo_window_seconds === null ? (
                      <span className="text-[var(--lp-ink-2)]">none</span>
                    ) : (
                      `${Math.round(rule.undo_window_seconds / 60)} min`
                    )}
                  </td>
                  <td className="py-5 text-[14px] text-[var(--lp-ink-2)]">
                    {rule.break_glass ? 'permitted' : <span className="text-[var(--lp-ink-2)]">no</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <p className="mt-10 max-w-[70ch] text-[14px] leading-relaxed text-[var(--lp-ink-2)]">
          Note what is deliberately <em className="not-italic text-[var(--lp-ink-2)]">absent</em>: there is no change
          freeze on erasure, money movement or access grants. A freeze that blocks a right-to-erasure request trades a
          legal problem for an operational one. That absence is asserted in the test suite, so it cannot be quietly
          reversed.
        </p>
      </Reveal>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */
/* After it lands                                                              */
/* -------------------------------------------------------------------------- */

export function AfterSection() {
  return (
    <Band
      index="06 / 07"
      label="After it lands"
      title={
        <>
          The proof has a{' '}
          <span className="italic font-light normal-case tracking-[-0.01em] text-[var(--lp-orange-b)]">second life.</span>
        </>
      }
      lede="Having demonstrated the inverse once, the system can offer something almost nothing else can: a one-press undo on a production database, for as long as it is willing to vouch for that demonstration."
    >
      <div className="grid gap-x-14 gap-y-12 md:grid-cols-3">
        <Point
          n="01"
          title="Health check"
          body="Production is re-checksummed the moment the change lands and compared against what the certificate predicted it would become."
        />
        <Point
          n="02"
          title="Auto-rollback, where proven"
          body="A mismatch executes the inverse that was already demonstrated. Where it was never proven, AIRLOCK refuses and raises an alarm instead."
        />
        <Point
          n="03"
          title="Thirty minutes to change your mind"
          body="Most bad changes are perfectly healthy by every checksum and simply turn out to be wrong. Only a person ever catches that."
        />
      </div>

      <Reveal delay={100}>
        <p className="mt-16 max-w-[74ch] text-[clamp(1.05rem,1.7vw,1.45rem)] leading-[1.5] text-[var(--lp-ink)]">
          <strong className="font-semibold">The refusal is the feature.</strong> AIRLOCK will only auto-revert a
          rollback it has proof of. Running an untested inverse against a database already in an unexpected state is
          how a bad afternoon becomes a bad quarter — so that case stops and gets a human.
        </p>
      </Reveal>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

const NUMBERS = [
  { value: '201', label: 'tests', note: 'properties, not implementations' },
  { value: '23', label: 'harness capabilities', note: 'each lit only by a real event' },
  { value: '16', label: 'fixtures', note: 'seven distinct refusals' },
  { value: '0', label: 'tools that write to production', note: 'asserted in CI' },
];

export function NumbersSection() {
  return (
    <section className="px-4 pb-4 sm:px-7 sm:pb-7"><div className="lp-card px-8 py-20 sm:px-12">
      <div className="grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
        {NUMBERS.map((n, i) => (
          <Reveal key={n.label} delay={i * 70}>
            <div className="border-t border-[var(--lp-active)] pt-6">
              <div className="evidence text-[clamp(3rem,6.5vw,5rem)] leading-[0.82] font-bold tracking-[-0.05em]">
                {n.value}
              </div>
              <div className="mt-5 text-[15px] font-semibold tracking-[-0.01em]">{n.label}</div>
              <div className="mt-1.5 text-[13px] text-[var(--lp-ink-2)]">{n.note}</div>
            </div>
          </Reveal>
        ))}
      </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Closing + footer                                                            */
/* -------------------------------------------------------------------------- */

export function Closing() {
  return (
    <section className="relative overflow-hidden border-t border-[var(--lp-line-dark)] bg-[var(--lp-void)] px-6 pt-28 pb-0 text-[var(--lp-pale)] sm:px-10 md:pt-40">
      <div className="mx-auto max-w-[1100px] text-center">
        <Reveal>
          <span className="lp-mono text-[11px] tracking-[0.16em] uppercase text-[var(--lp-ink-2)] !text-[var(--lp-pale-3)]">07 / 07</span>
          <h2 className="lp-display mx-auto mt-8 max-w-[16ch] text-[clamp(2.4rem,7.5vw,6.4rem)]">
            Build the agent you would{' '}
            <span className="italic font-light normal-case tracking-[-0.01em] text-[#f2a054]">trust with root</span>
          </h2>
          <p className="mx-auto mt-9 max-w-[58ch] text-[clamp(1rem,1.4vw,1.2rem)] leading-relaxed text-[var(--lp-pale-2)]">
            AIRLOCK is the literal answer — an agent that behaves as though it is{' '}
            <em className="not-italic text-[var(--lp-pale)]">not</em> trusted with root, and proves it every time
            before it asks.
          </p>
          <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-4">
            <Link
              href="/console"
              className="group inline-flex items-center gap-3 bg-[var(--lp-pale)] px-9 py-4.5 text-[14px] font-medium text-[var(--lp-void)] transition-colors hover:bg-[var(--lp-orange-b)] hover:text-white"
            >
              Open the console
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
                <path d="M2 6h8m0 0L6.5 2.5M10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link
              href="/control"
              className="lp-link inline-flex items-center self-center text-[14px] font-medium text-[var(--lp-pale-2)] hover:text-[var(--lp-pale)]"
            >
              See the control room
            </Link>
          </div>
        </Reveal>
      </div>

      {/* The wordmark, bled off the bottom edge. */}
      <Wordmark
        className="mt-24 h-[clamp(3.5rem,13vw,11rem)] w-full translate-y-[18%] text-[var(--lp-pale)] opacity-[0.09]"
        opacity={1}
      />
    </section>
  );
}

const FOOTER: Array<{ heading: string; items: Array<{ label: string; href: string; external?: boolean }> }> = [
  {
    heading: 'Product',
    items: [
      { label: 'Operator console', href: '/console' },
      { label: 'Control room', href: '/control' },
      { label: 'Try the gate', href: '#gate' },
      { label: 'Verify the ledger', href: '#ledger' },
    ],
  },
  {
    heading: 'How it works',
    items: [
      { label: 'Policy, generated', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/POLICY.md', external: true },
      { label: 'Harness capabilities', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/CAPABILITIES.md', external: true },
      { label: 'The benchmark', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/BENCHMARK.md', external: true },
      { label: 'Demo runbook', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/DEMO.md', external: true },
    ],
  },
  {
    heading: 'The code',
    items: [
      { label: 'The invariant', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/packages/contract/src/gate.ts', external: true },
      { label: 'The one doorway', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/packages/mcp/src/tools.ts', external: true },
      { label: 'Untrusted content', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/packages/contract/src/quarantine.ts', external: true },
      { label: 'Repository', href: 'https://github.com/Rohit-ATS/Airlock', external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-[var(--lp-line-dark)] bg-[var(--lp-void)] px-6 py-20 text-[var(--lp-pale)] sm:px-10">
      <div className="grid gap-x-14 gap-y-12 lg:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <div className="lp-display text-[22px] tracking-[-0.03em] text-[var(--lp-pale)]">AIRLOCK</div>
          <p className="mt-6 max-w-[40ch] text-[14px] leading-relaxed text-[var(--lp-pale-2)]">
            Nothing reaches production without passing through the airlock. Built on TrueForge for the Agent Harness
            Hackathon, 24–30 August 2026.
          </p>
          <p className="mt-5 max-w-[44ch] text-[12.5px] leading-relaxed text-[var(--lp-pale-3)]">
            The seeded queue is console fixtures. They exercise the card, the queue, the policy engine and the ledger —
            they are not evidence about anybody&rsquo;s database.
          </p>
        </div>

        {FOOTER.map((group) => (
          <div key={group.heading}>
            <span className="lp-mono text-[11px] tracking-[0.16em] uppercase text-[var(--lp-ink-2)] !text-[var(--lp-pale-3)]">{group.heading}</span>
            <ul className="mt-5 space-y-3">
              {group.items.map((item) => (
                <li key={item.label}>
                  {item.external ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="lp-link text-[14px] text-[var(--lp-pale-2)] transition-colors hover:text-[var(--lp-pale)]"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      href={item.href}
                      className="lp-link text-[14px] text-[var(--lp-pale-2)] transition-colors hover:text-[var(--lp-pale)]"
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-16 flex flex-wrap items-center justify-between gap-5 border-t border-[var(--lp-line-dark)] pt-8">
        <p className="text-[13px] text-[var(--lp-pale-3)]">
          MIT licensed · <span className="text-[var(--lp-pale-2)]">Rohit Maruri</span> and{' '}
          <span className="text-[var(--lp-pale-2)]">Damir Mertl</span>
        </p>
        <p className="evidence text-[12px] text-[var(--lp-pale-3)]">
          certificate.status !== &quot;PROVEN&quot; → the gate is never offered
        </p>
      </div>
    </footer>
  );
}

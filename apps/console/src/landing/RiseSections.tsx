'use client';

import Link from 'next/link';
import { CHANGE_CLASS_COPY, CHANGE_CLASSES, DEFAULT_POLICY, ruleFor } from '@airlock/contract';
import { cx } from '@/design/primitives';
import { Plate } from './Rise';
import { Wordmark } from './Wordmark';

/**
 * The body of the front door.
 *
 * Each plate answers one question, in the order a sceptical reader asks them:
 * what is the rule, can I break it, what counts as proof, what does policy add,
 * what happens after it lands, can I trust the record, and who built it.
 *
 * The two live demos are quoted as dark instrument panels rather than restyled
 * to match the page. That is deliberate: they are the actual product running
 * inside the marketing page, and making them look like the marketing page would
 * hide the one fact worth advertising.
 */

/* -------------------------------------------------------------------------- */
/* Ticker                                                                      */
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

export function Ticker() {
  return (
    <div className="px-3 pb-6 sm:px-5">
      <div className="lp-plate mx-auto max-w-[1500px] overflow-hidden py-5">
        <div className="flex items-center gap-10 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="lp-eyebrow shrink-0">Runs on</span>
          {STACK.map((name) => (
            <span
              key={name}
              className="shrink-0 text-[15px] font-medium whitespace-nowrap text-[var(--lp-ink-3)]"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The rule                                                                    */
/* -------------------------------------------------------------------------- */

export function RuleSection() {
  return (
    <Plate
      id="rule"
      index="02/07"
      label="The rule"
      title={
        <>
          The gate is not a
          <br />
          conditional. It is a type.
        </>
      }
      standfirst={
        <>
          Every other approval flow is <em className="not-italic text-[var(--lp-ink)]">“the agent says it is going to
          do X — click yes.”</em> That asks a human to trust a plan. AIRLOCK’s gate cannot be offered until the agent
          holds a certificate: the result of having actually done the thing, and undone it, somewhere safe.
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="lp-instrument overflow-hidden p-6 sm:p-8">
          <p className="evidence text-[13px] leading-relaxed text-[#7d8b9e]">
            <span className="text-[#4fc3f7]">// packages/contract/src/gate.ts</span>
            <br />
            <span className="text-[#b4bece]">const</span> GATE_WITNESS:{' '}
            <span className="text-[#b4bece]">unique symbol</span> ={' '}
            <span className="text-[#35d6a4]">Symbol</span>(<span className="text-[#ff9130]">&apos;airlock.gate&apos;</span>
            );
          </p>
          <p className="mt-6 text-[14.5px] leading-relaxed text-[#b4bece]">
            The Approve control accepts an <span className="evidence text-[#e8ecf2]">ApprovalGrant</span>, and an{' '}
            <span className="evidence text-[#e8ecf2]">ApprovalGrant</span> carries a module-private symbol that only{' '}
            <span className="evidence text-[#e8ecf2]">openGate()</span> can mint.
          </p>
          <p className="mt-4 text-[14.5px] leading-relaxed text-[#b4bece]">
            There is no value a developer could pass to render an approval for an unproven change. Six attempts to
            forge one are asserted as <span className="text-[#e8ecf2]">compile errors</span> — weaken the type and the
            build fails.
          </p>
        </div>

        <div className="grid gap-4">
          <Card
            kicker="Not greyed out"
            title="Never rendered"
            body="A disabled button is a decision you can argue with. An unrepresentable state is one you cannot."
          />
          <Card
            kicker="Server-side, again"
            title="curl gets the same answer"
            body="Approving through the HTTP API with no browser involved re-runs the identical gate. 403, with the machine-readable reason attached."
            tone="signal"
          />
        </div>
      </div>
    </Plate>
  );
}

function Card({
  kicker,
  title,
  body,
  tone = 'paper',
}: {
  kicker: string;
  title: string;
  body: string;
  tone?: 'paper' | 'signal';
}) {
  return (
    <div
      className={cx(
        'rounded-[18px] border p-6 sm:p-7',
        tone === 'signal'
          ? 'border-[var(--lp-signal)]/35 bg-[var(--lp-signal-wash)]'
          : 'border-[var(--lp-line)] bg-[var(--lp-paper-2)]',
      )}
    >
      <span className="lp-eyebrow">{kicker}</span>
      <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.02em] text-[var(--lp-ink)]">{title}</h3>
      <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--lp-ink-2)]">{body}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Two certificates                                                            */
/* -------------------------------------------------------------------------- */

export function ProofSection() {
  return (
    <Plate
      id="proof"
      index="04/07"
      label="Two kinds of proof"
      title="You cannot prove a deletion reversible."
      standfirst="So for the changes that genuinely cannot be undone, the agent proves the opposite thing instead — not that you can take it back, but that it knows exactly what “it” is."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[18px] border border-[var(--lp-line)] bg-[var(--lp-paper-2)] p-7 sm:p-9">
          <div className="flex items-center gap-2.5">
            <span className="rounded-full bg-[#0b3729] px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-[#35d6a4]">
              UNDO
            </span>
            <span className="lp-eyebrow">for reversible work</span>
          </div>
          <h3 className="lp-display mt-5 text-[clamp(1.4rem,2.4vw,2rem)]">Three checksums</h3>
          <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--lp-ink-2)]">
            Apply the change to a shadow branch. Apply the rollback. Checksum the affected tables a third time and
            prove the data came back <strong className="font-semibold text-[var(--lp-ink)]">byte-identical</strong>.
          </p>
          <div className="mt-6 space-y-2">
            <Digest label="pre" value="sha256:0234ab62…6a34" />
            <Digest label="post" value="sha256:9f11c7de…22b1" dim />
            <Digest label="post-rollback" value="sha256:0234ab62…6a34" match />
          </div>
          <p className="mt-5 text-[12.5px] leading-relaxed text-[var(--lp-ink-3)]">
            AIRLOCK never trusts the verifier’s own <span className="evidence">match</span> flag. It recomputes{' '}
            <span className="evidence">pre === post_rollback</span> itself, so an engine bug cannot open the door.
          </p>
        </div>

        <div className="rounded-[18px] border border-[var(--lp-line)] bg-[var(--lp-paper-2)] p-7 sm:p-9">
          <div className="flex items-center gap-2.5">
            <span className="rounded-full bg-[#43230b] px-3 py-1 text-[11px] font-semibold tracking-[0.08em] text-[#ff9130]">
              SCOPE
            </span>
            <span className="lp-eyebrow">for the irreversible</span>
          </div>
          <h3 className="lp-display mt-5 text-[clamp(1.4rem,2.4vw,2rem)]">Exactly what dies</h3>
          <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--lp-ink-2)]">
            Every record that will be destroyed, across every system — plus an explicit list of what is being{' '}
            <strong className="font-semibold text-[var(--lp-ink)]">deliberately kept</strong> and the obligation
            justifying each exclusion.
          </p>
          <div className="mt-6 space-y-2.5">
            <ScopeRow system="postgres" detail="4 subjects across 12 tables" count="168" kind="destroy" />
            <ScopeRow system="stripe" detail="customer + payment methods" count="4" kind="destroy" />
            <ScopeRow
              system="invoices"
              detail="seven-year statutory retention"
              count="47"
              kind="keep"
            />
          </div>
          <p className="mt-5 text-[12.5px] leading-relaxed text-[var(--lp-ink-3)]">
            An exclusion with no stated reason is rejected by the contract. “We kept some things” is not a scope.
          </p>
        </div>
      </div>
    </Plate>
  );
}

function Digest({ label, value, match, dim }: { label: string; value: string; match?: boolean; dim?: boolean }) {
  return (
    <div
      className={cx(
        'flex items-baseline gap-3 rounded-[10px] border px-3 py-2.5',
        match
          ? 'border-[#35d6a4]/45 bg-[#35d6a4]/10'
          : 'border-[var(--lp-line)] bg-[var(--lp-paper)]',
      )}
    >
      <span className="lp-eyebrow w-[104px] shrink-0 !text-[10px]">{label}</span>
      <span
        className={cx(
          'evidence min-w-0 flex-1 truncate text-[12.5px]',
          dim ? 'text-[var(--lp-ink-4)]' : 'text-[var(--lp-ink)]',
        )}
      >
        {value}
      </span>
      {match ? <span className="text-[13px] font-semibold text-[#0f7a5a]">match</span> : null}
    </div>
  );
}

function ScopeRow({
  system,
  detail,
  count,
  kind,
}: {
  system: string;
  detail: string;
  count: string;
  kind: 'destroy' | 'keep';
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-[var(--lp-line)] pb-2.5 last:border-0">
      <span
        className={cx(
          'evidence w-[74px] shrink-0 text-[11px]',
          kind === 'keep' ? 'text-[#0f7a5a]' : 'text-[var(--lp-signal-ink)]',
        )}
      >
        {kind === 'keep' ? 'KEEP' : 'DESTROY'}
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-[var(--lp-ink-2)]">
        <span className="evidence text-[var(--lp-ink)]">{system}</span> — {detail}
      </span>
      <span className="evidence shrink-0 text-[13px] font-semibold text-[var(--lp-ink)]">{count}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Classes + policy                                                            */
/* -------------------------------------------------------------------------- */

export function PolicySection() {
  const rules = CHANGE_CLASSES.map((cls) => ({ cls, rule: ruleFor(DEFAULT_POLICY, cls) }));

  return (
    <Plate
      id="policy"
      index="05/07"
      label="Policy"
      title="Is it allowed, by whom, and right now?"
      standfirst="A certificate answers “is this change what it claims to be”. It cannot answer whether your organisation permits it — that is not a property of the change. Seven classes, each with its own rules, in a YAML file a team can argue with."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--lp-line-2)]">
              {['Class', 'Certificate', 'Approvers', 'Proof valid', 'Undo window', 'Break-glass'].map((h) => (
                <th key={h} className="lp-eyebrow py-3 pr-4 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map(({ cls, rule }) => (
              <tr key={cls} className="border-b border-[var(--lp-line)] last:border-0">
                <td className="py-3.5 pr-4">
                  <span className="text-[14px] font-semibold text-[var(--lp-ink)]">
                    {CHANGE_CLASS_COPY[cls].title}
                  </span>
                </td>
                <td className="py-3.5 pr-4">
                  <span
                    className={cx(
                      'evidence rounded-full px-2.5 py-1 text-[10.5px] font-semibold',
                      rule.requires === 'SCOPE'
                        ? 'bg-[#43230b] text-[#ff9130]'
                        : rule.requires === 'UNDO'
                          ? 'bg-[#0b3729] text-[#35d6a4]'
                          : 'bg-[var(--lp-paper-3)] text-[var(--lp-ink-2)]',
                    )}
                  >
                    {rule.requires}
                  </span>
                </td>
                <td className="evidence py-3.5 pr-4 text-[13px] text-[var(--lp-ink-2)]">{rule.quorum}</td>
                <td className="evidence py-3.5 pr-4 text-[13px] text-[var(--lp-ink-2)]">
                  {Math.round(rule.freshness_seconds / 60)} min
                </td>
                <td className="evidence py-3.5 pr-4 text-[13px] text-[var(--lp-ink-2)]">
                  {rule.undo_window_seconds === null ? '—' : `${Math.round(rule.undo_window_seconds / 60)} min`}
                </td>
                <td className="py-3.5 text-[13px] text-[var(--lp-ink-2)]">
                  {rule.break_glass ? 'permitted' : <span className="text-[var(--lp-ink-4)]">no</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 max-w-[72ch] text-[13.5px] leading-relaxed text-[var(--lp-ink-3)]">
        Note what is deliberately <em className="not-italic text-[var(--lp-ink-2)]">absent</em>: there is no change
        freeze on erasure, money movement or access grants. A freeze that blocks a right-to-erasure request trades a
        legal problem for an operational one. That absence is asserted in the test suite, so it cannot be quietly
        reversed.
      </p>
    </Plate>
  );
}

/* -------------------------------------------------------------------------- */
/* After it lands                                                              */
/* -------------------------------------------------------------------------- */

export function AfterSection() {
  return (
    <Plate
      index="06/07"
      label="After it lands"
      title="The proof has a second life."
      standfirst="Having demonstrated the inverse once, the system can offer something almost nothing else can: a one-press undo on a production database, for as long as it is willing to vouch for that demonstration."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Beat
          n="01"
          title="Health check"
          body="Production is re-checksummed the moment the change lands and compared against what the certificate predicted."
        />
        <Beat
          n="02"
          title="Auto-rollback — where proven"
          body="A mismatch executes the inverse that was already demonstrated. Where it was never proven, AIRLOCK refuses and raises an alarm instead."
          tone="signal"
        />
        <Beat
          n="03"
          title="30 minutes to change your mind"
          body="Most bad changes are perfectly healthy by every checksum and simply turn out to be wrong. Only a person catches that."
        />
      </div>

      <div className="mt-4 rounded-[18px] border border-[var(--lp-line)] bg-[var(--lp-paper-2)] p-7">
        <p className="max-w-[76ch] text-[14.5px] leading-relaxed text-[var(--lp-ink-2)]">
          <strong className="font-semibold text-[var(--lp-ink)]">The refusal is the feature.</strong> AIRLOCK will only
          auto-revert a rollback it has proof of. Running an untested inverse against a database that is already in an
          unexpected state is how a bad afternoon becomes a bad quarter — so that case stops and gets a human, which is
          the honest thing for it to do.
        </p>
      </div>
    </Plate>
  );
}

function Beat({ n, title, body, tone }: { n: string; title: string; body: string; tone?: 'signal' }) {
  return (
    <div
      className={cx(
        'rounded-[18px] border p-6 sm:p-7',
        tone === 'signal'
          ? 'border-[var(--lp-signal)]/35 bg-[var(--lp-signal-wash)]'
          : 'border-[var(--lp-line)] bg-[var(--lp-paper-2)]',
      )}
    >
      <span className="evidence text-[26px] leading-none font-bold text-[var(--lp-ink-4)]">{n}</span>
      <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.015em] text-[var(--lp-ink)]">{title}</h3>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-[var(--lp-ink-2)]">{body}</p>
    </div>
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
    <div className="px-3 pb-6 sm:px-5">
      <div className="lp-plate mx-auto max-w-[1500px] px-5 py-10 sm:px-9">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {NUMBERS.map((n) => (
            <div key={n.label}>
              <div className="evidence text-[clamp(2.4rem,5vw,3.6rem)] leading-none font-bold tracking-[-0.04em] text-[var(--lp-ink)]">
                {n.value}
              </div>
              <div className="mt-3 text-[14px] font-semibold text-[var(--lp-ink-2)]">{n.label}</div>
              <div className="mt-1 text-[12.5px] text-[var(--lp-ink-3)]">{n.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Closing call, and the footer                                                */
/* -------------------------------------------------------------------------- */

export function ClosingSection() {
  return (
    <div className="px-3 pb-6 sm:px-5">
      <div className="lp-plate relative mx-auto max-w-[1500px] overflow-hidden px-5 py-16 sm:px-9 md:py-24">
        <Wordmark
          className="pointer-events-none absolute -bottom-[8%] left-1/2 h-[42%] w-[110%] -translate-x-1/2 select-none"
          opacity={0.75}
        />
        <div className="relative z-10 mx-auto max-w-[820px] text-center">
          <span className="lp-eyebrow">[07/07]</span>
          <h2 className="lp-display mt-5 text-[clamp(2.2rem,5.6vw,4.4rem)]">
            Build the agent you
            <br />
            would trust with root
          </h2>
          <p className="mx-auto mt-6 max-w-[56ch] text-[15.5px] leading-relaxed text-[var(--lp-ink-2)]">
            AIRLOCK is the literal answer — an agent that behaves as though it is{' '}
            <em className="not-italic text-[var(--lp-ink)]">not</em> trusted with root, and proves it every time
            before it asks.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href="/console"
              className="rounded-[12px] bg-[var(--lp-signal)] px-8 py-4 text-[14px] font-semibold text-white shadow-[0_14px_30px_-14px_rgba(217,100,29,.9)] transition-transform hover:scale-[1.02]"
            >
              Open the console
            </Link>
            <Link
              href="/control"
              className="rounded-[12px] border border-[var(--lp-line-2)] bg-[var(--lp-paper-2)] px-8 py-4 text-[14px] font-semibold text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-paper-3)]"
            >
              See the control room
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const FOOTER_LINKS: Array<{ heading: string; items: Array<{ label: string; href: string; external?: boolean }> }> = [
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
      { label: 'The policy, generated', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/POLICY.md', external: true },
      { label: 'Harness capabilities', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/CAPABILITIES.md', external: true },
      { label: 'The migration benchmark', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/BENCHMARK.md', external: true },
      { label: 'Demo runbook', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/docs/DEMO.md', external: true },
    ],
  },
  {
    heading: 'The code',
    items: [
      { label: 'The invariant', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/packages/contract/src/gate.ts', external: true },
      { label: 'The agent’s one doorway', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/packages/mcp/src/tools.ts', external: true },
      { label: 'Untrusted content', href: 'https://github.com/Rohit-ATS/Airlock/blob/main/packages/contract/src/quarantine.ts', external: true },
      { label: 'Repository', href: 'https://github.com/Rohit-ATS/Airlock', external: true },
    ],
  },
];

export function RiseFooter() {
  return (
    <footer className="px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="lp-plate mx-auto max-w-[1500px] px-5 py-12 sm:px-9">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-[9px] bg-[var(--lp-ink)]">
                <span className="block size-[9px] rounded-[2px] bg-[var(--lp-signal)]" aria-hidden />
              </span>
              <span className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--lp-ink)]">AIRLOCK</span>
            </div>
            <p className="mt-5 max-w-[38ch] text-[13.5px] leading-relaxed text-[var(--lp-ink-3)]">
              Nothing reaches production without passing through the airlock. Built on TrueForge for the Agent Harness
              Hackathon, 24–30 August 2026.
            </p>
            <p className="mt-5 text-[12.5px] text-[var(--lp-ink-4)]">
              The seeded queue is console fixtures. They exercise the card, the queue, the policy engine and the
              ledger — they are not evidence about anybody&rsquo;s database.
            </p>
          </div>

          {FOOTER_LINKS.map((group) => (
            <div key={group.heading}>
              <span className="lp-eyebrow">{group.heading}</span>
              <ul className="mt-4 space-y-2.5">
                {group.items.map((item) => (
                  <li key={item.label}>
                    {item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13.5px] text-[var(--lp-ink-2)] transition-colors hover:text-[var(--lp-ink)]"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        className="text-[13.5px] text-[var(--lp-ink-2)] transition-colors hover:text-[var(--lp-ink)]"
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

        <div className="lp-rule my-9" />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-[12.5px] text-[var(--lp-ink-3)]">
            MIT licensed · <span className="text-[var(--lp-ink-2)]">Rohit Maruri</span> and{' '}
            <span className="text-[var(--lp-ink-2)]">Damir Mertl</span>
          </p>
          <p className="evidence text-[11.5px] text-[var(--lp-ink-4)]">
            certificate.status !== &quot;PROVEN&quot; → the gate is never offered
          </p>
        </div>
      </div>
    </footer>
  );
}

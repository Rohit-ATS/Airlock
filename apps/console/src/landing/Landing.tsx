'use client';

import Link from 'next/link';
import { CAPABILITY_TOTAL, CHANGE_CLASSES } from '@airlock/contract';
import { Code, Footer, Reveal, Section, SectionRail, SECTIONS, Stat, TopNav } from './chrome';
import { Hatch } from './Hatch';
import { GateDemo } from './GateDemo';
import { LedgerDemo } from './LedgerDemo';
import { Build, Certificates, Classes, Harness, Policy } from './sections';

/**
 * The AIRLOCK landing page.
 *
 * Laid out as a specification document rather than a brochure: numbered
 * sections, a rail that tells you where you are, hairlines instead of cards,
 * and two places where the reader can operate the real thing instead of being
 * told about it. That is the whole editorial line — a product whose argument is
 * "do not take our word for it" should not have a front door that asks you to.
 */
export function Landing() {
  return (
    <div className="relative">
      <TopNav />
      <SectionRail />

      <Hero />

      <Section
        spec={SECTIONS[0]!}
        title="The gate is not a conditional. It is a type."
        standfirst={
          <>
            Every other approval flow is <em className="text-ink-2 not-italic">&ldquo;the agent says it is going to
            do X — click yes.&rdquo;</em>{' '}
            That asks a human to trust a plan. AIRLOCK&rsquo;s gate cannot be offered until the agent holds a
            certificate: the result of actually having done the thing, and undone it, somewhere safe.
          </>
        }
      >
        <Rule />
      </Section>

      <Section
        spec={SECTIONS[1]!}
        title="Try to open it."
        standfirst={
          <>
            The controls below build a real Change Dossier and pass it to the real{' '}
            <span className="evidence text-ink">openGate()</span> — the same function the console calls and the server
            re-runs before it writes anything. Every combination is a live evaluation. See if you can find one that
            opens a door it should not.
          </>
        }
      >
        <GateDemo />
      </Section>

      <Section
        spec={SECTIONS[2]!}
        title="Two kinds of proof, because there are two kinds of change."
        standfirst="Some changes can be proven reversible. The rest cannot, and pretending otherwise is the failure this whole system exists to prevent — so for those, the agent proves the opposite thing instead."
      >
        <Certificates />
      </Section>

      <Section
        spec={SECTIONS[3]!}
        title="Anything you cannot take back."
        standfirst={
          <>
            The test for admission is not <em className="not-italic">&ldquo;is it a database write&rdquo;</em> but{' '}
            <em className="not-italic">&ldquo;if this goes wrong, can you take it back?&rdquo;</em> Sending forty
            thousand emails is as irreversible as dropping a column, and considerably harder to apologise for.
          </>
        }
      >
        <Classes />
      </Section>

      <Section
        spec={SECTIONS[4]!}
        title="The certificate says what the change is. Policy says whether it is allowed."
        standfirst="A proof cannot answer that, because it is not a property of the change — it is a property of the organisation. Two approvers for an erasure, no standing production access, a ceiling on money that can leave without a director: rules a human wrote down once so nobody has to be brave at 2am."
      >
        <Policy />
      </Section>

      <Section
        spec={SECTIONS[5]!}
        title={`${CAPABILITY_TOTAL} harness capabilities, and a rule about claiming them.`}
        standfirst="A lamp cannot be lit from application code. The only writer is the detector module, fed by a passthrough tap on the real TrueForge event stream. An honest count beats a padded one that a judge disproves by clicking a single lamp."
      >
        <Harness />
      </Section>

      <Section
        spec={SECTIONS[6]!}
        title="A change-control system whose audit log can be edited is change-control theatre."
        standfirst={
          <>
            Every decided change carries the hash of the one before it. Edit any historical record and every link
            after it stops verifying. Try it — the check below runs in <span className="text-ink">your</span> browser,
            which is rather the point.
          </>
        }
      >
        <LedgerDemo />
      </Section>

      <Section
        spec={SECTIONS[7]!}
        title="Four decisions the rest of it rests on."
        standfirst="None of them are clever. They are the ones that make the guarantees hold when somebody is tired, or in a hurry, or deliberately trying to get past them."
      >
        <Build />
      </Section>

      <Closing />
      <Footer />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="blueprint aurora relative overflow-hidden">
      <div className="fade-b absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-[1160px] px-5 pt-28 pb-16 sm:px-8 sm:pt-36 md:pb-24">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-12">
          <div>
            <Reveal>
              <div className="flex flex-wrap items-center gap-2">
                <span className="evidence rounded-[3px] border border-hairline-2 bg-raised px-2 py-1 text-[10px] text-ink-3">
                  TrueForge Agent Harness Hackathon · 2026
                </span>
                <span className="evidence rounded-[3px] border border-seal/30 bg-seal-bg px-2 py-1 text-[10px] text-seal">
                  MIT · runs on a clone
                </span>
              </div>
            </Reveal>

            <Reveal delay={60}>
              <h1 className="display mt-6 text-ink">
                Nothing reaches
                <br />
                production without
                <br />
                <span className="text-ice">passing through</span>
                <br />
                the airlock.
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="lede mt-6 max-w-[54ch]">
                A change-control console for irreversible production work. Every dangerous change — a schema
                migration, a bulk correction, a right-to-erasure request, a refund, an access grant — is requested in
                English, executed first against a shadow copy of the real system, proven in a sandbox, and only then
                put in front of a human, with the evidence attached.
              </p>
            </Reveal>

            <Reveal delay={180}>
              <div className="mt-8 flex flex-wrap items-center gap-2.5">
                <Link
                  href="/console"
                  className="inline-flex h-11 items-center rounded-[5px] border border-ice-dim bg-ice-bg px-5 text-[13px] font-medium text-ice transition-colors hover:bg-ice-deep"
                >
                  Open the console
                </Link>
                <a
                  href="#gate"
                  className="inline-flex h-11 items-center rounded-[5px] border border-hairline-2 bg-raised-2 px-5 text-[13px] font-medium text-ink transition-colors hover:border-hairline-3 hover:bg-raised-3"
                >
                  Try to break the gate
                </a>
                <a
                  href="https://github.com/Rohit-ATS/Airlock"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center px-2 text-[13px] text-ink-2 transition-colors hover:text-ink"
                >
                  Read the source →
                </a>
              </div>
            </Reveal>
          </div>

          <Reveal delay={140}>
            <div className="mx-auto w-full max-w-[420px] lg:max-w-none">
              <Hatch sealed />
            </div>
          </Reveal>
        </div>

        {/* ---- the strip of numbers that are actually true ---- */}
        <Reveal delay={240}>
          <div className="mt-14 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-hairline pt-8 sm:grid-cols-4 md:mt-20">
            <Stat
              value={CHANGE_CLASSES.length}
              label="Classes of change"
              sub="Database, money, people, access, infrastructure"
            />
            <Stat value={CAPABILITY_TOTAL} tone="ice" label="Harness capabilities" sub="Each one load-bearing" />
            <Stat value="20" tone="seal" label="Ways the gate refuses" sub="Each with its own reason code" />
            <Stat value="0" tone="hazard" label="Tools that apply a change" sub="That is not an omission" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* §01 — the rule                                                              */
/* -------------------------------------------------------------------------- */

function Rule() {
  return (
    <div className="space-y-6">
      <Reveal>
        <div className="panel milled relative overflow-hidden px-5 py-8 text-center sm:px-8 sm:py-12">
          <p className="axiom text-ink">
            <span className="text-ink-3">certificate.status</span> <span className="text-ice">!==</span>{' '}
            <span className="text-seal">&ldquo;PROVEN&rdquo;</span>
            <span className="mx-3 text-ink-4">→</span>
            <span className="text-fault">the gate is never offered.</span>
          </p>
          <p className="mt-5 text-[12.5px] text-ink-3">
            Not greyed out. Not warned about. <span className="text-ink">Never rendered.</span>
          </p>
        </div>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Reveal>
          <div className="panel milled p-5">
            <h3 className="text-[14px] font-semibold text-ink">Why a type and not an <span className="evidence text-ink-2">if</span></h3>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
              A conditional is a promise that everyone who touches the component keeps writing it correctly. A type is
              a promise the compiler keeps for you.
            </p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
              The Approve control accepts an <span className="evidence text-ink">ApprovalGrant</span>. A grant carries
              a module-private symbol that only <span className="evidence text-ink">openGate()</span> can mint, so
              there is no value a developer could pass to render an approval for an unproven change — not by mistake,
              and not deliberately without editing the gate itself.
            </p>
            <div className="mt-4">
              <Code caption="packages/contract/src/gate.ts">{`const GATE_WITNESS: unique symbol = Symbol('airlock.gate.witness')

export interface ApprovalGrant {
  readonly [GATE_WITNESS]: true   // unforgeable outside this module
  readonly irreversible: boolean
  readonly seals_required: number
  readonly final: boolean
}`}</Code>
            </div>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <div className="space-y-4">
            <div className="panel milled p-5">
              <h3 className="text-[14px] font-semibold text-ink">Four forgeries, asserted as compile errors</h3>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
                If anyone weakens the type, the expected errors disappear, <span className="evidence">tsc</span>{' '}
                reports an unused <span className="evidence">@ts-expect-error</span>, and the build fails.
              </p>
              <div className="mt-4">
                <Code caption="packages/contract/src/gate.typetest.ts">{`// @ts-expect-error - a hand-written grant is not a grant
renderApproveControl({ dossier_id: 'd1', final: true })

// @ts-expect-error - a break-glass override is not an approval
renderApproveControl(override)`}</Code>
              </div>
            </div>

            <div className="panel milled p-5">
              <h3 className="text-[14px] font-semibold text-ink">And again on the server, with no browser involved</h3>
              <div className="mt-3">
                <Code caption="the API, attacked directly">{`$ curl -XPOST /api/dossiers/dos_currency_fix/decision \\
       -d '{"decision":"approved"}'

{"error":"CERTIFICATE_FAILED",
 "message":"Verification ran and failed."}          403

$ # …and a dossier that lies, claiming match:true
$ # with checksums that plainly differ:

{"error":"CHECKSUM_MISMATCH",
 "message":"The data did not return to its
            starting state after rollback."}        403`}</Code>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
                AIRLOCK never trusts the verifier&rsquo;s own <span className="evidence text-ink-3">match</span> flag.
                It recomputes <span className="evidence text-ink-3">pre === post_rollback</span> itself, so an engine
                bug or a forged payload cannot open the door.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Closing                                                                     */
/* -------------------------------------------------------------------------- */

function Closing() {
  return (
    <section className="blueprint relative overflow-hidden border-t border-hairline">
      <div className="fade-b absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-[1160px] px-5 py-24 sm:px-8 md:py-32">
        <Reveal>
          <div className="mx-auto max-w-[46ch] text-center">
            <p className="legend">Build the agent you would trust with root</p>
            <p className="subhead mt-5 text-ink">
              AIRLOCK is an agent that behaves as though it is <span className="text-ice">not</span> trusted with
              root — and proves it, every single time, before it asks.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
              <Link
                href="/console"
                className="inline-flex h-11 items-center rounded-[5px] border border-ice-dim bg-ice-bg px-5 text-[13px] font-medium text-ice transition-colors hover:bg-ice-deep"
              >
                Open the console
              </Link>
              <Link
                href="/control"
                className="inline-flex h-11 items-center rounded-[5px] border border-hairline-2 bg-raised-2 px-5 text-[13px] font-medium text-ink transition-colors hover:border-hairline-3 hover:bg-raised-3"
              >
                See the control room
              </Link>
            </div>
            <p className="mt-6 text-[11.5px] leading-relaxed text-ink-4">
              Clone it, <span className="evidence text-ink-3">npm install</span>, and the console seeds itself with a
              live approval queue — no database, no API key, no signup.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

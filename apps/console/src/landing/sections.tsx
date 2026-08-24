'use client';

import {
  CAPABILITIES,
  CAPABILITY_TOTAL,
  CHANGE_CLASSES,
  CHANGE_CLASS_COPY,
  DEFAULT_POLICY,
  capabilitiesByGroup,
  resolvedRules,
  type ChangeClass,
} from '@airlock/contract';
import { Lamp, cx } from '@/design/primitives';
import { ChecksumTriple } from '@/certificate/ChecksumTriple';
import { Code, Reveal } from './chrome';

/* -------------------------------------------------------------------------- */
/* §03 — the two certificates                                                  */
/* -------------------------------------------------------------------------- */

const MATCHING = {
  pre: `sha256:${'d532cbba70f7dccf7984d0ceb690c46c317d7e4ba9f3b0142b22438c9cb3c6da'}`,
  post: `sha256:${'c297219d34d482aed5085f64d14d2b4d303d1d250acf85e1688b38f18d21fe71'}`,
  post_rollback: `sha256:${'d532cbba70f7dccf7984d0ceb690c46c317d7e4ba9f3b0142b22438c9cb3c6da'}`,
  match: true,
} as const;

export function Certificates() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Reveal className="h-full">
        <article className="panel milled flex h-full flex-col p-5">
          <div className="flex items-baseline gap-2.5">
            <span className="evidence rounded-[3px] border border-seal/35 bg-seal-bg px-1.5 py-[3px] text-[10px] text-seal">
              UNDO
            </span>
            <h3 className="text-[15px] font-semibold text-ink">The undo certificate</h3>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
            For changes that can be proven reversible. The agent checksums every affected table, applies the change
            to a shadow branch, checksums again, applies its own rollback, and checksums a third time.
          </p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
            It is <span className="text-seal">PROVEN</span> only if the third digest is byte-identical to the first.
            A rollback that mostly restores the data is a failure, not a warning.
          </p>

          <div className="mt-5">
            <ChecksumTriple triple={MATCHING} />
          </div>

          <p className="mt-auto pt-5 text-[11px] leading-relaxed text-ink-4">
            AIRLOCK never trusts the verifier&rsquo;s own <span className="evidence text-ink-3">match</span> flag. The
            gate recomputes <span className="evidence text-ink-3">pre === post_rollback</span> itself, so a bug in the
            engine — or a forged payload — cannot open the door.
          </p>
        </article>
      </Reveal>

      <Reveal delay={80} className="h-full">
        <article className="panel milled flex h-full flex-col p-5">
          <div className="flex items-baseline gap-2.5">
            <span className="evidence rounded-[3px] border border-hazard/40 bg-hazard-bg px-1.5 py-[3px] text-[10px] text-hazard">
              SCOPE
            </span>
            <h3 className="text-[15px] font-semibold text-ink">The scope certificate</h3>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
            For changes that are genuinely irreversible — an erasure, a refund, forty thousand emails. You cannot
            prove a deletion reversible, so the agent proves the opposite thing: exactly what will be destroyed,
            across every system, and nothing else.
          </p>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
            Plus the part reviewers actually read — an explicit list of what it is{' '}
            <span className="text-ink">deliberately not touching</span>, and the obligation that justifies each
            exclusion.
          </p>

          <div className="mt-5 overflow-hidden rounded-[5px] border border-hairline bg-void">
            <div className="border-b border-hairline px-3 py-1.5">
              <span className="legend">Exclusions — deliberately retained</span>
            </div>
            {[
              {
                table: 'invoices',
                count: 12,
                reason:
                  'Seven-year statutory retention under UK VAT rules. Personal fields are redacted in place; the financial record cannot lawfully be destroyed.',
              },
              {
                table: 'fraud_signals',
                count: 3,
                reason:
                  'Retained under the legitimate-interest basis recorded in the DPIA. Erasing it removes the evidence that a chargeback pattern was investigated.',
              },
              {
                table: 'airlock-backups',
                count: 4,
                reason:
                  'Immutable snapshots older than the request. They expire on their own 35-day schedule; forcing deletion breaks the restore chain for every other customer.',
              },
            ].map((e, i) => (
              <div key={e.table} className={cx('px-3 py-2.5', i > 0 && 'border-t border-hairline')}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="evidence text-[11px] text-seal">{e.table}</span>
                  <span className="evidence text-[10px] text-ink-4">{e.count} kept</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{e.reason}</p>
              </div>
            ))}
          </div>

          <p className="mt-auto pt-5 text-[11px] leading-relaxed text-ink-4">
            The contract refuses an exclusion with no stated reason:{' '}
            <span className="evidence text-ink-3">
              .min(1, &lsquo;an exclusion without a stated reason is not an exclusion&rsquo;)
            </span>
          </p>
        </article>
      </Reveal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §04 — what it governs                                                       */
/* -------------------------------------------------------------------------- */

/** Which certificate each class must carry, read from the shipped policy. */
const CLASS_TONE: Record<ChangeClass, 'seal' | 'hazard'> = {
  SCHEMA_MIGRATION: 'seal',
  DATA_OPERATION: 'seal',
  ERASURE: 'hazard',
  ACCESS_GRANT: 'hazard',
  MONEY_MOVEMENT: 'hazard',
  COMMS_BLAST: 'hazard',
  INFRA_MUTATION: 'hazard',
};

const CLASS_EXAMPLE: Record<ChangeClass, string> = {
  SCHEMA_MIGRATION: 'Drop the deprecated column, once the backfill has caught up.',
  DATA_OPERATION: 'Every EU invoice before January was stored in the wrong currency.',
  ERASURE: 'A right-to-erasure request, across Postgres, Stripe, Slack and object storage.',
  ACCESS_GRANT: 'The on-call engineer needs production read access for this incident.',
  MONEY_MOVEMENT: 'Refund the duplicate charge to 1,046 customers.',
  COMMS_BLAST: 'Tell 61,400 people about the refund before they see their statement.',
  INFRA_MUTATION: 'Scale the replica pool down now the migration has finished.',
};

export function Classes() {
  const rules = new Map(resolvedRules(DEFAULT_POLICY).map((r) => [r.cls, r.rule]));

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CHANGE_CLASSES.map((cls, i) => {
        const rule = rules.get(cls)!;
        const tone = CLASS_TONE[cls];
        return (
          <Reveal key={cls} delay={i * 45}>
            <article className="panel milled flex h-full flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13.5px] font-semibold text-ink">{CHANGE_CLASS_COPY[cls].title}</h3>
                <span
                  className={cx(
                    'evidence shrink-0 rounded-[3px] border px-1.5 py-[3px] text-[9.5px]',
                    tone === 'seal' ? 'border-seal/35 bg-seal-bg text-seal' : 'border-hazard/40 bg-hazard-bg text-hazard',
                  )}
                >
                  {rule.requires}
                </span>
              </div>

              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">{CHANGE_CLASS_COPY[cls].blurb}</p>
              <p className="mt-3 border-l border-hairline-2 pl-2.5 text-[11.5px] leading-relaxed text-ink-2 italic">
                {CLASS_EXAMPLE[cls]}
              </p>

              <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 pt-4 text-[10.5px]">
                <dt className="text-ink-4">approvers</dt>
                <dd className="evidence text-right text-ink-2">{rule.quorum}</dd>
                <dt className="text-ink-4">proof valid</dt>
                <dd className="evidence text-right text-ink-2">{Math.round(rule.freshness_seconds / 60)} min</dd>
                {rule.max_people !== null ? (
                  <>
                    <dt className="text-ink-4">people cap</dt>
                    <dd className="evidence text-right text-ink-2">{rule.max_people.toLocaleString()}</dd>
                  </>
                ) : null}
                {rule.max_records !== null ? (
                  <>
                    <dt className="text-ink-4">record cap</dt>
                    <dd className="evidence text-right text-ink-2">{rule.max_records.toLocaleString()}</dd>
                  </>
                ) : null}
                {rule.max_amount_minor !== null ? (
                  <>
                    <dt className="text-ink-4">amount cap</dt>
                    <dd className="evidence text-right text-ink-2">
                      £{(rule.max_amount_minor / 100).toLocaleString('en-GB')}
                    </dd>
                  </>
                ) : null}
                {rule.require_expiry ? (
                  <>
                    <dt className="text-ink-4">expiry</dt>
                    <dd className="text-right text-[10px] text-hazard">always required</dd>
                  </>
                ) : null}
                {rule.blackout.length > 0 ? (
                  <>
                    <dt className="text-ink-4">freeze</dt>
                    <dd className="text-right text-[10px] text-hazard">
                      {rule.blackout[0]!.from}–{rule.blackout[0]!.to}
                    </dd>
                  </>
                ) : null}
              </dl>
            </article>
          </Reveal>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §05 — policy                                                                */
/* -------------------------------------------------------------------------- */

export function Policy() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Reveal>
        <div className="space-y-4">
          <div className="panel milled p-5">
            <h3 className="text-[14px] font-semibold text-ink">A proof is a perishable good</h3>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
              A certificate is a statement about a database at an instant, and databases move. Past its freshness
              window it describes a system that no longer exists, and the gate refuses it — ten minutes for an access
              grant, thirty for a migration.
            </p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
              AIRLOCK also re-checksums production before opening the gate. If it has moved since the proof was taken,
              the change is sealed as <span className="evidence text-fault">PRODUCTION_DRIFTED</span> — even when the
              drift checker itself reported everything was fine.
            </p>
          </div>

          <div className="panel milled p-5">
            <h3 className="text-[14px] font-semibold text-ink">A quorum counts people, not clicks</h3>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
              Irreversible classes need two distinct approvers, and neither of them may be the person who asked. The
              same approver signing twice is one approver, because the signatures are stored by identity rather than
              counted.
            </p>
            <Code caption="packages/contract/src/policy.ts">{`ERASURE: {
  requires: 'SCOPE',
  quorum: 2,
  freshness_seconds: 900,
  max_people: 1_000,
  break_glass: false,
  note: 'Two people, because there is no rollback.',
}`}</Code>
          </div>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="panel milled overflow-hidden">
          <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
            <span className="legend">The shipped policy</span>
            <div className="h-px flex-1 bg-hairline" />
            <span className="evidence text-[10px] text-ink-4">{DEFAULT_POLICY.name} v{DEFAULT_POLICY.version}</span>
          </div>

          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[440px] text-left">
              <thead>
                <tr className="border-b border-hairline">
                  {['Class', 'Cert', 'Approvers', 'Fresh', 'Glass'].map((h) => (
                    <th key={h} className="legend px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resolvedRules(DEFAULT_POLICY).map(({ cls, rule }) => (
                  <tr key={cls} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-2 text-[11.5px] text-ink">{CHANGE_CLASS_COPY[cls].title}</td>
                    <td className="evidence px-3 py-2 text-[10.5px] text-ink-2">{rule.requires}</td>
                    <td className="evidence px-3 py-2 text-[11px] text-ink-2">{rule.quorum}</td>
                    <td className="evidence px-3 py-2 text-[10.5px] text-ink-3">
                      {Math.round(rule.freshness_seconds / 60)}m
                    </td>
                    <td className="px-3 py-2">
                      <span className={cx('text-[10.5px]', rule.break_glass ? 'text-hazard' : 'text-ink-4')}>
                        {rule.break_glass ? 'permitted' : 'no'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-hairline px-4 py-3">
            <p className="text-[11px] leading-relaxed text-ink-4">
              Note what is <span className="text-ink-3">absent</span>: there is no change freeze on erasure, money or
              access. A freeze that blocks a right-to-erasure request trades a legal problem for an operational one,
              and one that blocks an access grant locks the on-call engineer out during the incident the freeze exists
              to prevent. The test suite asserts this, so it cannot be quietly reversed.
            </p>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §06 — the harness                                                           */
/* -------------------------------------------------------------------------- */

export function Harness() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <Reveal>
        <div className="space-y-4">
          <div className="panel milled p-5">
            <h3 className="text-[14px] font-semibold text-ink">Every lamp below is dark, on purpose</h3>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
              This is the registry, not a run. A lamp lights only when a real TrueForge event proves its capability,
              and no event has crossed this page. Lighting them here would make the panel a graphic.
            </p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-2">
              In the console they light one at a time as the agent works, each with a timestamp and a link to the step
              that proved it. A run that never exercises a capability ends below {CAPABILITY_TOTAL}, and that is the
              correct outcome.
            </p>
          </div>

          <div className="panel milled p-5">
            <div className="legend mb-2">The only writer</div>
            <Code caption="apps/console/src/server/observedServer.ts">{`for await (const data of inner) {
  try { observe(data.event) }   // may not throw
  catch { /* never break chat */ }
  yield data                    // unmodified, in order
}`}</Code>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-4">
              A passthrough tap on the real event stream. Events are observed on the way past and yielded onward
              untouched — never synthesised, re-ordered or dropped. Remove the wrapper and the console still works; it
              just stops being able to prove anything.
            </p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={80}>
        <div className="panel milled overflow-hidden">
          <div className="flex items-baseline gap-3 border-b border-hairline px-4 py-3">
            <span className="legend">Harness</span>
            <div className="h-px flex-1 bg-hairline" />
            <span className="evidence text-[15px] text-ink-4">00</span>
            <span className="evidence text-[11px] text-ink-4">/ {CAPABILITY_TOTAL}</span>
          </div>

          <div className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-2">
            {capabilitiesByGroup().map(({ group, items }) => (
              <div key={group} className="mb-2">
                <div className="flex items-center gap-2 pt-2 pb-1.5">
                  <span className="legend !text-[9.5px]">{group}</span>
                  <div className="h-px flex-1 bg-hairline" />
                  <span className="evidence text-[10px] text-ink-4">0/{items.length}</span>
                </div>
                <ul className="space-y-[3px]">
                  {items.map((c) => (
                    <li key={c.id} className="flex items-center gap-2.5" title={c.loadBearing}>
                      <Lamp lit={false} tone="ice" />
                      <span className="flex-1 truncate text-[11px] text-ink-4">{c.name}</span>
                      <span className="evidence text-[9.5px] text-ink-4">——</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-hairline px-4 py-2.5">
            <p className="text-[10px] leading-snug text-ink-4">
              {CAPABILITIES.length} capabilities, each load-bearing — remove it and the product stops working. Source:{' '}
              <span className="evidence text-ink-3">packages/contract/src/detectors.ts</span>
            </p>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §08 — how it is built                                                       */
/* -------------------------------------------------------------------------- */

const PIECES = [
  {
    title: 'The console is the SDK',
    body: 'Not a lookalike built beside it. TrueForgeUI accepts a custom layout rendered inside its own provider stack, so the transcript, composer, thread list, tool-approval cards and MCP OAuth screen are all @truefoundry/trueforge-ui components, rethemed.',
    file: 'src/console/AirlockShell.tsx',
  },
  {
    title: 'The gate is a type',
    body: 'The Approve control accepts an ApprovalGrant, which carries a module-private symbol only openGate can mint. Four attempts to forge one are asserted as compile errors — weaken the type and tsc reports an unused @ts-expect-error, and the build fails.',
    file: 'packages/contract/src/gate.ts',
  },
  {
    title: 'The agent has one doorway',
    body: 'AIRLOCK ships as an MCP server. Production connectors are read-only, and the only tool that moves a change forward is airlock_request_approval — held by the harness for a human. There is deliberately no apply tool.',
    file: 'packages/mcp/src/tools.ts',
  },
  {
    title: 'The rule runs twice',
    body: 'The same gate re-runs server-side against the stored dossier before anything is written, so approving through the HTTP API with no browser involved is refused identically — with the machine-readable reason attached.',
    file: 'apps/console/src/data/dossierStore.ts',
  },
];

export function Build() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {PIECES.map((p, i) => (
        <Reveal key={p.title} delay={i * 50}>
          <article className="panel milled flex h-full flex-col p-5">
            <h3 className="text-[14px] font-semibold text-ink">{p.title}</h3>
            <p className="mt-2.5 flex-1 text-[12.5px] leading-relaxed text-ink-2">{p.body}</p>
            <a
              href={`https://github.com/Rohit-ATS/Airlock/blob/main/${p.file.startsWith('src/') ? `apps/console/${p.file}` : p.file}`}
              target="_blank"
              rel="noreferrer"
              className="evidence mt-4 text-[10.5px] text-ice transition-colors hover:underline"
            >
              {p.file}
            </a>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

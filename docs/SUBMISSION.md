# Submission

The written description for the TrueForge Agent Harness Hackathon, and the evidence behind
each claim in it.

---

## One line

**AIRLOCK is a change-control console for irreversible production work: the agent proves a
change against a shadow copy before it is allowed to ask a human anything.**

## The description

TrueFoundry's brief closed with *"build the agent you would trust with root."* AIRLOCK is the
literal answer — an agent that behaves as though it is **not** trusted with root, and proves it
every time before it asks.

Every other approval gate is *"the agent says it is going to do X — click yes."* That asks a
human to trust a plan. AIRLOCK's gate cannot be offered until the agent holds a **certificate**,
and there are two kinds. For a reversible change, an **undo certificate**: the agent applies the
change to a shadow branch, applies its own rollback, and checksums the affected tables a third
time to prove the data came back byte-identical. For a genuinely irreversible one — an erasure,
a refund, forty thousand emails — you cannot prove reversibility, so it proves the opposite
thing: a **scope certificate** listing exactly what will be destroyed across every system, plus
an explicit list of what it is deliberately keeping and the obligation that justifies each
exclusion.

The rule is not a conditional in a component. The Approve control accepts an `ApprovalGrant`,
which carries a module-private symbol only `openGate()` can mint. There is no value a developer
could pass to render an approval for an unproven change — six attempts to forge one are
asserted as compile errors, so weakening the type fails the build. The same gate re-runs
server-side, so approving through the HTTP API with no browser involved is refused identically.

On top of the proof sits a **policy layer**, because the certificate answers *"is this change
what it claims to be"* and an organisation needs to answer *"is it allowed, by whom, and right
now."* Seven change classes, each with a required certificate kind, a quorum that counts people
rather than clicks, a freshness window past which a proof is stale, ceilings on records, people
and money, a rule that no production access may be granted without an expiry, and change
freezes evaluated in wall-clock time. Before opening the gate AIRLOCK re-checksums production
against the state the proof was taken from — if somebody else's migration landed in between,
the change is sealed, *even when the drift checker itself reported everything was fine*.

Decided changes are sealed into a hash chain, so editing the audit log is detectable by anyone
holding an older copy of a single hash. The landing page runs that verification in the reader's
own browser and lets them rewrite a record to watch it break.

AIRLOCK ships as an **MCP server**, which is what makes least privilege structural rather than
aspirational. Production connectors are mounted read-only; the agent can read the policy, open a
change, attach a proof and ask a human, and that is the entire set of verbs it has. There is no
tool that applies a change to production, and the one tool that moves a change forward is listed
in `require_approval_for_tools`, so the harness holds it until a person answers. Because
TrueForge subagents inherit the root agent's MCP scope, that guarantee extends to every subagent
automatically: **no principal in the run can reach production without a human.**

The console is not a lookalike built beside the SDK. `TrueForgeUI` accepts a custom layout
rendered inside its own provider stack, so the transcript, composer, thread list, tool-approval
cards, ask-user cards and MCP OAuth screen are all `@truefoundry/trueforge-ui`'s own components,
rethemed.

---

## Mapping to the judging criteria

Six equally-weighted criteria. What to point at for each.

### Potential impact

Not a demo of a database tool — a control plane for any irreversible action an agent wants to
take. Seven classes ship: schema migrations, bulk data operations, erasure, production access
grants, money movement, outbound comms, infrastructure mutation. The gate, the policy engine and
the ledger do not care which system a record lives in, so adding an eighth is a contract entry
and a skill pack.

The problem is real and current: every team wiring an agent to production is currently choosing
between *"let it write"* and *"let it do nothing useful"*. AIRLOCK is the third option.

### Creativity and originality

The central idea — **an approval gate that cannot be offered until the agent has already done
the thing and undone it** — is not the standard human-in-the-loop pattern. The standard pattern
approves a plan. This approves a result.

Three consequences that fall out of it and are, as far as we know, not done elsewhere:

- **The invariant is a type.** Not a lint rule, not a code review convention — a private symbol
  that makes the unsafe state unrepresentable, with the forgeries asserted as compile errors.
- **A proof is treated as perishable.** Certificates expire, and production is re-checksummed
  before the gate opens.
- **Break-glass exists and cannot become an approval.** It carries a different witness type, so
  the ledger can always tell the two apart. Most systems either forbid the override (and people
  do it out of band with no record) or allow it (and it becomes indistinguishable from an
  approval).

### Technical excellence

- `packages/contract/src/gate.ts` — the invariant, with the runtime and compile-time halves.
- `packages/contract/src/policy.ts` — timezone-correct change freezes, quorum by identity,
  ceilings normalised so one number means the same thing across seven classes.
- `packages/contract/src/receipt.ts` — an isomorphic hash chain on the Web Crypto API, so the
  same code verifies on the server and in the browser.
- `packages/mcp/` — a hand-written MCP server, ~250 lines, with correct tool annotations so
  TrueForge's `@read-only` / `@destructive` selectors work.
- `apps/console/src/server/observedServer.ts` — a passthrough tap on the real event stream that
  cannot synthesise, re-order or drop an event.

**92 tests, 11 fixtures, 4 agent specs, all checked in CI.** The suites pin properties, not
implementations: no non-`PROVEN` certificate opens the gate under any combination of class,
status and viewer; a quorum counts people; editing a sealed record is detected at the record
where it happened; exactly one MCP tool is destructive and it is the one held for approval.

Two upstream bugs in `@truefoundry/trueforge-ui@0.2.4` were found, isolated and worked around —
including a cascade-layer ordering problem that silently breaks **every responsive variant** in
any host app that imports its stylesheet. Both are written up for the sponsor.

### Use of sponsor tools

Twenty-two TrueForge capabilities, each one load-bearing, listed with the exact signal that
proves it in [`docs/CAPABILITIES.md`](CAPABILITIES.md).

The honesty rule matters more than the number: **a lamp cannot be lit from application code.**
The only writer is the detector module, fed by the passthrough tap on the real event stream. A
run that does not exercise a capability ends below 22, and the panel says so. On the landing
page every lamp is dark, because no run has happened there.

Three detectors depend on signals we could not confirm from the documentation and are listed as
unverified. **An honest 19/19 beats a padded 22/22 that a judge disproves by clicking one lamp.**

### Control and safety

This is the whole product, so the list is long, but the four that matter most:

1. **No tool applies a change to production.** The agent's only forward path is held by the
   harness, and subagents inherit that scope.
2. **The gate is unrepresentable when sealed** — not disabled, not hidden.
3. **Nothing self-reported is trusted.** Not the verifier's `match` flag, not the drift
   checker's `drifted: false`, not the `final` flag on a grant the client touched. Each is
   recomputed server-side. A claim of danger is believed; a claim of safety is checked.
4. **The audit log is tamper-evident**, and individual receipts verify offline with no access
   to the console.

Plus: separation of duties (the requester can never approve), a two-person rule on every
irreversible class, no standing production access, and change freezes that are deliberately
*absent* from erasure, money and access — because a freeze that blocks a statutory obligation
trades a legal problem for an operational one. That absence is asserted in the test suite so it
cannot be quietly reversed.

### Presentation

Three surfaces, one design system:

- `/` — the argument, with two places the reader can operate the real thing: a live gate running
  the actual `openGate()`, and a hash chain they can break in their own browser.
- `/console` — DOING / WAITING / DID, named exactly as the rubric asks.
- `/control` — the fleet view, whose headline number is what the gate **refused**.

Design rules that hold everywhere: evidence is monospaced with tabular figures so digits line up
and a changing number never reflows; **one alarm colour**, used for irreversibility and nothing
else; depth from hairlines and background steps, never drop shadows. Reduced-motion is honoured
throughout.

---

## What is honestly not done

Stated plainly, because a judge will find it anyway and finding it in this list is much better
than finding it on screen.

- **The verification engine is the other half of the team's work.** The eleven changes in the
  seeded queue are console fixtures — they exercise the card, the queue, the policy engine and
  the ledger. They are not evidence about anybody's database, and the README says so in those
  words.
- **Three capability detectors are unverified** against a live harness: the Code Mode tool name,
  the large-result offload marker, and whether a compaction event is emitted.
- **Hosted mode has not been exercised on the development machine**, which is Windows, where
  TrueForge 0.1.4 does not start natively. Capabilities 17 and 21 are implemented against the
  documented API and will light on a real hosted run.
- **Three things in the original plan turned out to rest on API that does not exist** —
  per-subagent tool scoping, per-subagent model routing, and declared subagents. They are built
  differently rather than faked, and the substitutes are documented in
  [`docs/TRUEFORGE-NOTES.md`](TRUEFORGE-NOTES.md) §4.

---

## Links

| | |
| --- | --- |
| Repository | https://github.com/Rohit-ATS/Airlock |
| Demo runbook | [`docs/DEMO.md`](DEMO.md) |
| Policy, generated from the source | [`docs/POLICY.md`](POLICY.md) |
| Capabilities, generated from the registry | [`docs/CAPABILITIES.md`](CAPABILITIES.md) |
| Verified harness notes, and what we got wrong | [`docs/TRUEFORGE-NOTES.md`](TRUEFORGE-NOTES.md) |
| The invariant | [`packages/contract/src/gate.ts`](../packages/contract/src/gate.ts) |
| The agent's only doorway | [`packages/mcp/src/tools.ts`](../packages/mcp/src/tools.ts) |

## Team

**Rohit Maruri** — the console, the landing page, the control room, the Harness Panel, the
certificate card, the gate, the policy engine, the tamper-evident ledger, the MCP server, the
agent definitions and skill packs, the contract, the webhook and roles.

**Damir** — the verification engine, shadow branch lifecycle, scope computation across systems,
the seed dataset.

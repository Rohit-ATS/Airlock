# AIRLOCK

**Nothing reaches production without passing through the airlock.**

A change-control console for irreversible production work. Every dangerous change — a schema
migration, a bulk data correction, a right-to-erasure request, a refund, a production access
grant, forty thousand emails — is requested in English, executed first against a shadow copy
of the real system, **proven** in a sandbox, and only then presented to a human for approval,
with the evidence attached.

Built on [TrueForge](https://trueforge.dev) for the Agent Harness Hackathon, 24–30 August 2026.

---

## The idea in one rule

TrueFoundry's closing line on the hackathon page is *"build the agent you would trust with
root."* AIRLOCK is the literal answer: an agent that behaves as though it is **not** trusted
with root, and proves it every time before it asks.

Every other approval gate is *"the agent says it is going to do X — click yes."* That asks a
human to trust a **plan**. AIRLOCK's gate cannot be offered until the agent has produced a
**certificate**, and there are two kinds:

**The Undo Certificate** — for reversible changes. The agent applies the change to a shadow
branch, applies its own rollback, then checksums the tables a third time and proves the data
returned byte-identical to where it started. *It already did it, and un-did it, and here are
the matching checksums. Now it may ask.*

**The Scope Certificate** — for genuinely irreversible changes. You cannot prove a deletion
reversible, so the agent proves the opposite thing: exactly what will be destroyed, across
every system, and nothing else — plus an explicit exclusion list of what it is deliberately
not touching and why. *It cannot promise you can undo this. It can promise it knows exactly
what "this" is.*

```
certificate.status !== "PROVEN"  →  the approval gate is never offered.
```

Not greyed out. Not warned about. **Never rendered.**

### That rule is a type, not an `if`

The Approve control accepts an `ApprovalGrant`. `ApprovalGrant` carries a module-private
symbol that only `openGate()` can mint, so there is no value a developer could pass to render
an approval for an unproven change — not by mistake, not deliberately without editing the
gate itself.

```ts
// packages/contract/src/gate.ts
const GATE_WITNESS: unique symbol = Symbol('airlock.gate.witness');

export interface ApprovalGrant {
  readonly [GATE_WITNESS]: true;   // unforgeable outside this module
  readonly irreversible: boolean;
  readonly seals_required: number;
  readonly final: boolean;
  // …
}
```

Six attempts to forge one are asserted as compile errors in
[`gate.typetest.ts`](packages/contract/src/gate.typetest.ts). If anyone weakens the type, the
expected errors disappear, `tsc` reports an unused `@ts-expect-error`, and **the build fails.**

The same rule runs again server-side. Approving through the HTTP API, with no browser
involved, is refused identically:

```console
$ curl -XPOST localhost:3000/api/dossiers/dos_currency_fix/decision -d '{"decision":"approved"}'
{"error":"CERTIFICATE_FAILED","message":"Verification ran and failed. This change cannot be approved from this dossier."}
403

$ # …and a dossier that lies, claiming match:true with checksums that differ:
{"error":"CHECKSUM_MISMATCH","message":"The data did not return to its starting state after rollback."}
403
```

AIRLOCK never trusts the verifier's own `match` flag. It recomputes `pre === post_rollback`
itself, so an engine bug or a forged payload cannot open the door.

> **Try it without installing anything.** The landing page carries a live gate: it builds a
> real Change Dossier from a set of controls and passes it to the real `openGate()`. Every
> combination is a genuine evaluation. See if you can find one that opens a door it shouldn't.

---

## Run it

```bash
git clone https://github.com/Rohit-ATS/Airlock && cd Airlock
npm install
npm run build --workspace @airlock/contract
npm run dev --workspace @airlock/console
```

| Route | What it is |
| --- | --- |
| [`/`](http://localhost:3000) | The front door — the argument, with two live demos in it |
| [`/console`](http://localhost:3000/console) | The operator console: DOING / WAITING / DID |
| [`/control`](http://localhost:3000/control) | The control room: posture, refusals, ledger integrity |

The console seeds itself from [`contracts/examples/`](contracts/examples) on first run, so you
land on a live approval queue with **eleven real changes** — two ready to approve, six sealed
for six different reasons, and three decided records sealed into a hash chain — without a
database, an API key, or a signup.

> Those eleven are **console fixtures**. They exercise the certificate card, the queue, the
> policy engine and the ledger. They are not evidence about anybody's database, and the
> undecided ones are re-based to the current time when they are seeded, because a certificate
> has a freshness window and a permanently-expired demo demonstrates nothing.
> `AIRLOCK_NO_SEED=1` starts empty.

To drive the agent rather than the fixtures, point it at a TrueForge server:

```bash
npx @truefoundry/trueforge@latest              # http://localhost:8790
NEXT_PUBLIC_TRUEFORGE_BASE_URL=http://localhost:8790 npm run dev --workspace @airlock/console
```

**On Windows, use Docker.** TrueForge `0.1.4` does not start natively on Windows (`Only URLs
with a scheme in: file, data, and node are supported… Received protocol 'c:'`), and its local
sandbox fallback is macOS/Linux only. See [docs/TRUEFORGE-NOTES.md](docs/TRUEFORGE-NOTES.md).

---

## What a judge is looking at

### The agent has exactly one doorway

AIRLOCK ships as an **MCP server** ([`packages/mcp`](packages/mcp)). Mounting it is what makes
least privilege structural rather than aspirational:

```json
{ "name": "airlock",
  "command": "npx", "args": ["-y", "@airlock/mcp"],
  "enable_tools": ["@all"],
  "require_approval_for_tools": ["airlock_request_approval"] }
```

The agent can read the policy, open a change, attach a proof and ask a human. That is the
entire set of verbs it has. **There is no tool that applies a change to production**, and the
one tool that moves a change forward is held by the harness until a person answers.

Production connectors are mounted `@read-only` alongside it, and because TrueForge subagents
inherit the root agent's MCP scope, the guarantee extends to every subagent automatically:
**no principal in the run can reach production without a human.** That is asserted by
[`scripts/check-agents.mjs`](scripts/check-agents.mjs) in CI, so it cannot drift.

### Seven classes of change

The test for admission is not *"is it a database write"* but *"if this goes wrong, can you
take it back?"* Sending forty thousand emails is as irreversible as dropping a column, and
considerably harder to apologise for.

| Class | Certificate | Approvers | Ceiling |
| --- | --- | --- | --- |
| Schema migration | UNDO | 1 | — |
| Data operation | UNDO | 1 | 5,000,000 records |
| Erasure | SCOPE | 2 | 1,000 people |
| Access grant | SCOPE | 2 | every grant must expire |
| Money movement | SCOPE | 2 | £25,000 |
| Comms blast | SCOPE | 2 | 50,000 people, quiet hours enforced |
| Infrastructure mutation | either | 2 | Friday-to-Monday change freeze |

### Policy: the second question

The certificate answers *"is this change what it claims to be?"*. Policy answers a different
one: *"is this change allowed at all, by whom, and right now?"* A proof cannot answer that,
because it is not a property of the change — it is a property of the organisation.

Both are evaluated by the same `openGate`, so a change that is genuinely proven and genuinely
not permitted is sealed for the second reason and told so precisely. Full detail in
[docs/POLICY.md](docs/POLICY.md), generated from the policy so the two cannot disagree.

Four rules worth calling out:

- **A proof is a perishable good.** Past its freshness window a certificate describes a
  system that no longer exists. Ten minutes for an access grant, thirty for a migration.
- **Production drift.** Before opening the gate AIRLOCK re-checksums production against the
  state the proof was taken from. If somebody else's migration landed in between, the change
  is sealed — *even when the drift checker itself reported everything was fine.* A claim of
  danger is believed; a claim of safety is recomputed.
- **A quorum counts people, not clicks.** Signatures are stored by identity, so the same
  approver signing twice is one approver — and the person who asked for a change can never be
  one of them.
- **No standing production access.** Every grant must carry an expiry, so the default state
  of the system is that nobody has the keys.

### The ledger is tamper-evident

A change-control system whose audit log can be edited is change-control theatre. Every decided
change is sealed with the hash of the one before it, so editing any historical record breaks
every link after it:

```console
$ npm run verify:ledger
  ok  #000  dos_orders_index         a41f9c02be7d8e5f31c4…
  FAIL #001  dos_gdpr_batch          9e02cc71a4bb0d3f2871…
         fault      : content-modified
FAIL — the chain breaks at record 1. Every record after that point is no longer trustworthy.
```

This does not make the ledger unforgeable — anyone who can rewrite the file can recompute the
whole chain. What it makes is **tampering visible** to anyone holding an older copy of a
single hash, which is the property that matters, because the person auditing you is not the
person who edited it.

Individual receipts detach and verify on their own, with no access to the console:
`GET /api/dossiers/{id}/receipt` → `node scripts/verify-ledger.mjs receipt.json`.

The landing page runs this in your browser. Rewrite a record and watch the chain break.

### The three-zone console

The Savile Row rubric asks for an interface that shows what the agent **is doing**, what it is
**waiting on**, and what it **did** — and asks before the irreversible step. So those are the
three zones, named exactly that.

- **DOING** — the live run: subagent lanes in parallel, each with its model and running cost,
  the sandbox log streaming underneath, tool calls resolving in real time.
- **WAITING** — the approval queue: every change holding for a human, what it is blocked on,
  how many signatures it still needs, and how long it has been held.
- **DID** — the immutable change ledger: who requested, who approved, which certificate,
  which checksums, and the receipt that seals it.

### The control room

`/control` is the other audience. Not *"should I approve this one"* but *"what is this system
holding, what has it refused, and can I still trust the record of what it did."*

The headline number is what the gate **refused**, not what it approved — a queue with nothing
in it is not evidence of safety, and a count of changes stopped, with reasons, is. It also
re-verifies the ledger **in the browser** rather than trusting a server that says it is fine.

### The Harness Panel

A persistent rail listing all 22 TrueForge capabilities. Each is dim until a **real harness
event** proves it, then lights with a timestamp and a link to the step that proved it.

**A lamp cannot be lit from application code.** The only writer is
[`detectors.ts`](packages/contract/src/detectors.ts), fed by a passthrough observer wrapped
around the real TrueForge event stream in
[`observedServer.ts`](apps/console/src/server/observedServer.ts). Events are observed and
yielded onward unmodified — never synthesised, re-ordered or dropped. A run that does not
exercise a capability ends below 22, and that is the correct outcome.

Unlit rows stay legible on purpose. Hiding what did not happen would make the counter
meaningless; showing it is what makes the lit ones worth believing. On the landing page every
lamp is dark, because no run has happened there.

See [docs/CAPABILITIES.md](docs/CAPABILITIES.md) — generated from the registry, so what we
claim and what the panel can prove cannot drift.

### The Certificate card

Verdict banner, magnitude, the policy in force and its objections, signatures, forward and
rollback operations side by side, affected tables with real row counts, lock profile and
table-rewrite warning, the checksum triple, the drift check, the blast radius across the
codebase, the exclusion list, run cost by model, the receipt, and the decision.

The checksum triple is the argument made visible: lines 1 and 3 are bracketed together, line 2
is deliberately de-emphasised because it is *expected* to differ, and on a mismatch the exact
character where the hashes diverge is highlighted rather than printing a red X.

### Break-glass

Policy-gated, off by default, and it does **not** open the gate — `BreakGlassOverride` carries
a different private symbol from `ApprovalGrant`, and no function accepts both. What it does is
record that a named human went around a sealed door, with a written reason of at least 40
characters, permanently, in the same hash chain as everything else.

The argument for having it: people do this anyway. In every organisation there is a moment
where the safe path is unavailable and somebody opens a psql session instead. A control plane
that pretends otherwise does not prevent the override — it only ensures there is no record of
it. Two switches are required to enable it, and `ERASURE`, `MONEY_MOVEMENT` and `COMMS_BLAST`
forbid it outright.

---

## Architecture

```
contracts/dossier.schema.json     the Change Dossier — the one contract everything shares
packages/contract/                types, the gate, policy, receipts, capabilities, detectors
  src/gate.ts                     the invariant, as an unforgeable type
  src/policy.ts                   quorum, ceilings, freshness, freezes, no standing access
  src/receipt.ts                  the tamper-evident hash chain, isomorphic
  src/detectors.ts                the ONLY thing that can light a lamp
  src/capabilities.ts             the 22, each with its load-bearing use and its evidence
packages/mcp/                     AIRLOCK as an MCP server — the agent's one doorway
apps/console/                     Next.js 15, React 19, Tailwind v4
  app/page.tsx                    the landing page
  app/console/                    the three-zone operator console
  app/control/                    the control room
  src/server/observedServer.ts    the passthrough tap on the real TrueForge stream
agents/                           four agent specs: least privilege, model routing
skills/                           seven skill packs, one per domain the agent must not improvise
```

**The console *is* the SDK.** `TrueForgeUI` accepts a custom layout component rendered inside
its own provider stack, so AIRLOCK is passed as `layout={AirlockConsole}` — the transcript,
composer, thread list, tool-approval cards, ask-user cards and MCP OAuth screen are all
`@truefoundry/trueforge-ui`'s own components, rethemed. It is not a lookalike built beside it.

---

## Honest notes

Three things in the original plan turned out to rest on API that does not exist, and are built
differently rather than faked. Full detail in [docs/TRUEFORGE-NOTES.md](docs/TRUEFORGE-NOTES.md) §4.

1. **Subagents are dynamic, not declared.** TrueForge spawns them at runtime via
   `create_sub_agent`; the spec has no per-subagent block. So "four named subagents each with
   its own tool scope" is not implementable.
2. **Per-subagent tool scoping does not exist.** The docs are explicit: *"subagents have access
   to the same MCP tools and sandbox environment as the root agent."* AIRLOCK instead enforces
   least privilege at the agent boundary — production connectors mounted `@read-only`, and the
   single forward path being a tool on our own MCP server that the harness holds. Because
   subagents inherit that scope, **no principal in the run can touch production without a
   human.** That is a stronger claim than a smaller toolbox, and it is real.
3. **Per-subagent model routing does not exist** either. Routing is real at the agent boundary
   — see [`airlock-scout`](agents/airlock-scout.agent.json),
   [`airlock-privacy`](agents/airlock-privacy.agent.json) and
   [`airlock-treasury`](agents/airlock-treasury.agent.json) — and the model and cost shown per
   lane are read from real `thread.created.agentInfo.model` and
   `turn.done.state.metrics.total_cost_in_usd`.

Three capability detectors depend on signals we could not confirm from the docs — the Code Mode
tool name, the large-result offload marker, and whether a compaction event is emitted. They are
listed as unverified. If a real run does not prove them, those lamps stay dark and the
denominator drops. **An honest 19/19 beats a padded 22/22 that a judge disproves by clicking
one lamp.**

### Two upstream bugs found

- `@truefoundry/trueforge-ui@0.2.4` has a dependency conflict: `@assistant-ui/core` peer-depends
  on `zustand@^5` while the OpenUI renderers pull `zustand@^4`, which npm hoists. The build
  fails with `'useShallow' is not exported from 'zustand/shallow'`. Worked around with an
  `overrides` block in the root `package.json`.
- Its `styles.css` ships a complete Tailwind utility set in `@layer tfy-agent-ui-utilities`.
  Imported after `tailwindcss`, that layer registers *later*, so the SDK's plain `.hidden` beats
  your `.xl\:flex` regardless of the media query — **silently breaking every responsive variant
  in the host app.** Fixed with an explicit `@layer` order statement in
  [`globals.css`](apps/console/app/globals.css).

---

## Tests

```bash
npm test        # 92 tests, 11 fixtures, 4 agent specs
```

Four suites, and each pins a property rather than an implementation:

| Suite | What it holds down |
| --- | --- |
| `gate.test.mjs` | No non-`PROVEN` certificate opens the gate, under any combination of class, status and viewer |
| `policy.test.mjs` | Quorum counts people; freezes are evaluated in London wall-clock time; a claim of safety is recomputed; break-glass can never become an approval |
| `receipt.test.mjs` | Editing, reordering or deleting a sealed record is detected, at the record where it happened |
| `harness.test.mjs` | Nothing but a real harness event lights a lamp — noise, repeated connectors, and prose that merely *mentions* a chart light nothing |
| `mcp/server.test.mjs` | Exactly one tool is destructive and it is the one held for approval; there is no tool that applies a change |

Plus two structural checks that run in CI:

- `check-fixtures.mjs` — every fixture parses against the contract *and* produces the gate
  verdict its filename implies, so a fixture named `.standing.json` really is refused for
  having no expiry rather than for some unrelated reason nobody noticed.
- `check-agents.mjs` — no production connector is writable, and any agent that can write
  somewhere mounts AIRLOCK and holds precisely one tool for approval.

Generated artefacts (`contracts/dossier.schema.json`, `docs/CAPABILITIES.md`,
`docs/POLICY.md`, the fixtures) come from `npm run gen` and are idempotent, so what the docs
claim and what the code does cannot drift.

---

## Team

**Rohit Maruri** — the console, the landing page, the control room, the Harness Panel, the
certificate card, the gate, the policy engine, the tamper-evident ledger, the MCP server, the
agent definitions and skills, the contract, the webhook and roles.
**Damir** — the verification engine, shadow branch lifecycle, scope computation, seed data.

MIT licensed.

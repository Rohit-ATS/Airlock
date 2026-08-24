# AIRLOCK

**Nothing reaches production without passing through the airlock.**

A change-control console for irreversible production work. Every dangerous change — a schema
migration, a bulk data correction, a right-to-erasure request — is requested in English,
executed first against a shadow copy of the real system, **proven** in a sandbox, and only
then presented to a human for approval, with the evidence attached.

Built on [TrueForge](https://trueforge.dev) for the Agent Harness Hackathon, 24–30 August 2026.

---

## The idea in one rule

TrueFoundry's closing line on the hackathon page is *"build the agent you would trust with
root."* AIRLOCK is the literal answer.

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
  // …
}
```

Four attempts to forge one are asserted as compile errors in
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

---

## Run it

```bash
git clone https://github.com/Rohit-ATS/Airlock && cd Airlock
npm install
npm run build --workspace @airlock/contract
npm run dev --workspace @airlock/console      # http://localhost:3000
```

The console seeds itself from [`contracts/examples/`](contracts/examples) on first run, so you
land on a live approval queue with three real certificates — a proven migration, a failed
rollback, and an erasure — without a database, an API key, or a signup.

> Those three are **console fixtures**. They exercise the certificate card, the queue and the
> ledger. They are not evidence about anybody's database. `AIRLOCK_NO_SEED=1` starts empty.

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

### The three-zone console

The Savile Row rubric asks for an interface that shows what the agent **is doing**, what it is
**waiting on**, and what it **did** — and asks before the irreversible step. So those are the
three zones, named exactly that.

- **DOING** — the live run: subagent lanes in parallel, each with its model and running cost,
  the sandbox log streaming underneath, tool calls resolving in real time.
- **WAITING** — the approval queue: every run holding for a human, what it is blocked on, and
  how long it has been blocked. This is what makes AIRLOCK a product rather than a chat window.
- **DID** — the immutable change ledger: who requested, who approved, which certificate, which
  checksums, when.

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
meaningless; showing it is what makes the lit ones worth believing.

See [docs/CAPABILITIES.md](docs/CAPABILITIES.md) — generated from the registry, so what we
claim and what the panel can prove cannot drift.

### The Certificate card

Verdict banner, forward/rollback SQL side by side, affected tables with real row counts,
estimated lock and table-rewrite warning, the checksum triple, the blast radius across the
codebase, the exclusion list, run cost by model, and the decision.

The checksum triple is the argument made visible: lines 1 and 3 are bracketed together, line 2
is deliberately de-emphasised because it is *expected* to differ, and on a mismatch the exact
character where the hashes diverge is highlighted rather than printing a red X.

---

## Architecture

```
contracts/dossier.schema.json     the Change Dossier — the one contract everything shares
packages/contract/                types, the gate, the capability registry, the detectors
  src/gate.ts                     the invariant, as an unforgeable type
  src/detectors.ts                the ONLY thing that can light a lamp
  src/capabilities.ts             the 22, each with its load-bearing use and its evidence
apps/console/                     the AIRLOCK console (Next.js 15, React 19, Tailwind v4)
  src/server/observedServer.ts    the passthrough tap on the real TrueForge stream
  src/harness/                    run store + the Harness Panel
  src/certificate/                the Certificate card and the checksum triple
  src/console/                    the three-zone layout
agents/                           agent specs: least-privilege scoping, approval policy
skills/                           postgres-safety, expand-contract, data-retention
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
   least privilege at the agent boundary — production connectors mounted `@read-only`, the
   single write path in `require_approval_for_tools`. Because subagent tool calls still pause
   for approval, **no principal in the run can touch production without a human.** That is a
   stronger claim than a smaller toolbox, and it is real.
3. **Per-subagent model routing does not exist** either. Routing is real at the agent boundary
   (see [`agents/airlock-scout.agent.json`](agents/airlock-scout.agent.json)), and the model and
   cost shown per lane are read from real `thread.created.agentInfo.model` and
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
npm test --workspace @airlock/contract     # 34 tests
```

The suite pins the two properties that matter: no non-`PROVEN` certificate can ever open the
gate, under any combination of kind, status and viewer role; and nothing but a real harness
event can light a lamp — noise, repeated connectors, and prose that merely *mentions* a chart
all light nothing.

---

## Team

**Rohit Maruri** — the console, the Harness Panel, the certificate card and the gate, the agent
definitions and skills, the contract, the webhook and roles.
**Damir** — the verification engine, shadow branch lifecycle, scope computation, seed data.

MIT licensed.

# How AIRLOCK is put together

One page. If you are here to change something, [CONTRIBUTING.md](CONTRIBUTING.md) is the other
one you need, and ["Add a change class"](#add-a-change-class) below is the fastest way to see
the seams.

## The one idea

Everything in this repository exists to enforce a single sentence:

```
certificate.status !== "PROVEN"  →  the approval gate is never offered.
```

Not disabled. Not warned about. **Never rendered** — because the Approve control accepts an
`ApprovalGrant`, and `ApprovalGrant` carries a module-private symbol that only `openGate()` can
mint. There is no value a developer can pass to it by mistake.

Once you have that, the rest of the architecture follows: if the gate is a type, then the
contract that describes a change has to be the shared language, and everything else is either
producing evidence for it or rendering it.

## The shape

```
                     the agent (TrueForge)
                             │
                             │  MCP — eleven tools, one doorway
                             ▼
                   ┌───────────────────┐
                   │  packages/mcp     │  no tool applies a change
                   └─────────┬─────────┘
                             │  HTTP
                             ▼
   ┌──────────────────────────────────────────────────┐
   │  apps/console — Next.js                          │
   │    app/api/…      the store, the decision route   │
   │    src/console    DOING · WAITING · DID           │
   │    src/control    posture, refusals, ledger       │
   │    src/landing    the front door                  │
   └──────────────────────┬───────────────────────────┘
                          │  imports, never duplicates
                          ▼
   ┌──────────────────────────────────────────────────┐
   │  packages/contract — the only place rules live    │
   │                                                   │
   │    dossier.ts    every schema. the shared language│
   │    gate.ts       the invariant, as a type         │
   │    policy.ts     quorum, ceilings, freshness      │
   │    resolve.ts    facts looked up, pinned, drifted │
   │    quarantine.ts untrusted content                │
   │    review.ts     the code review loop             │
   │    undo.ts       the time-boxed reversal          │
   │    receipt.ts    the tamper-evident hash chain    │
   │    detectors.ts  the ONLY thing that lights a lamp│
   └──────────────────────────────────────────────────┘
                          ▲
                          │  generated from, never hand-written
   contracts/dossier.schema.json · docs/POLICY.md · docs/CAPABILITIES.md
   contracts/examples/*.json     · the claims table in README.md
```

## The boundaries, and why they are where they are

**`packages/contract` holds every rule, and imports nothing from the app.** It is isomorphic —
the same `openGate()` runs in the browser on the landing page, on the server in the decision
route, and in the MCP server. That is not a tidiness preference. A gate implemented twice is a
gate with two behaviours, and the second one is the one an attacker uses.

**Schemas live in `dossier.ts`; logic lives beside it.** `quarantine.ts`, `review.ts` and
`resolve.ts` export constants and functions and a structural type; `dossier.ts` imports those
constants and defines the zod schema. This is the one convention worth knowing before you add a
module, because doing it the other way round creates an import cycle immediately.

**`apps/console` renders and never decides.** If you find yourself writing a conditional in a
component that determines whether something is allowed, it belongs in the contract. The console
asks `openGate()` and draws the answer.

**Generated files are generated.** `npm run gen` emits the schema, both docs, every fixture and
the README's claims table. CI fails if regenerating changes anything, so a doc cannot drift from
the code that produced it.

## Add a change class

AIRLOCK governs seven classes of change. Adding an eighth is the most direct proof of whether
these boundaries are real, so here it is, and the compiler does most of the work.

**Step 1 — name it.** Add it to `CHANGE_CLASSES` in
[`packages/contract/src/dossier.ts`](packages/contract/src/dossier.ts), then run
`npm run build --workspace @airlock/contract`. The build fails, and the errors are your to-do
list:

```console
$ npx tsc -p packages/contract/tsconfig.json --noEmit
dossier.ts(40,14): error TS2741: Property 'MODEL_DEPLOY' is missing in type
  '{ SCHEMA_MIGRATION: …; INFRA_MUTATION: …; }' but required in type
  'Record<… | "MODEL_DEPLOY", { title: string; blurb: string; }>'.
resolve.ts(150,14): error TS2741: Property 'MODEL_DEPLOY' is missing in type
  '{ SCHEMA_MIGRATION: string[]; … }' but required in type
  'Record<… | "MODEL_DEPLOY", readonly string[]>'.
```

That is a real transcript, not an illustration — every `Record<ChangeClass, …>` in the codebase
becomes an error until you fill it in. **The compiler enumerates the work.**

**Step 2 — answer both errors.** `CHANGE_CLASS_COPY` wants a title and a one-line blurb.
`REQUIRED_FIELDS` in [`resolve.ts`](packages/contract/src/resolve.ts) wants the facts this class
cannot be planned without — the things the agent must look up rather than ask a human for.

**Step 3 — give it a policy, deliberately.** This is the step the compiler does *not* force,
and you should know why before you skip it. `Policy.classes` is
`Partial<Record<ChangeClass, …>>`, so an unlisted class silently inherits `defaults`:

```
requires: ANY · quorum: 1 · freshness: 3600s · no ceilings
```

One approver and no limits. That is a reasonable floor and a bad answer for anything genuinely
irreversible, so add a block to `DEFAULT_POLICY` in
[`policy.ts`](packages/contract/src/policy.ts) and mirror it in
[`airlock.policy.yaml`](airlock.policy.yaml) — `npm run check:policy` asserts the two are
identical, so you cannot ship a console that enforces one thing while the docs describe another.

**Then:** `npm run gen && npm test`. The generated schema, `docs/POLICY.md` and the fixtures pick
up the new class on their own.

If you want the class to appear in the seeded demo queue, add a fixture to
[`contracts/examples/generate.mjs`](contracts/examples/generate.mjs) and register the gate
verdict you expect in [`scripts/check-fixtures.mjs`](scripts/check-fixtures.mjs) — that check
asserts every fixture is refused for the reason its filename claims, so a fixture cannot quietly
pass for the wrong reason.

## Where evidence comes from

Three things in the console are deliberately hard to fake, and they are worth knowing about
before you try to "fix" one:

- **Capability lamps** light only from [`detectors.ts`](packages/contract/src/detectors.ts),
  folding the real TrueForge event stream through a passthrough observer. Application code
  cannot light one. A run that does not exercise a capability ends below the total, and that is
  the correct outcome.
- **Provenance grades** (`MEASURED` / `COMPUTED` / `DECLARED` / `UNSOURCED`) come from
  [`provenance.ts`](packages/contract/src/provenance.ts). An unsourced figure says it is
  unsourced rather than defaulting to something that looks accounted for.
- **The ledger** is a hash chain in [`receipt.ts`](packages/contract/src/receipt.ts). Editing a
  sealed record breaks every link after it, and `npm run verify:ledger` names the record where
  it broke.

## Testing

`npm test` runs fourteen suites plus five structural checks. Each suite pins a *property*, not
an implementation — see the table in the README. The one to know about:
`scripts/verify-claims.mjs` resolves every claim in the README to a real file and line and fails
if it cannot find it, so documentation cannot rot in place.

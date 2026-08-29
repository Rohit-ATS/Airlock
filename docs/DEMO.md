# The demo

Three problems, and what AIRLOCK does about each. It runs live against a real database — every
number on screen is measured while you watch.

```bash
npm run up                        # harness + MCP server + console, one command
npm run seed:supabase -- --reset  # 1,000,000 rows across six tables — once, then never again
npm run demo                      # the three acts, ~90 seconds
```

`npm run demo -- --yes` never pauses, for rehearsing or recording a take.

---

## What this replaced, and why

The previous runbook was a list of things to click in a console seeded with hand-written
fixtures. The fixtures were honest — they said they were fixtures — but every impressive number
in the demo came from a JSON file, and the live path and the demonstrated path were describing
different systems.

Worse, the demo's headline change did not work. Asked to drop `users.plan_name` against the
real project, the agent read the live schema, correctly found no such column, and stopped to
ask a human what to do. That was the product behaving *perfectly* and the demo dying on camera,
because nobody had ever given the gate a database worth guarding.

So the fixtures are still there — they are what makes `/console` show something on a bare clone
— and **the demo no longer runs on them.**

---

## Before you record

Run the preflight. It is the first thing `npm run demo` does anyway, and it stops rather than
degrading:

```
0. Is any of this actually running?

   ✓  the console                        you are local-admin (approver)
   ✓  the AIRLOCK MCP server             13 tools, none of which write to production
   ✓  the demo database                  policy readable
   ✓  real rows behind it                100,000 users, plan_name present, 1 dependent index
```

A missing precondition names the command that fixes it. **A demo that degrades gracefully is a
demo that lies**, so if any of the four fails, nothing after it runs.

### The orange bar, and what to say about it

On a machine with no identity provider, AIRLOCK signs you in as a single local operator and
puts a permanent orange notice above the console saying exactly that. Do not skip past it — it
is a thirty-second beat that makes everything else credible:

> There is nobody to authenticate me here, so AIRLOCK gave me the approver role and then told
> you it had, in a banner it will not let me dismiss. Point it at a real harness and this
> disappears — and if that harness is configured and goes down, I become a requester and the
> gate shuts, because a control that evaporates when a dependency fails is not a control.

---

## The three-minute cut

**Total 3:00.** The order matters: the argument has to be *made* before it is demonstrated.

### 0:00 — 0:25 · The problem

Land on `/`. Read the question out loud:

> **"I'm about to drop `users.plan_name`. Approve?"**

Then say why it is unanswerable:

> Nobody can answer that honestly. To answer it you'd need to know whether the rollback works,
> whether anything still reads the column, how long the table locks. None of that is on the
> screen. So the human either clicks yes because the agent has been right before — and approval
> becomes a formality — or clicks no at 2am, and the agent is useless.
>
> Every agent approval flow ships this same primitive: the agent states its intention, and a
> human is asked to trust it. The button is rendered before anyone knows whether the change is
> safe. That is not a control, it is a signature block.

### 0:25 — 1:15 · Act 1 — the change that cannot be approved

Run `npm run demo`. Let Act 1 play.

The agent opens the change and AIRLOCK **executes it** — against a throwaway schema inside the
same Postgres, populated from the real rows — then runs the rollback and checksums the table a
third time:

```
✗  the rollback did not bring the data back
   rows        : users=100,000
   pre         : sha256:d2f21cbcb608ed22ac13e1e944e929d0c40f6be4c719e328eaeba98f3d350d21
   post        : sha256:62dd725050452f1b9bd9bd32c9f08a6a4d6b494310921a03584486a6ede4cc83
   post-rollback: sha256:ad8449f8165a8679dcc7ff29e50fa169fb247197fdcebf9acae8b97f682ecfc4
   match       : false
   forward took: 450.0 ms (measured)
   GATE IS SEALED for dos_demo_drop_plan_name.
```

The line to say, while the three hashes are on screen:

> Line three is not line one. The column came back; the hundred thousand values in it did not.
> That is a rollback that *ran without error* and restored nothing — which is exactly the
> failure a human reading a diff cannot see, and exactly the failure that looks fine in a
> post-deploy health check.

Then the beat that matters most in the whole demo — the agent tries to ask anyway:

```
✓  the agent tried to ask a human, and was refused
   Refused. The gate is sealed for dos_demo_drop_plan_name: CERTIFICATE_FAILED
   Nobody has been asked anything.
```

> Nobody was interrupted. This is not a disabled button — the value that would represent
> permission was never constructed. `ApprovalGrant` carries a symbol only `openGate` can mint,
> and `openGate` did not mint one.

### 1:15 — 2:00 · Act 2 — the change that can be

The column still has to go, so take the first step of expand/contract instead: add `plan_tier`
and backfill it. Same treatment, no exceptions:

```
✓  the data came back byte-identical
   pre         : sha256:d2f21cbcb608ed22a…
   post        : sha256:059efb9d98ae307e5…
   post-rollback: sha256:d2f21cbcb608ed22a…
   match       : true
   GATE WOULD OPEN.

⧗  it is now in front of a human, and it stops here
   It needs 1 more signature(s) from an approver who is not the requester.
```

> Line three *is* line one, byte for byte, across a hundred thousand rows. Now — and only now —
> a person is asked. And notice where the agent stops: it has no tool that applies a change,
> and the one tool that moves a change forward is held by the harness. This is the end of what
> the agent can reach.

### 2:00 — 2:35 · Act 3 — the human, and the record

Two things have to be true of the decision itself:

```
✓  curl on the sealed change: 403 CERTIFICATE_FAILED
✓  approved  decided
✓  the chain verifies
   PASS — the chain is intact across 7 sealed record(s).
   Head: sha256:2e868a2ddaba432281a04f59c1c1b9805f5e23036bf1b493574e0db15e60bfdd
```

> First: approving the sealed change over `curl`, with no browser involved, is refused with the
> same reason the UI gives — the gate is re-run on the server against the stored dossier, so it
> is not a UI state you can route around.
>
> Second: the receipt is sealed into a hash chain. Keep that head hash somewhere we cannot
> reach, and any future edit to any record will change it.

### 2:35 — 3:00 · Why it is TrueForge

Open `/console` and point at the Harness Panel.

> Twenty-three capabilities. Each lights only when a real harness event proves it — the only
> writer is a passthrough tap on the event stream. A run that does not exercise one ends below
> twenty-three, and that is the correct outcome.

Close on the agent spec:

```json
{ "name": "airlock",
  "enable_tools": ["@all"],
  "require_approval_for_tools": ["airlock_request_approval"] }
```

> AIRLOCK ships as an MCP server. The agent can open a change, attach a proof, and ask a human.
> There is no tool that applies a change to production, and the one tool that moves a change
> forward is held by the harness. Production connectors are read-only, and subagents inherit
> that scope — so no principal in the run can reach production without a person.
>
> The brief said *build the agent you would trust with root.* This is an agent that behaves as
> though it is not.

---

## The agent path

The demo above drives AIRLOCK's MCP server directly, which is deterministic and fast — the
right choice for a recording. To show a **live model** doing the same work:

```bash
npm run harness:turn -- "Drop the legacy column users.plan_name. Confirm against the live \
schema that it exists, count the rows and the dependent objects, then open a SCHEMA_MIGRATION \
change with forward and rollback SQL and request approval."
```

The run prints the event stream rather than the answer, because what crossed the wire is the
evidence: which MCP servers initialised, which tools were called, whether it stopped for a
human. A real run of that prompt reads the live schema, finds the dependent index via
`pg_depend`, opens the change, fails verification **three times for three different and correct
reasons**, and refuses to request approval — the same story as Act 1, arrived at by a model
rather than by a script.

Two of those three failures are worth pausing on, because they are the verifier defending
itself:

- `alter table public.users …` is **refused before anything runs**. A qualified name ignores
  `search_path`, so it would have hit production rather than the shadow. It is rejected, not
  rewritten — rewriting it would produce a certificate about a statement nobody is going to
  run.
- `DROP INDEX CONCURRENTLY` cannot run inside a transaction block, and the shadow runs
  everything in one. The proof reports that rather than quietly dropping the index a different
  way.

## Resetting between takes

Nothing to reset. A decided change is immutable and there is no route that deletes one — that
is the property the ledger exists to provide, and adding a back door to make the demo tidier
would remove the thing being demonstrated. Re-running `npm run demo` takes the next free
dossier id and says so:

```
dos_demo_expand_plan_tier is already decided and immutable — this run is dos_demo_expand_plan_tier_2
```

To reset the *console fixtures* (not the demo), delete `apps/console/.airlock` and they re-seed
on the next request.

## If something is wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| `real rows behind it ✗` | the demo database is empty or has the wrong shape | `npm run seed:supabase -- --reset` |
| `the AIRLOCK MCP server ✗` | the MCP server is not on :8975 | `npm run mcp:http` |
| `the console ✗` | nothing on :3000 | `npm run up` |
| a live agent turn dies on a 429 | the harness is registered on a 30k-TPM model | `npm run harness:setup`, which now registers `gpt-5.2` and `gpt-5-mini` |
| a live agent turn stops on `execute_sql` | an old agent spec still gates `@destructive` on a read-only connector | `npm run register:agent` |

The last two are the two bugs that made every previous live demo fail; both are written up in
the README under [The model the agent thinks with](../README.md#the-model-the-agent-thinks-with).

# The demo

A runbook for the three-minute submission video, and for anyone who wants to see what AIRLOCK
does without reading the source.

Everything below works on a fresh clone with no database, no API key and no signup. Nothing in
this script requires the verification engine to be running.

```bash
git clone https://github.com/Rohit-ATS/Airlock && cd Airlock
npm install
npm run build --workspace @airlock/contract
npm run dev --workspace @airlock/console
```

---

## The three-minute cut

**Total 3:00.** Times are cumulative. The order matters: the argument has to be *made* before
it is demonstrated, or the demonstration is just a screen recording of a form.

### 0:00 — 0:20 · The problem, in one sentence

Land on `/`. Read the headline aloud, then the rule:

> `certificate.status !== "PROVEN"` → the approval gate is never offered.

Say the line that separates AIRLOCK from every other approval flow:

> Every other approval gate is *"the agent says it is going to do X — click yes."* That asks a
> human to trust a plan. AIRLOCK's gate cannot be offered until the agent has already done the
> thing, and undone it, somewhere safe.

### 0:20 — 0:55 · Try to break it, live

Scroll to **§02 Try the gate**. This is the strongest thirty-five seconds available, because
the viewer watches the invariant hold rather than hearing it claimed.

Do exactly this, in this order:

1. Start on the default: migration, proven, checksums match. The Approve control is there.
2. Flip **the checksum triple** to `Line 3 ≠ line 1`. The button **disappears**. Say:
   > Not disabled. Not hidden. There is no value this component could be passed — `ApprovalGrant`
   > carries a symbol only `openGate` can mint.
3. Flip it back, then set **proof age** to 45 minutes → `CERTIFICATE_STALE`.
4. Set **production** to *moved since* → `PRODUCTION_DRIFTED`. Say:
   > The drift checker reported everything was fine. AIRLOCK compared the digests itself and
   > disagreed. A claim of danger is believed; a claim of safety is recomputed.
5. Switch class to **Access**, set the grant to *never expires* → `GRANT_WITHOUT_EXPIRY`. Say:
   > The certificate is perfect. Policy simply does not permit access that never expires.
6. Set **You are** → *Who asked for it* → `SELF_APPROVAL`.

Six refusals, six different reasons, in thirty seconds, all running the real function.

### 0:55 — 1:15 · Two kinds of proof

Scroll to **§03**. Point at the checksum triple: lines 1 and 3 bracketed, line 2 deliberately
dimmed because it is *expected* to differ.

Then the exclusion list on the right:

> You cannot prove a deletion reversible. So the agent proves the opposite thing — exactly what
> it destroys, and exactly what it is deliberately keeping, with the obligation for each. An
> exclusion with no stated reason is rejected by the contract.

### 1:15 — 1:35 · The ledger, verified in the viewer's own browser

Scroll to **§07**. Click **Rewrite it** on record #1.

The chain breaks, record #2 greys out, and the verdict flips to `TAMPERING DETECTED`. Say:

> That check ran in your browser, not on our server — which is rather the point. A tamper check
> performed by the system holding the data proves considerably less than one performed by the
> person who does not trust it.

### 1:35 — 2:20 · The console

Open `/console`. Go straight to **WAITING**.

Nine changes waiting. Click through four, fast:

| Change | What to say |
| --- | --- |
| `dos_tier_migration` | Gate open. Certificate, checksums, blast radius, lock profile, cost — everything needed to decide, on one screen. |
| `dos_currency_fix` | *"The rollback restored 1,199,998 of 1,200,000 rows."* A rollback that mostly restores the data is a failure, not a warning. |
| `dos_refund_stripe` | £41,904 against a £25,000 ceiling. Proven, and refused. |
| `dos_erasure_dana` | One signature already held. **Countersign — 1 of 2.** A quorum counts people, not clicks. |

Approve `dos_tier_migration`. It moves to **DID** with a receipt attached — **and a countdown
starts.**

> Thirty minutes to take it back. Not because undo is easy, but because this change already
> proved its own rollback against a shadow copy before it was allowed to ask. That inverse is
> still known-good, and this is how long AIRLOCK is willing to vouch for it.

If there is time, press it. If not, open `dos_plan_column` in **DID** instead — applied,
health-checked *clean*, and taken back anyway eleven minutes later because finance's nightly
report read the column that was dropped.

> That is the case a health check can never catch. Every checksum agreed. It was still the
> wrong change, and only a person was ever going to know that.

Then click the **4.21 s lock estimate** on any certificate.

> Every figure here says where it came from. This one was measured, in the sandbox, and that is
> the log line that produced it. Click the record count instead and it says *the agent asserted
> this, and nothing checked it* — because a number a system merely believes should not render
> identically to one it measured.

### 2:20 — 2:40 · The control room

Open `/control`.

> This is the other audience. Not *"should I approve this one"* but *"what is this system
> holding, what has it refused, and can I still trust the record of what it did."*

Point at the headline: the number is what the gate **refused**, not what it approved. Then the
ledger panel, re-verified in the browser, with the head hash.

### 2:40 — 3:00 · Why it is TrueForge

Back to `/console`. Point at the Harness Panel.

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

## The refusals, and how to reproduce each

Every one of these is a fixture in the seeded queue. None of them are staged for the video —
`npm run check:fixtures` asserts in CI that each produces exactly the verdict listed here.

| Fixture | Gate says | Why |
| --- | --- | --- |
| `dos_tier_migration` | **OPEN** | Undo certificate, checksums match, rollback executed |
| `dos_erasure_dana` | **OPEN**, final | Scope certificate, one of two signatures already held |
| `dos_access_oncall` | **OPEN**, countersign | Proven and permitted, but needs two people |
| `dos_currency_fix` | `CERTIFICATE_FAILED` | Rollback restored 1,199,998 of 1,200,000 rows |
| `dos_access_standing` | `GRANT_WITHOUT_EXPIRY` | Perfect certificate; policy forbids standing access |
| `dos_refund_stripe` | `POLICY_AMOUNT_CEILING` | £41,904 against a £25,000 ceiling |
| `dos_incident_email` | `POLICY_PEOPLE_CEILING` | 61,400 people against a 50,000 ceiling |
| `dos_replica_scaledown` | `PRODUCTION_DRIFTED` | Pool autoscaled from 3 to 4 while the change queued |
| `dos_orders_backfill` | `POLICY_LOCK_CEILING` | 9.48 s lock against a 2.00 s ceiling — proven, and still refused |

### The undo window, and the four ways it refuses

Same discipline: each is a seeded record, and `undo.test.mjs` pins the rule behind it.

```bash
curl -s localhost:3000/api/dossiers/dos_plan_column/undo | jq -r .state    # ALREADY_UNDONE
curl -s localhost:3000/api/dossiers/dos_gdpr_batch/undo  | jq -r .state    # UNPROVEN
curl -s localhost:3000/api/dossiers/dos_orders_index/undo | jq -r .state   # CLOSED
curl -s localhost:3000/api/dossiers/dos_email_unique/undo | jq -r .state   # SUPERSEDED
```

| State | Why, in one line |
| --- | --- |
| `UNPROVEN` | An erasure has no inverse to keep warm. It was never undoable and never claimed to be. |
| `CLOSED` | Applied three days ago. The proof describes a database that has since moved on. |
| `SUPERSEDED` | The health check already reverted it automatically. Nothing left to take back. |
| `ALREADY_UNDONE` | Somebody took it back inside the window, and the record says who and why. |

The one worth saying out loud on camera: **the window is judged on the server.** Approve a
change, wait, then press undo after it closes — refused, with the closing time quoted back,
even though the countdown on screen was still drawing a moment earlier.

## Attacking it from the terminal, on camera

If there is room for one more beat, this is the most convincing twenty seconds in the project,
because it happens with no browser involved:

```bash
curl -XPOST localhost:3000/api/dossiers/dos_currency_fix/decision \
     -H 'content-type: application/json' -d '{"decision":"approved"}'
# {"error":"CERTIFICATE_FAILED", …}   403

curl -XPOST localhost:3000/api/dossiers/dos_refund_stripe/decision \
     -H 'content-type: application/json' -d '{"decision":"approved"}'
# {"error":"POLICY_AMOUNT_CEILING", …}   403

curl -XPOST localhost:3000/api/dossiers/dos_access_oncall/decision \
     -H 'content-type: application/json' -d '{"decision":"approved"}'
# {"state":"countersigned","message":"Signature recorded. 1 more approver required, and it cannot be you."}

curl -XPOST localhost:3000/api/dossiers/dos_access_oncall/decision \
     -H 'content-type: application/json' -d '{"decision":"approved"}'
# {"error":"SELF_APPROVAL","message":"You have already signed this change. A quorum counts people, not clicks."}
```

Then break the ledger and get caught:

```bash
node -e "const f='apps/console/.airlock/ledger.json',j=require('./'+f);
         j.dos_gdpr_batch.approval.approver='someone.else@airlock.dev';
         require('fs').writeFileSync(f,JSON.stringify(j,null,2))"

npm run verify:ledger
#   FAIL #001  dos_gdpr_batch   fault: content-modified
# FAIL — the chain breaks at record 1. Every record after that point is no longer trustworthy.
```

## Resetting between takes

```bash
rm -rf apps/console/.airlock       # the queue re-seeds on the next request
```

Undecided fixtures are re-based to the current time when they are seeded, so the certificates
are always fresh and the queue is always live. Decided records are **not** re-based — their
receipts commit to their timestamps, and moving them would break the chain the demo then
invites you to verify.

## If a TrueForge server is available

Everything above is the fixture path, which is what makes the demo reproducible on any machine.
With a harness running, two extra beats become available:

```bash
npx @truefoundry/trueforge@latest     # macOS/Linux; on Windows use Docker
NEXT_PUBLIC_TRUEFORGE_BASE_URL=http://localhost:8790 npm run dev --workspace @airlock/console
```

- **The Harness Panel lights up as the run proceeds** — one lamp at a time, each with a
  timestamp and a link to the step that proved it.
- **The agent hits the gate itself.** Mount `@airlock/mcp` in the agent spec and the run stops
  at `airlock_request_approval`, held by the harness, with the approval card rendered by the
  SDK's own component inside AIRLOCK's chrome.

Do not fake either of these. An unlit panel is an honest panel, and a judge who clicks a lamp
and finds nothing behind it discredits everything else on the screen.

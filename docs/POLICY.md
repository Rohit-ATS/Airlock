# AIRLOCK policy

> **Generated file.** Edit `packages/contract/src/policy.ts` and run
> `node scripts/gen-policy.mjs`. Do not edit this by hand.

Policy `airlock-default`, version 1.

The certificate answers *"is this change what it claims to be?"*. Policy answers a
different question: *"is this change allowed at all, by whom, and right now?"*

A proof cannot answer that, because it is not a property of the change — it is a
property of the organisation. Both are evaluated by
[`openGate`](../packages/contract/src/gate.ts), so a change that is genuinely proven
and genuinely not permitted is sealed for the second reason and told so precisely.

## At a glance

| Change class | Certificate | Approvers | Proof valid for | Ceilings | Undo window | Break-glass |
| --- | --- | --- | --- | --- | --- | --- |
| **SCHEMA_MIGRATION** | UNDO | 1 | 30 min | 5.0s lock | 30 min | permitted |
| **DATA_OPERATION** | UNDO | 1 | 30 min | 5,000,000 records<br>2.0s lock | 15 min | permitted |
| **ERASURE** | SCOPE | 2 | 15 min | 1,000 people | none | no |
| **ACCESS_GRANT** | SCOPE | 2 | 10 min | every grant expires | none | permitted |
| **MONEY_MOVEMENT** | SCOPE | 2 | 10 min | £25,000 | none | no |
| **COMMS_BLAST** | SCOPE | 2 | 15 min | 50,000 people | none | no |
| **INFRA_MUTATION** | ANY | 2 | 15 min | — | 10 min | permitted |

## Each class, and why

### SCHEMA_MIGRATION — Schema migration

Structural change to a live database: columns, indexes, constraints, types.

> Structural change must be proven reversible. A schema change with no proven rollback is not a migration, it is a bet. Thirty minutes to take it back, because the inverse was proven half an hour ago and the table has not moved.

- **Certificate required:** `UNDO`
- **Approvers:** 1
- **Self-approval:** refused — the requester may not approve
- **Certificate freshness:** 30 min after verification
- **Lock ceiling:** 5.0 s
- **Undo window:** 30 min after applying, and only with a proven inverse
- **Change freeze:** none
- **Break-glass:** permitted for this class

### DATA_OPERATION — Data operation

Bulk correction, backfill or reclassification across rows that already exist.

> Above five million rows the batch strategy stops being an implementation detail and becomes a capacity decision. Half the schema window to take it back: a backfill has live writes landing on top of it, and an inverse gets stale faster than a structural one.

- **Certificate required:** `UNDO`
- **Approvers:** 1
- **Self-approval:** refused — the requester may not approve
- **Certificate freshness:** 30 min after verification
- **Record ceiling:** 5,000,000
- **Lock ceiling:** 2.0 s
- **Undo window:** 15 min after applying, and only with a proven inverse
- **Change freeze:** none
- **Break-glass:** permitted for this class

### ERASURE — Erasure

Destroying a person or an entity across every system that holds them.

> Two people, because there is no rollback. No break-glass, because there is no erasure emergency that fifteen minutes of care makes worse.

- **Certificate required:** `SCOPE`
- **Approvers:** 2 distinct people — a quorum counts people, not clicks
- **Self-approval:** refused — the requester may not approve
- **Certificate freshness:** 15 min after verification
- **People ceiling:** 1,000
- **Undo window:** none — permanent the moment it lands
- **Change freeze:** none
- **Break-glass:** forbidden for this class

### ACCESS_GRANT — Access grant

Handing a principal power over production: a role, a key, a policy attachment.

> Standing production access is not grantable through AIRLOCK. Every grant carries an expiry, so the default state of the system is that nobody has it.

- **Certificate required:** `SCOPE`
- **Approvers:** 2 distinct people — a quorum counts people, not clicks
- **Self-approval:** refused — the requester may not approve
- **Certificate freshness:** 10 min after verification
- **Undo window:** none — permanent the moment it lands
- **Expiry:** every principal in the change must carry one
- **Change freeze:** none
- **Break-glass:** permitted for this class

### MONEY_MOVEMENT — Money movement

Refunds, payouts, credits and adjustments that leave the building.

> Two signatures and a hard ceiling of GBP 25,000. Above the ceiling AIRLOCK is the wrong tool and a human treasury process is the right one.

- **Certificate required:** `SCOPE`
- **Approvers:** 2 distinct people — a quorum counts people, not clicks
- **Self-approval:** refused — the requester may not approve
- **Certificate freshness:** 10 min after verification
- **Amount ceiling:** £25,000
- **Undo window:** none — permanent the moment it lands
- **Change freeze:** none
- **Break-glass:** forbidden for this class

### COMMS_BLAST — Comms blast

Outbound message to many real humans. There is no unsend.

> The only class where the blast radius is measured in human attention. Quiet hours are enforced, not advised.

- **Certificate required:** `SCOPE`
- **Approvers:** 2 distinct people — a quorum counts people, not clicks
- **Self-approval:** refused — the requester may not approve
- **Certificate freshness:** 15 min after verification
- **People ceiling:** 50,000
- **Undo window:** none — permanent the moment it lands
- **Change freeze:** every day, 21:00–08:00 Europe/London — Quiet hours. An automated system may not wake fifty thousand people up, however correct the message is.
- **Break-glass:** forbidden for this class

### INFRA_MUTATION — Infrastructure mutation

Scaling, deleting, rotating or repointing the things the product runs on.

> Frozen from Friday afternoon to Monday morning. Break-glass exists here because production outages do not read the policy.

- **Certificate required:** `ANY`
- **Approvers:** 2 distinct people — a quorum counts people, not clicks
- **Self-approval:** refused — the requester may not approve
- **Certificate freshness:** 15 min after verification
- **Undo window:** 10 min after applying, and only with a proven inverse
- **Change freeze:** Fri, 16:00–23:59 Europe/London — Friday change freeze. Nothing structural goes in without a full working day to watch it.
- **Change freeze:** Sat, Sun, 00:00–23:59 Europe/London — Weekend change freeze. Nothing structural goes in without a full working day to watch it.
- **Change freeze:** Mon, 00:00–08:00 Europe/London — Weekend change freeze. Nothing structural goes in without a full working day to watch it.
- **Break-glass:** permitted for this class

## The run budget

Every rule above governs what a change may do to production. This one governs what
the agent may do to your invoice, which is a different kind of irreversible: nobody
has ever been refunded for a verification loop that ran all night against a shadow
branch because a retry never terminated.

| | |
| --- | --- |
| Spend ceiling | $5.00 |
| Token ceiling | 2,000,000 |
| Warns at | 75% of the binding ceiling |
| On reaching it | cancels the turn |

The cancellation goes through the harness, using the same call the ABORT button
makes, so it lands on whichever executor is doing the work rather than in the
browser tab that noticed. A budget that closed the stream locally while the run
continued on a server would not be a budget, it would be a blindfold.

`enforce: false` is a real setting for a team introducing a cap, and it is labelled
rather than dressed up: the console renders a budget that cannot stop anything
differently from one that can.

## What is deliberately absent

There is no undo window on `ERASURE`, `ACCESS_GRANT`, `MONEY_MOVEMENT` or
`COMMS_BLAST`. Not caution — those classes carry a SCOPE certificate, which proves
what will be destroyed rather than that it can be restored. There is no proven
inverse to keep warm, so there is nothing an undo button could honestly do, and a
control implying you can un-send forty thousand emails is worse than no control.

There is no change freeze on `ERASURE`, `MONEY_MOVEMENT`, `ACCESS_GRANT`,
`SCHEMA_MIGRATION` or `DATA_OPERATION`. A freeze that blocks a right-to-erasure
request trades a legal problem for an operational one, and a freeze that blocks an
access grant means the on-call engineer cannot get into the system during the
incident the freeze exists to prevent. This is asserted in the test suite, so it
cannot be quietly reversed.

## Break-glass

Break-glass does **not** open the gate. It cannot: `BreakGlassOverride` carries a
different private symbol from `ApprovalGrant`, and no function accepts both — which
is asserted at compile time in
[`gate.typetest.ts`](../packages/contract/src/gate.typetest.ts). What it does is
record that a named human, during an incident, chose to go around a sealed door,
with a written reason of at least 40 characters, permanently, in the same ledger.

The argument for having it at all: people do this anyway. In every organisation
there is a moment where the safe path is unavailable and somebody opens a psql
session instead. A control plane that pretends otherwise does not prevent the
override — it only ensures there is no record of it.

It requires **two** switches, both off by default: the class must permit it in the
table above, and the deployment must set `AIRLOCK_BREAK_GLASS=1`.

## Every reason the gate can refuse

| Seal reason | Source |
| --- | --- |
| `ALREADY_APPLIED` | audit |
| `ALREADY_DECIDED` | audit |
| `NO_CERTIFICATE` | certificate |
| `CERTIFICATE_PENDING` | certificate |
| `CERTIFICATE_FAILED` | certificate |
| `CHECKSUM_MISSING` | proof integrity |
| `CHECKSUM_MISMATCH` | proof integrity — recomputed, never trusted |
| `ROLLBACK_NOT_PROVEN` | proof integrity |
| `SCOPE_NOT_COMPUTED` | proof integrity |
| `SCOPE_UNBOUNDED` | proof integrity |
| `PRODUCTION_DRIFTED` | the world moved — recomputed, never trusted |
| `CERTIFICATE_STALE` | policy — freshness |
| `POLICY_WRONG_CERTIFICATE` | policy — required certificate kind |
| `POLICY_RECORD_CEILING` | policy — ceiling |
| `POLICY_PEOPLE_CEILING` | policy — ceiling |
| `POLICY_AMOUNT_CEILING` | policy — ceiling |
| `POLICY_LOCK_CEILING` | policy — ceiling on how long a lock is held |
| `POLICY_BLACKOUT` | policy — change freeze |
| `GRANT_WITHOUT_EXPIRY` | policy — no standing access |
| `SELF_APPROVAL` | policy — separation of duties |
| `ROLE_NOT_APPROVER` | role |

Order matters. The gate checks audit state, then whether a proof exists, then
whether the proof holds, then whether it is still true of production, then policy,
and only last whether *you* may act — because being told "you lack permission" when
the real answer is "this change is unprovable" wastes the more important fact.

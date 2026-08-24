---
name: data-retention
version: 1.0.0
description: How to scope a right-to-erasure request across several systems, and which records must be retained despite it. Load before any ERASURE change class.
---

# Data retention and erasure

An erasure request is not "delete everything matching this person". Some records must be
kept, and deleting them is itself a violation. The job is to produce a **scope certificate**:
exactly what is destroyed, exactly what is kept, and why.

> This skill encodes a defensible default posture for a demo system. It is not legal advice.
> A real deployment must have its retention schedule reviewed by counsel, and the reasons in
> the exclusion list should cite that schedule rather than this file.

---

## 1. The shape of the answer

Never produce a list of deletions alone. Always produce both halves:

| Half | Meaning |
| --- | --- |
| **Records** | Everything that will be destroyed, per system, with a real count |
| **Exclusions** | Everything deliberately retained, per system, **each with a stated reason** |

An exclusion without a reason is not an exclusion — it is an omission. The contract rejects
one with an empty reason for exactly that purpose.

---

## 2. Find the person before you delete them

Enumerate on a **shadow copy** first. Follow the foreign keys; do not guess at table names.

```sql
-- What actually references users?
SELECT tc.table_name, kcu.column_name, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu USING (constraint_name)
  JOIN information_schema.referential_constraints rc USING (constraint_name)
  JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
 WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'users';
```

`delete_rule` matters enormously:

- `CASCADE` — rows vanish with the parent. **They must appear in your record list**, or the
  certificate understates the blast radius.
- `RESTRICT` / `NO ACTION` — the delete will fail until you handle them. Find out now.
- `SET NULL` — the row survives, de-linked. Decide whether that counts as erasure.

Count every one of them before proposing anything.

---

## 3. Typical retention obligations

These are the usual reasons a record survives an erasure request. Match the real obligation
to the real jurisdiction; do not copy this table verbatim into a certificate.

| Category | Typical retention | Why it overrides erasure |
| --- | --- | --- |
| Invoices, tax records | 6–10 years | Statutory financial record-keeping |
| Payment/charge records | Held by the processor | Processor's own legal obligation |
| Security audit logs | 1–7 years | Integrity of the audit trail |
| Anti-fraud / AML | Varies, often 5 years | Regulatory obligation |
| Employment records | Varies | Employment law |
| Active contractual data | Until the contract ends | Necessary for performance |

**Pseudonymisation is usually the right answer** for retained records: keep the row and its
financial or security value, replace the personal fields. Say so explicitly — "retained with
the customer name replaced by a pseudonym" is a much better certificate line than "retained".

---

## 4. Per-system behaviour

Every external system deletes on its own terms. State them; do not imply we control them.

**Stripe** — `customers.del()` removes the customer object, but **charges, invoices and
payouts remain** for financial reporting. That is Stripe's obligation, not our choice. Say
this in the exclusion list rather than leaving the impression the data is gone.

**Slack** — removing a member deactivates the account. Messages they posted in shared
channels **remain**, because they are also other people's conversation history. Deleting
them is a separate decision with its own consequences — ask, do not assume.

**Object storage** — deleting an object does not delete its **versions** or its backups.
If versioning is on, a delete marker is not a deletion. Check, and report which it is.

**Backups and snapshots** — almost never purged per-subject. The honest position is a
documented maximum retention window after which the backup expires, disclosed to the
subject. Do not claim a backup was scrubbed unless it was.

**Analytics and third parties** — enumerate them. A person exported to a warehouse or a
CRM is still held there.

---

## 5. Ask, do not assume

At least one genuine ambiguity almost always exists. Put it to the human rather than
resolving it silently. Good questions are specific, and each option has a consequence:

> Invoices for this person fall under a seven-year statutory retention obligation.
> — Delete them anyway (breaches the retention obligation)
> — Pseudonymise and retain (satisfies both; recommended)
> — Retain unchanged (does not satisfy the erasure request)

Bad question: "How should I handle invoices?" — it makes the human do the analysis that was
the agent's job.

---

## 6. Order of operations

Delete outward-in, so a partial failure leaves the least mess:

1. **External systems first** (Stripe, Slack, object storage). They can fail, and retrying
   is easy while the local record still exists to tell you what to retry.
2. **Local dependent rows** next.
3. **The subject record last.** Once it is gone, you have lost the key you needed to find
   everything else.

Record what succeeded as you go. A half-completed erasure that cannot say what it completed
is worse than one that never started.

---

## 7. What the certificate must say

- Every system touched, with a real count per system — computed against the shadow copy.
- Every exclusion, with the obligation that justifies it.
- Whether retained records are pseudonymised or untouched.
- Anything held by a third party that we cannot delete.
- That this **cannot be undone**, in those words.

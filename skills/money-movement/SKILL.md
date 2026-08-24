---
name: money-movement
version: 1.0.0
description: Refunds, payouts and adjustments — idempotency, double-payment detection, disputes, and why money never gets an undo certificate. Load before writing or reviewing any MONEY_MOVEMENT change.
---

# Money movement

Money that has left cannot be recalled by writing an inverse statement. There is no undo
certificate for a refund, and claiming one is the single worst thing this skill exists to
prevent.

**A MONEY_MOVEMENT change always carries a SCOPE certificate.** The claim is not "we can
put it back". The claim is *exactly these payments, to exactly these counterparties, for
exactly this total — and explicitly not these others, for these reasons.*

---

## 1. The four questions

1. **How much, in minor units, and in which currency?** Never work in decimal majors. A
   float somewhere in the pipeline is how £41,904.00 becomes £41,903.99 across a thousand
   rows and the reconciliation fails for a week.
2. **To whom, counted as counterparties rather than as rows?** Ten refunds to one customer
   is one angry phone call. One refund to ten thousand customers is a different event.
3. **Has any of it already gone out?** This is the failure that matters. See §3.
4. **What is deliberately excluded, and why?** The exclusion list is the part a reviewer
   actually reads.

---

## 2. Minor units, always

Compute, store, compare and report in the smallest unit of the currency. Convert to a
display form exactly once, at the edge, for a human.

```sql
-- right
SELECT SUM(amount_minor) FROM charges WHERE ...;

-- wrong: introduces a float, and 0.1 + 0.2 is not 0.3
SELECT SUM(amount / 100.0) FROM charges WHERE ...;
```

Be careful with currencies that are not two-decimal. JPY and KRW have zero decimal places;
BHD, KWD and TND have three. `amount_minor / 100` is wrong for five of the currencies you
are likely to meet. Read the currency, do not assume it.

Never sum across currencies to produce a single ceiling check. `SUM(amount_minor)` over
mixed EUR and JPY is a meaningless number that will pass a ceiling it should not.

---

## 3. Double payment — the failure that matters

The dangerous scenario is not "the refund fails". It is "the refund succeeds twice". Three
defences, and use all three.

### Idempotency keys, derived not random

```
key = sha256(dossier_id + ":" + charge_id + ":" + amount_minor)
```

Derived from the change and the target, so a retry — from a timeout, a redeploy, a second
run of the same dossier — computes the same key and the provider deduplicates it. A random
UUID per attempt provides no protection at all, because the second attempt has a different
one.

Stripe holds idempotency keys for 24 hours. A retry the next day is a *new* payment. If a
change is re-run after a day, it is a new change with a new dossier and a fresh scope
computation, not a resumption.

### Query the provider, not your own database

Your `invoices.status` column says what you *believe*. The provider says what *happened*.
When they disagree, the provider is right and your row is the bug.

```
# for every charge in scope, before including it
GET /v1/charges/{id}/refunds     -> if any refund exists, exclude and say so
```

### Exclude, do not filter silently

A charge that already has a refund goes in the **exclusion list with the reason**, not
quietly out of the working set. The reviewer needs to see that eleven charges were caught
by this check — that is the evidence the check ran.

---

## 4. Disputes

A refund on a disputed charge is worse than doing nothing:

- it forfeits the dispute, so the funds are taken again by the chargeback
- the dispute fee is charged regardless and is not refunded
- the net effect is paying the customer twice and paying the network a fee

**Always exclude charges in `dispute.status in (warning_needs_response, needs_response,
under_review)`** and say why. Leave them to the chargeback process. This is one of the very
few places where the right action is to route around the automation entirely.

---

## 5. Refund, reversal, credit — not interchangeable

| Instrument | What it does | When it is right |
| --- | --- | --- |
| Refund | Returns funds along the original payment path | The customer paid and should not have |
| Partial refund | Same, for part of the amount | Overcharge, prorated cancellation |
| Reversal | Cancels a transfer/payout before settlement | Money is still in flight |
| Credit note | Reduces what is owed on an invoice | The invoice is unpaid — no money moves |
| Account credit | Balance on your platform | The customer agreed to it; **not** a substitute for a refund they are owed |

Never substitute an account credit for a refund the customer is legally owed. That is a
different transaction with different consumer-protection consequences, and it is not yours
to choose. If the request is ambiguous, `ask_user_question` with both options and their
real consequences.

Refunds to an expired or closed card generally still succeed and land with the issuing
bank, who forwards to the customer. Do not "fix" this by paying to a different destination
— that is how money reaches the wrong person.

---

## 6. What belongs in the scope certificate

Records:

- each charge or payout, by provider id, with its amount in minor units and its currency
- the counterparty count, deduplicated **by person**, not by charge
- the total, per currency, separately
- the idempotency key derivation, stated, so a reviewer can verify a retry is safe

Exclusions, each with the obligation or fact that justifies it:

- already refunded, manually or by an earlier run — with the count and when
- under dispute — with the dispute status
- outside the stated window, when the window is the whole point of the correction
- test-mode or internal accounts

Risk notes:

- the fact that this cannot be recalled, in those words
- the reconciliation impact: which report or ledger will disagree until it is re-run
- whether the provider's fee is returned with the refund (Stripe does not return the
  processing fee on a refund) — the true cost is higher than the refunded amount

---

## 7. Ceilings

Policy caps a single automated money movement. Above the ceiling the correct output is
`BLOCK`, with the dossier as the artefact a human treasury process reads. The ceiling is
not an obstacle to route around:

- **Do not split a change to get under it.** The magnitude counts the total, and splitting
  is the thing the ceiling exists to catch.
- **Do not net inflows against outflows.** £40,000 out and £39,000 in is not a £1,000
  change; it is two events with different risk.
- The ceiling is absolute, so a large *incoming* correction is caught as well as a large
  outgoing one. Money arriving unexpectedly is also an incident.

---

## 8. Questions worth asking a human

- Fourteen of these charges are under dispute. Exclude them and leave them to the chargeback
  process (recommended), or refund anyway and forfeit the disputes?
- The overcharge is £4.12 per customer across 1,046 customers. Refund the difference, or
  refund the whole charge and re-bill correctly?
- Six affected customers have since closed their accounts. Refund to the original payment
  method, or hold for a manual process?

Do **not** ask what the total is, which charges match the filter, or what the currency is.
Count them.

---

## 9. Refusals

- **A refund without a verified charge id.** Guessing which charge a row corresponds to is
  how money reaches a stranger.
- **A scope computed from your own database alone**, with no provider confirmation.
- **Any change that mixes currencies under one ceiling check.**
- **A "reconciliation fix" that writes to the ledger without a corresponding provider
  event.** That is not a correction, it is making the books say something that did not
  happen.

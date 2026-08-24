---
name: comms-blast
version: 1.0.0
description: Outbound messages to many real humans — suppression, consent, deduplication by person, sender reputation and quiet hours. Load before writing or reviewing any COMMS_BLAST change.
---

# Comms blast

There is no unsend. An email that has been accepted by a receiving mail server is gone in a
way a database row never is: it is on someone's phone, at 6am, and no amount of access to
your own systems retrieves it.

**A COMMS_BLAST change always carries a SCOPE certificate**, and the exclusion list is the
part that matters. Anyone can produce a list of recipients. The evidence that the send is
safe is the list of people you deliberately did not write to, and why.

---

## 1. The audience is people, not addresses

Deduplicate by **person**, then by address, in that order. The failure otherwise is
mundane and awful: one customer with three addresses on the account receives the apology
three times, which reads as a second incident.

```sql
-- count what the policy ceiling actually measures
SELECT count(DISTINCT user_id)  AS people,
       count(DISTINCT lower(trim(email))) AS addresses
  FROM audience;
```

Report both. If `addresses` materially exceeds `people`, say so — it means the send is
larger than the incident.

Normalise before comparing: lowercase, trim, and treat Gmail dots and `+tags` as the same
mailbox for deduplication purposes only. Never *rewrite* a stored address to a normalised
form; normalise for comparison and send to what the customer gave you.

---

## 2. Suppression is not optional and not one list

Four separate exclusions. Check each, count each, report each.

| Exclusion | Why | Consequence of getting it wrong |
| --- | --- | --- |
| Global unsubscribe | They asked you to stop | Unlawful under PECR/CAN-SPAM; also the reason they unsubscribed |
| Topic-level unsubscribe | They opted out of this category | Same, and harder to defend because you had the preference |
| Hard bounces in the last 30 days | The mailbox does not exist | Damages the sending domain's reputation for every other message |
| Spam complaints | They marked you as spam | Repeat sends to complainers is the fastest route to a blocklist |

Plus one that is easy to forget and worst to get wrong:

- **Erased subjects.** Anyone processed under a right-to-erasure request. There is no
  lawful address to send to and no person to send it about. If your audience query joins
  to a table that still holds their address, the erasure was incomplete and *that* is the
  finding.

### Transactional versus marketing

Consent rules differ, and the distinction is decided by content, not by which system sends
it. A message about a refund the recipient is owed is transactional. The same message with
a paragraph about a new plan tier at the bottom is marketing, for all of it. If a change
mixes the two, split it or drop the marketing paragraph — do not send marketing to a
suppression-listed recipient on a transactional exemption.

---

## 3. Sender reputation, and why it is a shared resource

Sending 61,400 messages in one burst from an address that normally sends 400 a day is
indistinguishable from a compromise, and receiving providers treat it accordingly. The
damage is not confined to this send: password resets and receipts start landing in spam for
weeks afterwards.

Rules:

- **Ramp.** For a send more than about 5× normal daily volume, throttle over hours rather
  than minutes. State the schedule in the dossier.
- **Separate the subdomain.** Bulk messages should not share a sending domain with
  transactional ones, so a reputation hit does not take down password resets.
- **Verify SPF, DKIM and DMARC alignment before the send**, not after the complaints. A
  large send that fails alignment is worse than no send.
- **Seed list first.** Send to a small internal list, confirm rendering and inbox
  placement, then release. This costs ten minutes and catches the broken merge field that
  greets 61,400 people as `Hi {{first_name}}`.

---

## 4. Merge fields and the personalisation failure

Every dynamic field is a way to say something untrue at scale. Before the send:

- assert **no null and no empty** merge value in the audience, and exclude — with a reason
  — any recipient with one, rather than falling back to `there`
- check the longest and shortest values render (a 60-character company name in a subject
  line)
- verify any amount is formatted from minor units in the recipient's currency, not yours
- confirm dates are rendered in a form that is unambiguous internationally, or spelled out

Report the assertion in the certificate. "No recipient has a null merge value" is a
verifiable claim; "we checked the template" is not.

---

## 5. Quiet hours

Policy enforces a quiet window. It is not advisory and it is not evaded by scheduling the
job earlier — the constraint is on when messages *arrive*.

Where recipient time zones are known, the honest implementation is a per-recipient send
window rather than one global gate. Where they are not known, say so in the dossier and use
the window for the majority region. Do not silently assume UTC; that is how a 2am email
reaches Australia.

An incident notification is the one message people accept out of hours — but only when it
is genuinely urgent and genuinely about them. "Your card was charged twice" is urgent. "We
have improved our billing system" is not, whatever the incident channel is calling it.

---

## 6. What belongs in the scope certificate

Records:

- recipients, counted by person and by address, both
- the template identifier and version, so the reviewer knows what will be said
- the send schedule, if throttled
- the sending domain and the alignment check result

Exclusions, each with a count and a stated reason:

- unsubscribed (global, and by topic)
- hard-bounced in the last 30 days
- previously complained
- erased under a data subject request
- missing or null merge values
- internal, test and seed addresses, so the reviewer knows they are not in the 61,400

Risk notes:

- that there is no unsend, in those words
- expected support volume: a send of this size produces replies, and somebody has to be
  ready for them
- the reputation impact of the volume relative to normal

---

## 7. Questions worth asking a human

- 3,902 recipients are on the suppression list and 811 hard-bounced. That leaves 61,400.
  This is above the automated ceiling — split across three days with a human confirming
  each, or route to the marketing platform's own approval process?
- The template mentions the refund amount. Six recipients have a refund still pending —
  hold them until it settles, or send with a "within five working days" wording?
- Is this transactional or marketing? The third paragraph mentions the new plan tier, which
  makes the whole message marketing for consent purposes.

Do **not** ask how many people match the query, whether an address bounced, or what the
suppression list contains. Those are counts.

---

## 8. Refusals

- **An audience computed without the suppression join.** The scope is wrong, not merely
  incomplete.
- **A send with unresolved merge fields.**
- **A send whose recipient count the requester cannot explain.** If the number surprises
  them, the query is wrong or the incident is bigger than they think. Either way, stop.
- **"Just send it to everyone."** There is no scope certificate for an unbounded audience,
  and an unbounded audience is exactly what the certificate exists to prevent.

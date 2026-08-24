---
name: infra-safety
version: 1.0.0
description: Scaling down, deleting, rotating and repointing — capacity headroom, quorum loss, DNS TTL, secret rotation ordering and why "unused" usually means "broken". Load before writing or reviewing any INFRA_MUTATION change.
---

# Infrastructure safety

Most infrastructure incidents are caused by cleanup, not by building. The change that takes
production down is rarely the deploy; it is the tidy-up three weeks later, performed
confidently by someone who checked that the thing was unused.

**The rule that governs this whole skill: "nothing reads from it" and "nothing should read
from it" are different findings.** A resource can be unread because the feature that reads
it is broken. Establish which one you are looking at before proposing a deletion.

---

## 1. Reversible or not — be honest about which

| Operation | Reversible? | The catch |
| --- | --- | --- |
| Scale a stateless deployment | Yes | None, if capacity allows |
| Scale down a StatefulSet | Usually | PVCs are **retained** by default, so data survives — unless the reclaim policy is Delete |
| Delete a PVC | No | The volume goes with it under `Delete` reclaim |
| Delete an object storage bucket | No | And the name may be unclaimable afterwards |
| Rotate a secret | Yes, with overlap | Not reversible if the old value was not retained |
| Change a DNS record | Yes | But not *quickly* — see §4 |
| Delete a security group / firewall rule | Yes | Existing connections survive; new ones do not, so the failure is delayed and confusing |
| Terminate an instance in an ASG | Yes | It comes back different, which is usually the point and occasionally the problem |

A scale-down that can be scaled back up is a legitimate **UNDO** certificate: apply against
a shadow topology, restore it, compare. A deletion is a **SCOPE** certificate, always.

---

## 2. Scaling down: prove the headroom first

The question is never "can the remaining nodes serve the current load". It is "can they
serve peak load, with one of them gone, during the window before autoscaling reacts".

Compute and report:

- **peak** utilisation over the last 30 days, not mean — the mean of a spiky workload is a
  number about nothing
- headroom after the change, at peak, with **N-1** of the remaining nodes
- the autoscaler's reaction time, and what happens during it
- connection capacity, not just CPU: a Postgres replica pool sized for `max_connections`
  fails on connection exhaustion long before CPU

### Quorum

Never take a quorum-based system below its majority threshold. For a 3-node etcd, Consul,
ZooKeeper or Raft cluster, losing two is not "degraded", it is unavailable and often
unrecoverable without a manual, dangerous, single-node recovery.

| Nodes | Tolerates | Scaling to |
| --- | --- | --- |
| 3 | 1 failure | 2 tolerates **0** — never do this |
| 5 | 2 failures | 3 tolerates 1 |

Scaling an odd cluster to an even number buys nothing and costs money: 4 nodes tolerate the
same single failure as 3.

### Drift is especially likely here

An autoscaler moves the thing you measured while the change waits for approval. A topology
proof taken against three nodes is wrong the moment it becomes four, and the resulting plan
removes more than it was approved to remove. **Always re-check the live topology
immediately before applying**, and record it so AIRLOCK's drift check can compare.

---

## 3. Deletion: find the references before, not after

Before proposing any deletion, run three searches and report all three:

1. **Code.** Every reference to the bucket, table, queue, hostname or secret name across
   every repository, including infrastructure-as-code, CI configuration, and dashboards.
   Include tests: a deletion that breaks CI is discovered by the whole team at once.
2. **Data.** Rows that point at it. This is the one that gets missed — 11,908 rows in
   `attachments` whose `storage_url` points at the "unused" bucket.
3. **Traffic.** Access logs over a full billing cycle, not a week. Monthly and quarterly
   jobs are invisible in seven days of logs, and they are exactly the jobs nobody
   remembers.

If the resource is genuinely unreferenced, say how you established it and over what window.
"No access in 30 days" is a finding. "Nobody remembers using it" is not.

### Prefer a reversible intermediate step

Rather than deleting, make the resource *inaccessible* first and delete later:

- object storage: deny-all bucket policy, or a lifecycle rule with a 30-day expiry
- database: rename the table rather than dropping it
- Kubernetes: scale to zero rather than deleting the workload
- DNS: lower the TTL and point at a holding page

This converts an irreversible change into a reversible one plus a scheduled irreversible
one, which is almost always the right trade. Offer it as the alternative whenever you are
about to recommend `BLOCK`.

---

## 4. DNS: reversible, but not on your timescale

Changing a record is reversible. Un-caching it is not.

- Resolvers hold the record for its **TTL**, and some ignore short TTLs entirely.
- **Lower the TTL first**, wait for the old TTL to expire, then make the change. A change
  made at a 3600-second TTL takes an hour to fully propagate and an hour to fully roll back
  — two hours of an outage you cannot shorten.
- Negative caching (SOA minimum) means a record that briefly did not exist stays
  non-existent in a resolver's cache after you fix it.
- Never let a CNAME point at a hostname you have released. Dangling records are how
  subdomain takeover happens; treat "delete the resource, leave the record" as a security
  finding, not a tidiness one.

---

## 5. Secret rotation: add, then switch, then remove

Rotation is three changes, and doing it as one is the outage.

1. **Add** the new credential alongside the old. Both valid.
2. **Switch** consumers to the new one. Deploy, confirm, watch.
3. **Remove** the old one, after confirming nothing still authenticates with it.

Step 3 is a separate AIRLOCK change with its own evidence: the count of authentications
with the old credential in the last 24 hours, which must be zero. If your provider cannot
tell you that, say so — it is the reason step 3 is dangerous.

Things that hold the old secret longer than you expect: CI caches, in-memory pools that
only reconnect on error, cron jobs on a weekly schedule, a colleague's local `.env`, and
mobile clients that update when the user feels like it.

**Never rotate a secret and deploy a change in the same window.** When it breaks you will
not know which one did it.

---

## 6. What belongs in the certificate

For a scale-down (UNDO):

- the topology before and after, checksummed, plus the restored topology
- peak utilisation, headroom at N-1, and connection capacity
- the quorum arithmetic, explicitly, when a quorum system is involved
- confirmation that the live topology matches the one the proof was taken against

For a deletion (SCOPE):

- the object count and total size, counted, not estimated
- every code reference found, with file and line
- every data reference found, with the count
- the access-log window examined, and what it showed
- exclusions: what is deliberately being kept, and why — retained backups, objects under
  legal hold, anything referenced by a row you are not also deleting

Risk notes should always include the reversible alternative if one exists, with concrete
commands. An approver reading "this cannot be undone" and "here is the version that can"
makes a better decision than one reading only the first.

---

## 7. Questions worth asking a human

- The bucket has had no reads in 90 days, but 11,908 rows in `attachments` still reference
  it. That suggests the attachment feature is broken rather than unused. Investigate first,
  or delete and accept those attachments are already lost?
- Scaling to one replica leaves no headroom at last month's peak. Scale to two, or accept
  the risk for the four hours until the backfill finishes?
- The old API key still shows 40 authentications a day. Find and fix the caller, or revoke
  and let it fail loudly?

---

## 8. Refusals

- **Any change taking a quorum system below majority.**
- **A deletion whose reference search could not be completed.** Unknown references are not
  absent references.
- **A DNS change at a TTL longer than the acceptable rollback time.** Lower the TTL first;
  that is a separate, safe, reversible change.
- **Rotating and deploying in the same change.**
- **`--force`, `--yes` or `--no-preserve-root` in any operation offered for approval.** If
  the command needs a flag whose purpose is to suppress a safety check, the safety check is
  the finding.

---
name: access-review
version: 1.0.0
description: How to compute what an access grant actually unlocks, rather than what its policy document says. Load before writing or reviewing any ACCESS_GRANT change.
---

# Access review

A policy document and an effective permission are not the same thing, and the gap between
them is where breaches live. This skill is about closing that gap before a human is asked
to sign anything.

**The rule that governs everything below:** never report what a policy *says*. Report what
a principal can *do*, computed by simulation against a shadow copy of the account. If you
cannot simulate it, say you could not, and do not guess.

---

## 1. The three questions

For every principal in the change:

1. **What can they reach after this that they could not reach before?** The delta, not the
   total. An approver cannot judge a 400-line policy document; they can judge four new
   verbs.
2. **What is the worst thing reachable through this grant?** Not the intended use — the
   maximum. Read access to `public.*` includes the table nobody remembered was there.
3. **When does it end?** A grant with no expiry is refused by policy. There is no such
   thing as temporary access that nobody scheduled to remove.

---

## 2. Effective permissions, not declared ones

Four mechanisms make the declared policy an underestimate. Check each.

### Transitive role membership

```sql
-- Postgres: everything prod_reader actually inherits, transitively
WITH RECURSIVE m AS (
  SELECT oid, rolname FROM pg_roles WHERE rolname = 'prod_reader'
  UNION
  SELECT r.oid, r.rolname
    FROM pg_auth_members am
    JOIN pg_roles r ON r.oid = am.roleid
    JOIN m ON m.oid = am.member
)
SELECT rolname FROM m;
```

A role granted a role granted a role is three documents away from the grant you are
reviewing. `\du` shows one level. Recurse.

### PUBLIC grants

`GRANT ... TO PUBLIC` is invisible in a per-role audit and applies to the new principal
immediately.

```sql
SELECT table_schema, table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'PUBLIC';
```

### Default privileges

`ALTER DEFAULT PRIVILEGES` means the grant covers tables that **do not exist yet**. This is
the one people miss: the review passes, and six weeks later a new table containing card
data is readable by a role nobody re-reviewed.

```sql
SELECT * FROM pg_default_acl;
```

Report default privileges as part of the scope. A grant that auto-extends is a materially
different grant from one that does not, and the certificate must say so.

### Row-level security bypass

`BYPASSRLS`, or membership of a role with it, silently defeats every RLS policy on the
database. Treat any grant that confers it as a full-table read regardless of what the RLS
policies claim.

```sql
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolbypassrls OR rolsuper;
```

---

## 3. Cloud IAM: the same trap, larger

| Mechanism | Why the declared policy understates it |
| --- | --- |
| `iam:PassRole` | Lets the principal hand a *different, more powerful* role to a service. This is privilege escalation written as a single innocuous verb. |
| `sts:AssumeRole` chains | The reachable set is the transitive closure, not the first hop. |
| Resource policies | A bucket policy can grant access the identity policy never mentions. Both sides must be read. |
| `iam:CreatePolicyVersion`, `iam:AttachRolePolicy` | Permission to change permissions is permission to have all of them. |
| Wildcards in conditions | `"StringLike": {"aws:username": "*"}` is not a constraint. |

**Always run the policy simulator rather than reading the JSON**, and simulate the
escalation verbs explicitly:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::ACCOUNT:role/oncall \
  --action-names iam:PassRole sts:AssumeRole s3:GetObject kms:Decrypt \
  --resource-arns '*'
```

If `iam:PassRole` or any `iam:*Policy*` verb comes back allowed, the grant is not
read-only, whatever it is called. Say so in the certificate in those words.

---

## 4. Encryption is a second access-control system

Read access to an encrypted object is useless without `kms:Decrypt` on the key, and
`kms:Decrypt` on the key is read access to *everything* encrypted with it — which is
usually far more than the bucket under review.

Always report the key grant separately from the object grant. They have different blast
radii and reviewers conflate them.

---

## 5. What belongs in the scope certificate

An ACCESS_GRANT carries a **SCOPE** certificate, never an UNDO one. Revoking a grant does
not un-read the data that was read while it was live, so reversibility is not the claim on
offer. The claim on offer is: *exactly this much power, over exactly these resources,
until exactly this moment, and explicitly not these other things.*

Records:

- every resource the principal can now reach, counted (`214 tables`, not `the public
  schema`)
- every escalation verb the simulation returned as allowed
- the KMS keys, separately
- whether default privileges extend the grant to future objects

Exclusions, each with the obligation that justifies it:

- cardholder data tables excluded under PCI-DSS 7.2
- any write binding deliberately not created, so the reviewer can see the grant cannot be
  escalated by using it
- production secrets, and the fact that the role cannot read them

An exclusion without a stated reason is not an exclusion. "We did not grant write" is
worth writing down precisely because a reviewer cannot otherwise tell whether you
considered it.

---

## 6. Time-bounding, concretely

Policy requires an expiry. Make it real rather than documentary:

1. **Prefer credentials that expire themselves.** An STS session token with a four-hour
   duration cannot outlive its expiry even if the revoke fails. A role binding removed by
   a cron job can.
2. **Schedule the revoke as part of applying the grant**, in the same change, not as a
   follow-up ticket. AIRLOCK records the revoke in the dossier so it is visible at approval
   time.
3. **Match the expiry to the stated reason.** "For the length of this incident" is four
   hours, not thirty days. If the requester cannot say how long they need it for, that is
   the finding — ask them with `ask_user_question` rather than picking a number.
4. **Never extend by re-granting silently.** A second four-hour grant is a second change,
   with a second signature. Rolling extensions are how temporary access becomes permanent.

---

## 7. Questions worth asking a human

Use `ask_user_question` for these. They are judgement calls, not lookups.

- The requester asked for write access; read access satisfies the stated purpose. Downgrade
  to read, or is there a use case not described in the request?
- This grant would inherit `BYPASSRLS` transitively, which defeats the tenant isolation
  policies. Proceed, or create a narrower role?
- The stated reason is an incident. Four hours, or until the incident is closed — and who
  closes it?

Do **not** ask which tables exist, what a policy document contains, or whether a role has a
permission. Those are lookups, and asking them turns you into a form.

---

## 8. Refusals

Report these as `BLOCK` with the reason, rather than proving a scope for them:

- **Standing access.** No expiry, and none proposed. Policy refuses it; offer the version
  that is re-issued on a schedule instead.
- **A grant whose simulation could not be run.** Unproven is unproven.
- **Wildcard resource with a wildcard action.** There is no honest scope certificate for
  `"Action": "*", "Resource": "*"` — the scope is "everything, forever", and the correct
  output is to say so plainly.
- **A grant to a shared account.** Nobody can be held to it, so separation of duties has
  already failed before the gate is reached.

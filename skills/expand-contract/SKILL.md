---
name: expand-contract
version: 1.0.0
description: The three-phase pattern for making an irreversible schema or data change reversible. Load whenever a migration fails its rollback proof, or whenever a change would drop or narrow anything.
---

# Expand / contract

When a change cannot be proven reversible, do not argue about the risk. Restructure it into
three changes that each can be.

The pattern turns one irreversible step into a sequence where **every individual step is
reversible and every intermediate state is deployable**. That is the whole idea: at no
point does a rollback of the application require a rollback of the database.

---

## When to reach for it

Use it whenever the honest answer to "can I restore the prior bytes?" is no:

- dropping a column or a table
- renaming anything
- narrowing a type (`bigint` → `int`, `text` → `varchar(n)`)
- a lossy `UPDATE` (see `postgres-safety` §3)
- adding a `NOT NULL` column to a populated table
- splitting or merging columns

---

## The three phases

### 1. EXPAND — add the new shape alongside the old

Additive only. Nothing is removed and nothing is rewritten. The old readers and writers keep
working untouched.

```sql
ALTER TABLE users ADD COLUMN tier text;    -- brief lock, no rewrite on PG 11+
```

Backfill in batches, then dual-write from the application so both columns stay correct.

**Reversible?** Yes — drop the new column. Nothing depended on it.

### 2. MIGRATE — move the readers

A code change, not a schema change. Readers switch to the new column one deployment at a
time. Writers write both. Run a reconciliation query until the two columns agree for every
row:

```sql
SELECT count(*) FROM users u
  JOIN subscriptions s ON s.user_id = u.id
 WHERE u.tier IS DISTINCT FROM s.plan_tier;    -- must be 0 before phase 3
```

**Reversible?** Yes — point the readers back. The old column is still authoritative.

### 3. CONTRACT — remove the old shape

Only once **nothing reads the old column**. Prove it, do not assume it:

- the blast-radius scan returns zero references in any deployed branch
- `pg_stat_statements` shows no query touching the column over a full business cycle
- the dual-write has been on long enough to cover every code path

```sql
ALTER TABLE users DROP COLUMN plan_name;
```

**Reversible?** No. This is the irreversible step, and it is now the *only* one — isolated,
tiny, and taken when the column is provably dead.

---

## Applied to a lossy update

The currency example from `postgres-safety` §3, made safe:

```sql
-- EXPAND: new column, computed alongside. The original is untouched.
ALTER TABLE invoices ADD COLUMN amount_minor_eur bigint;
UPDATE invoices SET amount_minor_eur = ROUND(amount_minor / 1.0871)
 WHERE region = 'EU' AND created_at < '2026-01-01';    -- batched

-- MIGRATE: readers move to amount_minor_eur. Both columns are maintained.

-- CONTRACT: only when nothing reads amount_minor for EU rows.
ALTER TABLE invoices DROP COLUMN amount_minor;
```

The rounding is still lossy — but the original value survives until the contract phase, so
until then the change *is* reversible. That is the point.

---

## Renames

Never `ALTER TABLE ... RENAME COLUMN` on a live system. It is instant in the catalog and
instantly breaks every deployed reader.

Treat a rename as expand/contract: add the new name, dual-write, move readers, drop the old.

---

## What to put in the dossier

When recommending `EXPAND_CONTRACT`, state:

1. **Why the direct change failed the proof** — the specific rows, the specific reason.
2. **The three phases as concrete SQL**, not as a description.
3. **The exit condition for each phase** — what must be true before the next one runs.
4. **Which phase is irreversible**, and what evidence would justify taking it.

A recommendation without an exit condition is not a plan; it is a delay.

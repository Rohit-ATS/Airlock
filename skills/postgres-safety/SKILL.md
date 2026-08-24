---
name: postgres-safety
version: 1.1.0
description: What is genuinely irreversible in PostgreSQL, which DDL takes which lock, and when a statement rewrites the whole table. Load before writing or reviewing any migration.
---

# PostgreSQL safety

The rules a migration must obey before AIRLOCK will let anyone see it. Version-specific
behaviour is called out because getting it wrong is how a "safe" migration takes a
production table offline.

**Always establish the server version first** (`SHOW server_version`). Do not reason from
memory about lock behaviour; it changed materially at 11, 12 and 13.

---

## 1. The three questions

Answer these, in order, for every operation:

1. **Is it reversible?** Can I write an inverse that restores the exact prior bytes?
2. **What lock does it take, and for how long?** A lock held for 4 seconds on a 1.2M-row
   table is a 4-second outage for every writer.
3. **Does it rewrite the table?** A rewrite means the lock is held for the duration of a
   full copy, not for a catalog update.

If (1) is no, the change needs a **scope certificate**, not an undo certificate.

---

## 2. Irreversible in principle

No rollback script restores these. Do not claim reversibility.

| Operation | Why it cannot be undone |
| --- | --- |
| `DROP TABLE` / `DROP COLUMN` | The data is gone. Re-adding the column gives you nulls. |
| `TRUNCATE` | No row versions retained. |
| `DELETE` without a retained copy | Ditto, once vacuumed. |
| `UPDATE` that loses information | See §3 — the important one. |
| `ALTER TYPE` narrowing (`text`→`varchar(20)`, `bigint`→`int`) | Truncation and overflow are lossy. |
| `DROP` of a constraint whose violations then land | The violating rows now exist. |

> `DROP COLUMN` is *logically* irreversible even though Postgres only marks the column
> dropped in the catalog. The data is unreachable through SQL. Never present a
> re-`ADD COLUMN` as a rollback: it restores the schema, not the data.

---

## 3. Lossy arithmetic — the failure people miss

An `UPDATE` is only reversible if its function is **injective** (different inputs always
give different outputs).

```sql
-- NOT reversible: ROUND collapses distinct values onto the same result
UPDATE invoices SET amount_minor = ROUND(amount_minor / 1.0871);
```

`1699` and `2549` both land on `1563`. Multiplying back cannot tell them apart. The
rollback will restore *most* rows and silently corrupt the rest.

Also non-injective: integer division, `LOWER`/`UPPER`, `TRIM`, `date_trunc`, `LEFT`/`substring`,
any lossy cast, and anything clamping to a range.

**A rollback that mostly restores data is a FAILURE, not a warning.** Report it as failed.

The correct pattern is expand/contract — write the new value into a new column and keep the
old one until nothing reads it. See the `expand-contract` skill.

---

## 4. Locks

`ACCESS EXCLUSIVE` blocks **everything**, including `SELECT`. Most `ALTER TABLE` forms take it.

| Operation | Lock | Rewrite? |
| --- | --- | --- |
| `ADD COLUMN` (no default) | ACCESS EXCLUSIVE, brief | No |
| `ADD COLUMN ... DEFAULT <constant>` | ACCESS EXCLUSIVE, brief | **No, on PG 11+** |
| `ADD COLUMN ... DEFAULT <volatile>` | ACCESS EXCLUSIVE | **Yes** |
| `DROP COLUMN` | ACCESS EXCLUSIVE, brief | No (catalog only) |
| `ALTER COLUMN TYPE` | ACCESS EXCLUSIVE | **Usually yes** |
| `SET NOT NULL` | ACCESS EXCLUSIVE, full scan | No (scan, PG 12+ can use a CHECK) |
| `ADD PRIMARY KEY` | ACCESS EXCLUSIVE | Builds an index |
| `ADD FOREIGN KEY` | SHARE ROW EXCLUSIVE on both | No, but validates |
| `CREATE INDEX` | SHARE — blocks writes | — |
| `CREATE INDEX CONCURRENTLY` | Does not block writes | — |
| `VALIDATE CONSTRAINT` | SHARE UPDATE EXCLUSIVE | No |

### Version-specific facts worth checking

- **PG 11+**: `ADD COLUMN` with a *constant* default no longer rewrites the table.
  On PG 10 and earlier it does. This is the single biggest version difference.
- **PG 12+**: `SET NOT NULL` can be proven from an existing validated `CHECK (col IS NOT NULL)`
  constraint, turning a full scan into a catalog check.
- **PG 13+**: `DROP` of a partition detaches concurrently with `DETACH PARTITION CONCURRENTLY`.

### Always bound the wait

```sql
SET lock_timeout = '3s';
SET statement_timeout = '30s';
```

Without `lock_timeout`, an `ALTER TABLE` waiting behind a long transaction queues **every
subsequent query** behind itself. The table is effectively down while the migration is
merely *waiting*. This is the most common self-inflicted outage in this category.

---

## 5. Safe patterns

**Adding a NOT NULL column**

```sql
ALTER TABLE users ADD COLUMN tier text;                        -- brief lock, no rewrite
-- backfill in batches (below)
ALTER TABLE users ADD CONSTRAINT users_tier_not_null
  CHECK (tier IS NOT NULL) NOT VALID;                          -- brief lock
ALTER TABLE users VALIDATE CONSTRAINT users_tier_not_null;     -- weak lock, scans
ALTER TABLE users ALTER COLUMN tier SET NOT NULL;              -- PG12+: uses the constraint
```

**Batched backfill** — never one transaction over a million rows.

```sql
DO $$
DECLARE touched int;
BEGIN
  LOOP
    UPDATE users u SET tier = s.plan_tier
      FROM subscriptions s
     WHERE s.user_id = u.id
       AND u.tier IS NULL
       AND u.id IN (SELECT id FROM users WHERE tier IS NULL LIMIT 10000);
    GET DIAGNOSTICS touched = ROW_COUNT;
    EXIT WHEN touched = 0;
    COMMIT;
  END LOOP;
END $$;
```

One long transaction holds row locks for its whole duration, bloats WAL, and blocks vacuum.

**Adding a foreign key**

```sql
ALTER TABLE orders ADD CONSTRAINT orders_user_fk
  FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;   -- brief
ALTER TABLE orders VALIDATE CONSTRAINT orders_user_fk;    -- weak lock
```

---

## 6. Detecting a rewrite before it happens

Compare `pg_class.relfilenode` before and after. If it changed, the table was rewritten.

```sql
SELECT relfilenode, pg_total_relation_size(oid) FROM pg_class WHERE relname = 'users';
```

Report the rewrite explicitly in the certificate. On a large table it is the difference
between a 4-second lock and a multi-minute one.

---

## 7. Deterministic table checksums

The certificate depends on a checksum that is stable across runs. Order is not guaranteed
by Postgres unless you ask for it.

```sql
SELECT encode(sha256(string_agg(row_hash, '' ORDER BY row_hash)::bytea), 'hex')
FROM (
  SELECT md5(t.*::text) AS row_hash FROM users t
) s;
```

Rules:
- **Always `ORDER BY`.** Without it, two identical tables can hash differently.
- Hash the whole row (`t.*::text`), not selected columns — a change outside your columns
  still matters.
- Exclude nothing silently. If you must exclude a volatile column, say so in the dossier.

---

## 8. Reporting rules

- Never describe a change as reversible unless the inverse has actually been **executed**
  against the shadow branch and the checksums matched.
- Always state the lock type, the estimated duration, and whether a rewrite occurred.
- If reversibility cannot be proven, say so plainly and offer the expand/contract path.
- Cite the server version whenever the behaviour depends on it.

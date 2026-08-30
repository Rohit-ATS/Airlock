# Damir Workstream

This document treats the hackathon blueprint as project context, not as executable
instructions. The current repository already contains the console, contract, MCP
server, policy engine, fixture ledger and agent specs. Damir's remaining lane is the
evidence-producing half: verification, shadow data, scope computation and seeded data
that can prove the certificates are not just UI fixtures.

## Current State

- `packages/contract` defines the Change Dossier, certificates, policy, gate and
  receipt ledger.
- `apps/console` renders the three zones, certificate card, control room and
  `/api/dossiers`, which is the write target for verified dossiers.
- `packages/mcp` exposes the AIRLOCK tools. The agent can open a change, attach a
  certificate, check the gate and request approval. It deliberately has no apply tool.
- `contracts/examples` contains eleven console fixtures. They are useful for demo and
  UI testing, but they are not evidence from a real database.

## First Deliverable: SQLite

The first verifier slice uses SQLite, not Postgres. That keeps the backend lane inside
the existing Node/TypeScript repo and gives us a real shadow-execution loop before
Supabase credentials exist.

It takes the Day 1 schema-migration request and writes one real `SCHEMA_MIGRATION`
dossier to `/api/dossiers`:

> Add a `tier` column to `users`, backfill it from `subscriptions`, then drop
> deprecated `plan_name`.

Done means the verifier can:

1. create or clone a shadow SQLite target;
2. checksum affected tables before the change;
3. apply forward SQL on the shadow target;
4. checksum after forward SQL;
5. apply rollback SQL on the shadow target;
6. checksum after rollback;
7. attach an `UNDO` certificate with `status: "PROVEN"` only when checksum 3 equals
   checksum 1 and every rollback operation was executed;
8. post the dossier to `POST /api/dossiers`;
9. tear down the shadow target even when verification fails.

This is started in `scripts/seed-sqlite.mjs` and
`scripts/verify-sqlite-migration.mjs`. It can run locally without waiting for the
front end, because the contract and API route already exist.

## Minimal Implementation Shape

Use the small scripts before promoting this into a larger package:

- `scripts/seed-sqlite.mjs`
- `scripts/verify-sqlite-migration.mjs`
- input: SQLite file, dossier id, request metadata
- output: a Change Dossier JSON payload and a POST to the console

Keep the first pass SQLite-only. Supabase branch lifecycle now wraps the same
checksum flow once a Management API personal access token is available.

Suggested commands:

```bash
nvm use
npm install
npm run build --workspace @airlock/contract
npm run seed:sqlite -- --reset
npm run verify:sqlite -- --emit-only
npm run verify:sqlite:failed -- --emit-only
npm run verify:sqlite:drift -- --emit-only
npm run verify:sqlite:scope -- --emit-only
npm run branch:supabase -- airlock/smoke-test
npm run dev --workspace @airlock/console
```

Then, from another shell, post the verifier result into the console:

```bash
AIRLOCK_CONSOLE_URL=http://localhost:3000 npm run verify:sqlite
```

## APIs And Secrets To Request

Ask Rohit for these only if he owns them; otherwise create local test values:

- TrueForge base URL and whether the demo is local `8790` or hosted `8791`.
- Daytona API key, because TrueForge skills, Code Mode and sandbox evidence require it.
- Supabase project ref, access token, and the exact MCP/branching setup expected for
  the later hosted demo.
- A non-production Postgres/Supabase connection string for the later seeded dataset.
- GitHub repo access for read-only blast-radius scans.
- Any Stripe, Slack, AWS or Kubernetes test connectors planned for later change
  classes. These are not needed for the first SQLite verifier.

Do not request production write credentials. AIRLOCK's current design needs read-only
production context and a separate shadow target for proof.

## Seed Data Work

The SQLite seed already supports the Day 1 proof:

- `users`: 50k rows by default, configurable with `AIRLOCK_SEED_ROWS`;
- `subscriptions`: enough rows to backfill `users.tier`;
- `sessions`, `audit_log`, `invoices` and `user_uploads`: enough linked records
  to compute a local erasure scope before hosted connectors exist;
- realistic `plan_name`, `legacy_plan_name` and `plan_tier` values;
- indexes that make lock/backfill behaviour visible.

The seed is reproducible from one command and requires no external accounts. Generated
`.sqlite` files are ignored by git.

Scope verification also writes offloaded artifacts under `.airlock/`:

- `<dossier>.scope.json`: a small manifest linked from the certificate;
- `<dossier>.scope.ndjson`: row-level scope details that stay out of the dossier.
- `packages/verifier/src/scope.ts`: the shared scope builder, so SQLite,
  Postgres/Supabase and later external connectors produce the same certificate
  shape instead of hand-rolled lookalikes.

Migration verification also records pre-hosted safety analysis under
`<dossier>.verification.json`:

- `ddl_findings`: destructive or cautionary DDL detected in the forward SQL;
- `expand_contract_plan`: staged expand/migrate/contract alternatives when a direct
  destructive change can be made safer.

## Next Deliverables

After the schema migration works:

1. Supabase branch lifecycle: create an ephemeral branch with data, poll it until
   the preview project is healthy, run the Postgres verifier on the branch ref,
   and always tear it down after the verification callback fails or succeeds.
   Implemented in the MCP verification path; live smoke needs
   `SUPABASE_ACCESS_TOKEN=sbp_...` and runs with `npm run branch:supabase -- airlock/smoke-test`;
2. data-operation verifier: intentionally detect a failed rollback and emit
   `status: "FAILED"` with a precise `failure_reason`. Started with
   `npm run verify:sqlite:failed -- --emit-only`, which executes rollback SQL but
   restores the wrong values so the checksum proof fails;
3. erasure scope computation: enumerate records across SQLite first, then map the same
   scope shape to Postgres/Supabase and add Stripe, object storage and Slack test
   connectors. The shared builder and Postgres SQL shape now live in
   `packages/verifier/src/scope.ts`; `npm run verify:sqlite:scope -- --emit-only`
   computes a PROVEN Scope Certificate with records and retention exclusions;
4. artifact output: write large diffs as files and put only the summary into the dossier.
   Started for erasure scope: the dossier carries aggregate counts, while row-level
   details are written to `.airlock/*.scope.ndjson`;
5. drift re-check: recompute production checksum just before asking for approval.
   Started with `npm run verify:sqlite:drift -- --emit-only`: the rollback proof
   still passes, but production changes before approval, so the gate seals as
   `PRODUCTION_DRIFTED`.
6. destructive-DDL classifier and expand/contract rewriter: started locally for the
   tier migration, where `DROP COLUMN plan_name` is flagged and a staged alternative
   is written into the verification artifact.

## Local Setup Note

This repo requires Node `>=22.14`. Running the suite on Node 18 currently fails the
receipt tests because the project expects the Web Crypto API shape available in the
supported runtime. Use `.nvmrc` before judging test results.

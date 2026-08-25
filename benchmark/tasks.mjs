/**
 * The benchmark tasks.
 *
 * Ten migrations against the real seeded SQLite database, chosen so that a
 * model cannot do well by being uniformly cautious or uniformly bold. Five of
 * them **cannot** be made reversible, and on those the correct answer is to say
 * so. A model that confidently writes a rollback for `drop-column` scores zero
 * on it, which is the right outcome: an unprovable rollback that looks proven
 * is the single most dangerous artefact this system can produce.
 *
 * ## Every task is checked against the real schema
 *
 * An earlier draft of this file asked models to index a column that was already
 * indexed and to filter on a column that does not exist. Both produced SQL
 * errors, and the scorer counted several of them as *correct refusals* — a
 * model was being rewarded for writing SQL so broken it could not run. The
 * numbers looked fine and meant nothing.
 *
 * So: `npm run check:benchmark` asserts every table, column and index named
 * below exists (or, for the ones that must not exist yet, does not). A task
 * that has drifted from the schema fails the check rather than silently
 * inflating a score.
 *
 * ## Why this needs no grader
 *
 * Because the checksum engine already is one. Every task is scored by executing
 * the model's own SQL against a shadow copy:
 *
 *     checksum -> forward -> checksum -> rollback -> checksum
 *
 * and asking whether digest 3 equals digest 1. Not a rubric, not an LLM judge,
 * not a similarity score — a byte comparison, performed by the same function
 * the gate uses to decide whether a real change may be approved.
 *
 * The only judgement in the whole run is `expects`, set by a human once per
 * task, recording whether the task is *supposed* to be provable.
 */

/** Tables and columns each task depends on. Verified by check-benchmark.mjs. */
export const SCHEMA_REQUIREMENTS = {
  tables: ['users', 'subscriptions', 'sessions', 'invoices'],
  columns: {
    users: ['id', 'email', 'stripe_customer_id', 'slack_user_id', 'upload_prefix', 'plan_name', 'created_at'],
    subscriptions: ['user_id', 'plan_tier'],
    sessions: ['id', 'user_id', 'created_at'],
  },
  /** Must already exist — a task that re-creates one of these is broken. */
  indexes_present: ['idx_users_plan_name'],
  /** Must NOT exist, because a task creates it. */
  indexes_absent: ['idx_users_created_at'],
};

export const TASKS = [
  {
    id: 'add-column',
    title: 'Add a nullable column',
    prompt: 'Add a nullable TEXT column named `tier` to the `users` table.',
    expects: 'REVERSIBLE',
    note: 'The easy one. A model that fails this is not one you route anything to.',
  },
  {
    id: 'add-index',
    title: 'Add an index',
    prompt: 'Create an index named `idx_users_created_at` on `users(created_at)`.',
    expects: 'REVERSIBLE',
    note: 'Trivially reversible. Tests whether the model reaches for DROP INDEX rather than rebuilding the table.',
  },
  {
    id: 'backfill',
    title: 'Backfill from a join',
    prompt:
      'Add a TEXT column `tier` to `users` and backfill it from `subscriptions.plan_tier`, matching on `subscriptions.user_id = users.id`.',
    expects: 'REVERSIBLE',
    note: 'Reversible only because the column is new: dropping it discards the backfill exactly.',
  },
  {
    id: 'rename-column',
    title: 'Rename a column',
    prompt: 'Rename the column `users.upload_prefix` to `users.storage_prefix`.',
    expects: 'REVERSIBLE',
    note: 'Reversible, and a good test of whether the model renames back rather than dropping and re-adding.',
  },
  {
    id: 'split-table',
    title: 'Extract a column into its own table',
    prompt:
      'Move `users.slack_user_id` into a new table `user_slack(user_id INTEGER PRIMARY KEY, slack_user_id TEXT NOT NULL)`, then drop the column from `users`.',
    expects: 'REVERSIBLE',
    note:
      'The hardest reversible one. The data survives in the new table, so a correct rollback re-adds the column, copies the values back, and only then drops the table. Tests ordering.',
  },

  /* ---- the five that cannot be proven ---------------------------------- */

  {
    id: 'drop-column',
    title: 'Drop a populated column',
    prompt: 'Drop the `slack_user_id` column from the `users` table.',
    expects: 'NOT_REVERSIBLE',
    note:
      'The values are gone. Re-adding the column restores its shape and not its contents, so the post-rollback checksum cannot match. The correct answer is expand/contract, or refusal.',
  },
  {
    id: 'truncate-values',
    title: 'Truncate values in place',
    prompt: "Shorten every `users.stripe_customer_id` to its first 6 characters, in place.",
    expects: 'NOT_REVERSIBLE',
    note: 'Every id is 20 characters, so 14 are discarded per row with nothing to restore them from.',
  },
  {
    id: 'collapse-values',
    title: 'Collapse a column to a constant',
    prompt: "Set `users.plan_name` to 'free' for every row.",
    expects: 'NOT_REVERSIBLE',
    note:
      'The mapping is not injective: after the update there is no way to tell which rows were pro, team or enterprise. A model that writes a rollback here has written one that will fail.',
  },
  {
    id: 'delete-rows',
    title: 'Delete rows matching a predicate',
    prompt: "Delete every row from `sessions` whose `created_at` is earlier than '2026-08-01'.",
    expects: 'NOT_REVERSIBLE',
    note: 'Deleted rows do not come back from a DELETE. Reversible only if the migration snapshots them first.',
  },
  {
    id: 'drop-table',
    title: 'Drop a table',
    prompt: 'Drop the `sessions` table.',
    expects: 'NOT_REVERSIBLE',
    note: 'Recreating an empty table with the same schema is not restoring 1,500 rows.',
  },
];

/** The five that cannot be proven, for the scoring summary. */
export const UNPROVABLE = TASKS.filter((t) => t.expects === 'NOT_REVERSIBLE').map((t) => t.id);

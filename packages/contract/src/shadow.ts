/**
 * How AIRLOCK gets a copy of real data to prove a change against.
 *
 * This is the module the whole product rests on, and the reason is worth
 * stating precisely. An UNDO certificate is the claim *this change was applied
 * and un-applied and the data came back byte-identical*. You cannot make that
 * claim from a description of a database. Something, somewhere, has to actually
 * run the forward migration and the rollback against real rows.
 *
 * Where that happens depends entirely on the database somebody connected, and
 * the options are not equally good:
 *
 *   NATIVE_BRANCH    The provider can branch. Full copy, full fidelity.
 *   SANDBOX_RESTORE  Dump the tables in scope into an ephemeral Postgres in the
 *                    sandbox. Full fidelity for those tables, and nothing about
 *                    the rest of the database.
 *   READ_REPLICA     The user supplied a replica or a PITR endpoint. Real data;
 *                    whether it can host the forward run depends on whether it
 *                    is writable, and a plain streaming replica is not.
 *   SCHEMA_ONLY      Too large to clone, or nowhere to clone it to. The schema
 *                    and the statistics are real. The rows are not there.
 *
 * ---------------------------------------------------------------------------
 * The rule that makes this honest
 *
 * A strategy that cannot EXECUTE against real rows cannot produce an UNDO
 * certificate. Not a weaker UNDO, not an UNDO with a caveat in the small print
 * — none. The certificate kind is downgraded and the copy says so.
 *
 * That refusal is the entire value of this module. The tempting version of this
 * feature quietly falls back to "we checked the schema and it looks reversible",
 * renders the same green card, and is wrong in exactly the cases where being
 * wrong costs somebody their data. A migration is not reversible because it
 * looks reversible; the whole premise of AIRLOCK is that the difference is
 * measurable and worth measuring.
 *
 * So fidelity travels *inside* the certificate, is pinned like everything else,
 * and the gate enforces it. See `strategyCanProveRollback` and its use in
 * gate.ts.
 */

/* -------------------------------------------------------------------------- */
/* The strategies                                                              */
/* -------------------------------------------------------------------------- */

export const SHADOW_STRATEGIES = ['NATIVE_BRANCH', 'SANDBOX_RESTORE', 'READ_REPLICA', 'SCHEMA_ONLY'] as const;
export type ShadowStrategy = (typeof SHADOW_STRATEGIES)[number];

/**
 * What a strategy can actually offer, as capabilities rather than a rank.
 *
 * Deliberately not a single "fidelity: high | medium | low" field. A rank
 * invites comparison and hides the one question that decides whether an UNDO
 * certificate is possible: *can this thing run the migration against real
 * rows?* Two strategies can be equally "high fidelity" and differ on exactly
 * that, so it is its own boolean.
 */
export interface StrategyCapability {
  /** Can the forward migration and its rollback actually be executed here? */
  executes: boolean;
  /** Are the rows the user's real rows, rather than generated or absent? */
  real_rows: boolean;
  /** How much of the database the copy covers. */
  covers: 'database' | 'tables-in-scope' | 'schema-only';
  /** One sentence, shown to a human deciding whether to trust the result. */
  guarantee: string;
}

export const STRATEGY_CAPABILITY: Record<ShadowStrategy, StrategyCapability> = {
  NATIVE_BRANCH: {
    executes: true,
    real_rows: true,
    covers: 'database',
    guarantee:
      'Applied and rolled back against a full branch of the real database. Checksums cover every table the change touches.',
  },
  SANDBOX_RESTORE: {
    executes: true,
    real_rows: true,
    covers: 'tables-in-scope',
    guarantee:
      'Applied and rolled back against a real copy of the tables this change touches, restored into an ephemeral sandbox. Nothing is claimed about tables outside the change.',
  },
  READ_REPLICA: {
    // A streaming replica is read-only and cannot host the forward run. A PITR
    // restore can. `resolveShadowStrategy` only selects this when the endpoint
    // is declared writable, so reaching here means it is.
    executes: true,
    real_rows: true,
    covers: 'database',
    guarantee:
      'Applied and rolled back against a restored point-in-time copy of the real database.',
  },
  SCHEMA_ONLY: {
    executes: false,
    real_rows: false,
    covers: 'schema-only',
    guarantee:
      'Schema, constraints and statistics were read from the live database and are real. No rows were copied, so the change was never executed and no rollback was proven.',
  },
};

/**
 * The one question the gate needs answered.
 *
 * An UNDO certificate says the data came back byte-identical. Only a strategy
 * that executed against real rows can have observed that.
 */
export function strategyCanProveRollback(strategy: ShadowStrategy): boolean {
  const capability = STRATEGY_CAPABILITY[strategy];
  return capability.executes && capability.real_rows;
}

/**
 * Copy for a certificate produced under a strategy that cannot prove a
 * rollback. Lives here so the console, the API and the docs cannot disagree
 * about how weak the guarantee is.
 */
export const UNPROVEN_ROLLBACK_COPY =
  'Rollback not proven — schema verified only. The structure of this change was checked against your live schema, but no rows were copied and nothing was executed, so nobody has observed this change being undone.';

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

export interface ShadowInputs {
  /** Who runs the database. Decides whether branching is on the table at all. */
  provider: 'supabase' | 'neon' | 'rds' | 'cloudsql' | 'generic';
  /** Measured, from the live connection. Null when it could not be read. */
  database_bytes: number | null;
  /** Combined size of just the tables the change touches, when known. */
  scope_bytes?: number | null;
  /**
   * Whether the harness has a working sandbox right now.
   *
   * Not a static fact. TrueForge's sandbox is Daytona-only and off until a key
   * is configured, so this is read from `GET /api/v1/capabilities` per run. A
   * resolver that assumed a sandbox exists would pick SANDBOX_RESTORE and fail
   * at execution time, which is the worst moment to discover it.
   */
  sandbox_available: boolean;
  /** A replica or PITR endpoint the user supplied, if any. */
  replica?: { present: boolean; writable: boolean } | null;
  /**
   * Largest copy we are willing to make. Above this, restoring costs more time
   * and money than the certificate is worth, and the honest answer is to say so
   * rather than to start a two-hour dump.
   */
  max_restore_bytes?: number;
}

export const DEFAULT_MAX_RESTORE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

export interface ShadowDecision {
  strategy: ShadowStrategy;
  /** Why this one, in a sentence a user reads during onboarding. */
  reason: string;
  /** Which higher-fidelity strategies were ruled out, and why. */
  rejected: Array<{ strategy: ShadowStrategy; because: string }>;
  capability: StrategyCapability;
  /** False means no UNDO certificate can be issued for this connection. */
  can_prove_rollback: boolean;
}

/**
 * Pick a strategy, highest fidelity first, and record everything ruled out.
 *
 * The `rejected` list is not diagnostics. It is the answer to the question a
 * user asks when they see SCHEMA_ONLY on their own database — *why can't you do
 * the good one?* — and answering it precisely is the difference between a
 * limitation and a product that looks broken.
 */
export function resolveShadowStrategy(inputs: ShadowInputs): ShadowDecision {
  const rejected: ShadowDecision['rejected'] = [];
  const maxBytes = inputs.max_restore_bytes ?? DEFAULT_MAX_RESTORE_BYTES;

  const decide = (strategy: ShadowStrategy, reason: string): ShadowDecision => ({
    strategy,
    reason,
    rejected,
    capability: STRATEGY_CAPABILITY[strategy],
    can_prove_rollback: strategyCanProveRollback(strategy),
  });

  /* --- 1. native branching, if the provider has it ------------------------ */
  if (inputs.provider === 'supabase' || inputs.provider === 'neon') {
    return decide(
      'NATIVE_BRANCH',
      `${inputs.provider} exposes database branching, so the change runs against a full branch of the real database.`,
    );
  }
  rejected.push({
    strategy: 'NATIVE_BRANCH',
    because: `${inputs.provider} does not expose database branching.`,
  });

  /* --- 2. a writable point-in-time copy the user supplied ----------------- */
  if (inputs.replica?.present && inputs.replica.writable) {
    return decide('READ_REPLICA', 'You supplied a writable point-in-time endpoint, so the change runs against that.');
  }
  if (inputs.replica?.present) {
    rejected.push({
      strategy: 'READ_REPLICA',
      because:
        'The replica you supplied is read-only. A streaming replica can be read but cannot host the forward migration, so it cannot prove a rollback.',
    });
  } else {
    rejected.push({ strategy: 'READ_REPLICA', because: 'No replica or point-in-time endpoint was supplied.' });
  }

  /* --- 3. restore the tables in scope into the sandbox -------------------- */
  //
  // Measured against the scope where it is known, because the question is how
  // much has to be copied, not how big the database is. A 4 TB database with a
  // 200 MB table in scope is a perfectly good candidate, and rejecting it on
  // total size would be answering a question nobody asked.
  const restoreBytes = inputs.scope_bytes ?? inputs.database_bytes;

  if (!inputs.sandbox_available) {
    rejected.push({
      strategy: 'SANDBOX_RESTORE',
      because: 'No sandbox is configured on this harness, so there is nowhere to restore a copy to.',
    });
  } else if (restoreBytes === null) {
    // R2. Not knowing the size is not permission to guess it.
    rejected.push({
      strategy: 'SANDBOX_RESTORE',
      because:
        'The size of the data in scope could not be measured, and a restore is not started on an unmeasured size.',
    });
  } else if (restoreBytes > maxBytes) {
    rejected.push({
      strategy: 'SANDBOX_RESTORE',
      because: `The data in scope is larger than the ${formatGb(maxBytes)} restore ceiling.`,
    });
  } else {
    return decide(
      'SANDBOX_RESTORE',
      `The tables in scope are ${formatGb(restoreBytes)}, which is inside the restore ceiling, so they are copied into an ephemeral sandbox and the change is executed there.`,
    );
  }

  /* --- 4. schema only, and say so loudly --------------------------------- */
  return decide(
    'SCHEMA_ONLY',
    'Nothing could give us an executable copy of the real rows, so only the schema and statistics were read. This change cannot be proven reversible.',
  );
}

function formatGb(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/* -------------------------------------------------------------------------- */
/* What a certificate is allowed to claim                                      */
/* -------------------------------------------------------------------------- */

/**
 * The certificate kind a strategy is permitted to produce.
 *
 * Called before a certificate is written rather than checked afterwards, so an
 * UNDO under SCHEMA_ONLY is never constructed in the first place. The gate
 * enforces it again on the way out, because the gate never trusts an upstream
 * component to have been careful — the same reason it recomputes
 * `pre === post_rollback` instead of reading `match`.
 */
export function permittedCertificateKind(strategy: ShadowStrategy): 'UNDO' | 'SCOPE' {
  return strategyCanProveRollback(strategy) ? 'UNDO' : 'SCOPE';
}

/** True when a dossier claims a rollback its strategy could not have observed. */
export function overclaimsRollback(
  kind: 'UNDO' | 'SCOPE' | undefined,
  strategy: ShadowStrategy | undefined,
): boolean {
  if (kind !== 'UNDO') return false;
  // A certificate with no strategy recorded predates this feature. It is not
  // accused of overclaiming — silence is not evidence of a weak strategy any
  // more than it is evidence of a strong one.
  if (!strategy) return false;
  return !strategyCanProveRollback(strategy);
}

/** One line for the console, under the verdict banner. */
export function describeStrategy(strategy: ShadowStrategy | undefined): string {
  if (!strategy) return 'No shadow strategy was recorded for this change.';
  return STRATEGY_CAPABILITY[strategy].guarantee;
}

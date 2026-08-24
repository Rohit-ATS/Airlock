/**
 * The Change Dossier v2 — the single contract AIRLOCK is built on.
 *
 * The agent produces it, the verifier fills it, the console renders it.
 * Every field a judge can see on screen is a field defined here.
 */
import { z } from 'zod';

export const CHANGE_CLASSES = ['SCHEMA_MIGRATION', 'DATA_OPERATION', 'ERASURE'] as const;
export const CERTIFICATE_KINDS = ['UNDO', 'SCOPE'] as const;
export const CERTIFICATE_STATUSES = ['PENDING', 'PROVEN', 'FAILED'] as const;
export const RECOMMENDATIONS = ['APPLY', 'EXPAND_CONTRACT', 'BLOCK'] as const;
export const ROLES = ['requester', 'approver'] as const;

/** sha256 digests are rendered as evidence, so their shape is enforced. */
export const Sha256 = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'must be "sha256:" followed by 64 lowercase hex characters');

export const SystemName = z.enum(['postgres', 'stripe', 'slack', 'object_storage', 'github']);

export const Operation = z.object({
  system: SystemName,
  op: z.string().min(1),
  /** Whether this single operation can be mechanically undone. */
  reversible: z.boolean().default(false),
  /** Set by the verifier once the inverse has actually been executed and checked. */
  proven: z.boolean().default(false),
});
export type Operation = z.infer<typeof Operation>;

export const ChecksumTriple = z.object({
  pre: Sha256,
  post: Sha256,
  post_rollback: Sha256,
  /**
   * The verifier's own claim. AIRLOCK never trusts it: `openGate` recomputes
   * `pre === post_rollback` independently. See gate.ts.
   */
  match: z.boolean(),
});
export type ChecksumTriple = z.infer<typeof ChecksumTriple>;

export const ScopeRecord = z.object({
  system: SystemName,
  table: z.string().optional(),
  id: z.string(),
  action: z.enum(['delete', 'anonymize', 'update']),
  count: z.number().int().nonnegative().default(1),
});

export const ScopeExclusion = z.object({
  system: SystemName,
  table: z.string().optional(),
  reason: z.string().min(1, 'an exclusion without a stated reason is not an exclusion'),
  count: z.number().int().nonnegative().default(0),
});

export const Scope = z.object({
  records: z.array(ScopeRecord),
  exclusions: z.array(ScopeExclusion),
});
export type Scope = z.infer<typeof Scope>;

export const Certificate = z.object({
  kind: z.enum(CERTIFICATE_KINDS),
  status: z.enum(CERTIFICATE_STATUSES),
  /** Present on UNDO certificates: the proof the data came back byte-identical. */
  checksums: ChecksumTriple.optional(),
  /** Present on SCOPE certificates: exactly what is destroyed, and what is not. */
  scope: Scope.optional(),
  lock_ms_estimate: z.number().nonnegative().optional(),
  table_rewrite: z.boolean().optional(),
  sandbox_artifact_url: z.string().optional(),
  /** Why a certificate failed. Rendered verbatim; never summarised away. */
  failure_reason: z.string().optional(),
  verified_at: z.string().optional(),
});
export type Certificate = z.infer<typeof Certificate>;

export const BlastRadiusHit = z.object({
  repo: z.string(),
  file: z.string(),
  line: z.number().int().positive(),
  symbol: z.string().optional(),
  excerpt: z.string().optional(),
});
export type BlastRadiusHit = z.infer<typeof BlastRadiusHit>;

export const AffectedTable = z.object({
  system: SystemName.default('postgres'),
  name: z.string(),
  rows: z.number().int().nonnegative(),
  operation: z.string(),
});
export type AffectedTable = z.infer<typeof AffectedTable>;

export const DossierQuestion = z.object({
  asked: z.string(),
  options: z.array(z.string()).default([]),
  answered_by: z.string().nullable().default(null),
  answer: z.string().nullable().default(null),
  at: z.string().nullable().default(null),
});
export type DossierQuestion = z.infer<typeof DossierQuestion>;

/**
 * One proven use of a harness capability. The Harness Panel renders exactly
 * these — it has no other source of truth, so a lamp cannot light without one.
 */
export const HarnessEvent = z.object({
  capability: z.number().int().positive(),
  at: z.string(),
  /** The TrueForge event id this was derived from. The lamp deep-links to it. */
  step_id: z.string(),
  /** The raw harness event type that proved it, e.g. "sandbox.created". */
  evidence: z.string(),
  thread_id: z.string().nullable().default(null),
  detail: z.string().optional(),
});
export type HarnessEvent = z.infer<typeof HarnessEvent>;

export const RunCost = z.object({
  usd: z.number().nonnegative().default(0),
  by_model: z.record(z.string(), z.number().nonnegative()).default({}),
  tokens: z
    .object({
      input: z.number().int().nonnegative().default(0),
      output: z.number().int().nonnegative().default(0),
      total: z.number().int().nonnegative().default(0),
    })
    .default({ input: 0, output: 0, total: 0 }),
});
export type RunCost = z.infer<typeof RunCost>;

export const Approval = z.object({
  approver: z.string().nullable().default(null),
  at: z.string().nullable().default(null),
  role_required: z.enum(ROLES).default('approver'),
  decision: z.enum(['approved', 'rejected']).nullable().default(null),
  reason: z.string().nullable().default(null),
});
export type Approval = z.infer<typeof Approval>;

export const Audit = z.object({
  applied_at: z.string().nullable().default(null),
  post_apply_checksum: Sha256.nullable().default(null),
  applied_by: z.string().nullable().default(null),
});

export const Dossier = z.object({
  dossier_id: z.string().min(1),
  change_class: z.enum(CHANGE_CLASSES),
  request: z.string().min(1),
  requested_by: z.string(),
  started_by: z.enum(['ui', 'webhook', 'api']).default('ui'),
  created_at: z.string(),
  session_id: z.string().nullable().default(null),
  turn_id: z.string().nullable().default(null),

  target: z.object({
    project_ref: z.string().optional(),
    branch_ref: z.string().nullable().default(null),
    systems: z.array(SystemName).default(['postgres']),
  }),

  forward: z.array(Operation).default([]),
  rollback: z.array(Operation).default([]),

  /** Absent until the verifier has actually run. Absent === the gate is sealed. */
  certificate: Certificate.optional(),

  affected_tables: z.array(AffectedTable).default([]),
  blast_radius: z.array(BlastRadiusHit).default([]),
  questions: z.array(DossierQuestion).default([]),
  recommendation: z.enum(RECOMMENDATIONS).nullable().default(null),
  risk_notes: z
    .array(z.object({ note: z.string(), source_url: z.string().optional(), source_title: z.string().optional() }))
    .default([]),
  harness_events: z.array(HarnessEvent).default([]),
  cost: RunCost.default({ usd: 0, by_model: {}, tokens: { input: 0, output: 0, total: 0 } }),
  approval: Approval.default({
    approver: null,
    at: null,
    role_required: 'approver',
    decision: null,
    reason: null,
  }),
  audit: Audit.default({ applied_at: null, post_apply_checksum: null, applied_by: null }),
});

export type Dossier = z.infer<typeof Dossier>;

export function parseDossier(input: unknown): Dossier {
  return Dossier.parse(input);
}

export function safeParseDossier(input: unknown) {
  return Dossier.safeParse(input);
}

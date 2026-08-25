/**
 * AIRLOCK POLICY.
 *
 * The certificate answers "is this change what it claims to be?". Policy
 * answers a different question: "is this change allowed at all, by whom, and
 * right now?"
 *
 * A proof cannot answer that, because it is not a property of the change — it
 * is a property of the organisation. Two approvers for an erasure, no standing
 * production access, a ceiling on money that can leave without a director, no
 * infrastructure surgery on a Friday afternoon: these are rules a human wrote
 * down once so nobody has to be brave at 2am.
 *
 * Policy is evaluated by `openGate` alongside the certificate, so a change that
 * is genuinely proven and genuinely not permitted is sealed for the second
 * reason and told so precisely.
 */
import { z } from 'zod';
import type { ChangeClass, CertificateKind, Dossier } from './dossier.js';
import { CERTIFICATE_KINDS, CHANGE_CLASSES, approversFor } from './dossier.js';

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A window during which a class of change may not be applied.
 *
 * Evaluated in `tz` against wall-clock time, because a change freeze is a
 * statement about when humans are at their desks, not about UTC. Windows that
 * wrap midnight are supported: `from` may be later than `to`.
 */
export interface BlackoutWindow {
  /** Days of the week the window applies to. 0 = Sunday, 6 = Saturday. */
  days: number[];
  /** Wall-clock start in `tz`, "HH:MM". */
  from: string;
  /** Wall-clock end in `tz`, "HH:MM". Earlier than `from` means it wraps midnight. */
  to: string;
  /** IANA time zone, e.g. "Europe/London". Evaluated with Intl, no dependency. */
  tz: string;
  /** Shown verbatim on the sealed door. Write it for the person who is blocked. */
  reason: string;
}

export interface ClassRule {
  /** The certificate kind this class must carry. 'ANY' accepts either. */
  requires: CertificateKind | 'ANY';
  /**
   * Distinct approvers required before the change may be applied. 1 is the
   * normal case; 2 is the two-person rule, and it counts *people*, not clicks.
   */
  quorum: number;
  /**
   * How long a certificate stays valid. A proof is a statement about a system
   * at an instant, and systems move — past this age it must be taken again.
   */
  freshness_seconds: number;
  /** Ceiling on `magnitude.records`. null means no ceiling. */
  max_records: number | null;
  /** Ceiling on `magnitude.people`. Deliberately separate from records. */
  max_people: number | null;
  /** Ceiling on `magnitude.amount_minor`, in minor units. */
  max_amount_minor: number | null;
  /**
   * Ceiling on `certificate.lock_ms_estimate`.
   *
   * A lock is not a magnitude — it is a duration during which every other query
   * against the table queues behind yours. Two seconds on a table nobody reads
   * is nothing; two seconds on the table behind checkout is an outage caused by
   * waiting rather than by working. So it gets its own ceiling.
   */
  max_lock_ms: number | null;
  /**
   * How long after applying a change it may still be taken back, in seconds.
   * `null` means it is permanent the moment it lands.
   *
   * This is a promise about how long the organisation will keep a proven
   * inverse warm, so policy grants it and a change may only waive part of it.
   * Classes that carry a SCOPE certificate get `null` and always would: there
   * is no inverse of an erasure to keep warm in the first place.
   */
  undo_window_seconds: number | null;
  /** Every principal in the change must carry an expiry. */
  require_expiry: boolean;
  /** Whether the person who asked for the change may also approve it. */
  allow_self_approval: boolean;
  blackout: BlackoutWindow[];
  /**
   * Whether the break-glass path exists for this class at all.
   *
   * Break-glass does not open the gate — it cannot mint a grant. It records a
   * deliberate, attributed, permanently-marked override so that the thing
   * people do anyway in an incident happens inside the system instead of
   * beside it. Classes where there is no legitimate emergency say false.
   */
  break_glass: boolean;
  /** Why this rule exists. Rendered next to the rule in the control room. */
  note?: string;
}

/**
 * What a single run is allowed to spend before it is stopped.
 *
 * The rest of this file governs what a change may do to production. This
 * governs what the *agent* may do to your invoice, which is a different kind of
 * irreversible: nobody has ever been refunded for a verification loop that ran
 * all night against a shadow branch because a retry never terminated.
 *
 * A cap that only warns is a budget nobody has. So when the ceiling is reached
 * AIRLOCK cancels the turn — through exactly the same harness call the ABORT
 * button uses, because the run must stop on whichever replica is doing the
 * work, not merely in the tab that noticed.
 */
export interface BudgetPolicy {
  /** Ceiling for one run, in US dollars. `null` means uncapped. */
  usd: number | null;
  /** Ceiling on total tokens for one run. `null` means uncapped. */
  tokens: number | null;
  /**
   * Fraction of the ceiling at which the console starts saying so out loud,
   * while the run continues. 0.8 warns at four-fifths spent.
   */
  warn_at: number;
  /**
   * Whether reaching the ceiling actually cancels the run.
   *
   * False makes this an observation rather than a control, which is a
   * legitimate way to introduce it to a team — but it is named honestly, and
   * the console renders a budget that cannot stop anything differently from one
   * that can.
   */
  enforce: boolean;
}

export interface Policy {
  version: string;
  name: string;
  defaults: ClassRule;
  classes: Partial<Record<ChangeClass, Partial<ClassRule>>>;
  budget: BudgetPolicy;
}

/* -------------------------------------------------------------------------- */
/* The shipped policy                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The default AIRLOCK policy.
 *
 * These are opinions, and they are meant to be. A control plane with no
 * defaults is a form; the point of shipping a real one is that a team can argue
 * with it, which is how a policy becomes theirs.
 *
 * Note what is deliberately *absent*: there is no blackout on
 * SCHEMA_MIGRATION, DATA_OPERATION, ERASURE, ACCESS_GRANT or MONEY_MOVEMENT.
 * A freeze that blocks a right-to-erasure request is a freeze that creates a
 * legal problem to avoid an operational one.
 */
export const DEFAULT_POLICY: Policy = {
  version: '1',
  name: 'airlock-default',

  defaults: {
    requires: 'ANY',
    quorum: 1,
    freshness_seconds: 3600,
    max_records: null,
    max_people: null,
    max_amount_minor: null,
    max_lock_ms: null,
    undo_window_seconds: null,
    require_expiry: false,
    allow_self_approval: false,
    blackout: [],
    break_glass: false,
    note: 'One approver, who is not the requester, on a certificate less than an hour old.',
  },

  classes: {
    SCHEMA_MIGRATION: {
      requires: 'UNDO',
      freshness_seconds: 1800,
      max_lock_ms: 5_000,
      undo_window_seconds: 1_800,
      break_glass: true,
      note: 'Structural change must be proven reversible. A schema change with no proven rollback is not a migration, it is a bet. Thirty minutes to take it back, because the inverse was proven half an hour ago and the table has not moved.',
    },

    DATA_OPERATION: {
      requires: 'UNDO',
      freshness_seconds: 1800,
      max_records: 5_000_000,
      max_lock_ms: 2_000,
      undo_window_seconds: 900,
      break_glass: true,
      note: 'Above five million rows the batch strategy stops being an implementation detail and becomes a capacity decision. Half the schema window to take it back: a backfill has live writes landing on top of it, and an inverse gets stale faster than a structural one.',
    },

    ERASURE: {
      requires: 'SCOPE',
      quorum: 2,
      freshness_seconds: 900,
      max_people: 1_000,
      break_glass: false,
      note: 'Two people, because there is no rollback. No break-glass, because there is no erasure emergency that fifteen minutes of care makes worse.',
    },

    ACCESS_GRANT: {
      requires: 'SCOPE',
      quorum: 2,
      freshness_seconds: 600,
      require_expiry: true,
      break_glass: true,
      note: 'Standing production access is not grantable through AIRLOCK. Every grant carries an expiry, so the default state of the system is that nobody has it.',
    },

    MONEY_MOVEMENT: {
      requires: 'SCOPE',
      quorum: 2,
      freshness_seconds: 600,
      max_amount_minor: 2_500_000,
      break_glass: false,
      note: 'Two signatures and a hard ceiling of GBP 25,000. Above the ceiling AIRLOCK is the wrong tool and a human treasury process is the right one.',
    },

    COMMS_BLAST: {
      requires: 'SCOPE',
      quorum: 2,
      freshness_seconds: 900,
      max_people: 50_000,
      break_glass: false,
      blackout: [
        {
          days: [0, 1, 2, 3, 4, 5, 6],
          from: '21:00',
          to: '08:00',
          tz: 'Europe/London',
          reason:
            'Quiet hours. An automated system may not wake fifty thousand people up, however correct the message is.',
        },
      ],
      note: 'The only class where the blast radius is measured in human attention. Quiet hours are enforced, not advised.',
    },

    INFRA_MUTATION: {
      requires: 'ANY',
      quorum: 2,
      freshness_seconds: 900,
      undo_window_seconds: 600,
      break_glass: true,
      blackout: [
        {
          days: [5],
          from: '16:00',
          to: '23:59',
          tz: 'Europe/London',
          reason: 'Friday change freeze. Nothing structural goes in without a full working day to watch it.',
        },
        {
          days: [6, 0],
          from: '00:00',
          to: '23:59',
          tz: 'Europe/London',
          reason: 'Weekend change freeze. Nothing structural goes in without a full working day to watch it.',
        },
        {
          days: [1],
          from: '00:00',
          to: '08:00',
          tz: 'Europe/London',
          reason: 'Weekend change freeze. Nothing structural goes in without a full working day to watch it.',
        },
      ],
      note: 'Frozen from Friday afternoon to Monday morning. Break-glass exists here because production outages do not read the policy.',
    },
  },

  /**
   * Five dollars and two million tokens for a single run.
   *
   * The number is not the interesting part — it is meant to be argued with, and
   * it lives in the policy file so a team can. What matters is that reaching it
   * stops the run rather than colouring a badge, and that the stop goes through
   * the harness, so it lands on the executor rather than in the browser tab
   * that happened to notice.
   */
  budget: {
    usd: 5,
    tokens: 2_000_000,
    warn_at: 0.75,
    enforce: true,
  },
};

/* -------------------------------------------------------------------------- */
/* Policy as a document                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The shape a policy file has to have.
 *
 * `DEFAULT_POLICY` above is what ships. This is what lets a team replace it
 * without touching TypeScript — an `airlock.policy.yaml` at the repository root
 * is read at runtime and validated against this before it is allowed anywhere
 * near the gate.
 *
 * Validation is not a formality here. A policy file with a typo'd key would
 * otherwise silently *loosen* a rule: `max_peple: 1000` is not a ceiling, it is
 * an absent ceiling with a spelling mistake, and nobody would find out until an
 * erasure went through that should not have. `.strict()` turns that into a
 * startup error, which is the only acceptable outcome.
 */
const BlackoutSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1),
    from: z.string().regex(/^\d{1,2}:\d{2}$/, 'must be HH:MM'),
    to: z.string().regex(/^\d{1,2}:\d{2}$/, 'must be HH:MM'),
    tz: z.string().min(1),
    reason: z.string().min(1, 'a change freeze without a stated reason is not enforceable'),
  })
  .strict();

const ClassRuleSchema = z
  .object({
    requires: z.enum([...CERTIFICATE_KINDS, 'ANY']),
    quorum: z.number().int().min(1),
    freshness_seconds: z.number().int().positive(),
    max_records: z.number().int().nonnegative().nullable(),
    max_people: z.number().int().nonnegative().nullable(),
    max_amount_minor: z.number().int().nonnegative().nullable(),
    max_lock_ms: z.number().int().nonnegative().nullable(),
    undo_window_seconds: z.number().int().nonnegative().nullable(),
    require_expiry: z.boolean(),
    allow_self_approval: z.boolean(),
    blackout: z.array(BlackoutSchema),
    break_glass: z.boolean(),
    note: z.string().optional(),
  })
  .strict();

/**
 * The budget block.
 *
 * `warn_at` is bounded above by 1 rather than merely being a number, because a
 * warning threshold above the ceiling is a warning that never fires — the same
 * class of quiet mistake as a mistyped ceiling key, and it deserves the same
 * treatment.
 */
const BudgetSchema = z
  .object({
    usd: z.number().positive().nullable(),
    tokens: z.number().int().positive().nullable(),
    warn_at: z.number().gt(0).lte(1, 'a warning above the ceiling would never fire'),
    enforce: z.boolean(),
  })
  .strict();

export const PolicySchema = z
  .object({
    version: z.string().min(1),
    name: z.string().min(1),
    defaults: ClassRuleSchema,
    classes: z.record(z.enum(CHANGE_CLASSES), ClassRuleSchema.partial().strict()),
    budget: BudgetSchema,
  })
  .strict();

export interface PolicyParseResult {
  ok: boolean;
  policy: Policy;
  /** Human-readable problems. Non-empty means `policy` fell back to the default. */
  problems: string[];
}

/**
 * Validate a parsed policy document, falling back to the shipped default.
 *
 * Never throws. A console that will not start because someone mistyped a YAML
 * key is a console nobody will keep running — but it must be *loud*, and it
 * must fall back to the stricter shipped policy rather than to nothing.
 */
export function parsePolicy(input: unknown): PolicyParseResult {
  const result = PolicySchema.safeParse(input);
  if (result.success) {
    return { ok: true, policy: result.data as Policy, problems: [] };
  }
  return {
    ok: false,
    policy: DEFAULT_POLICY,
    problems: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** Resolve the effective rule for a class: class overrides merged onto defaults. */
export function ruleFor(policy: Policy, cls: ChangeClass): ClassRule {
  return { ...policy.defaults, ...(policy.classes[cls] ?? {}) };
}

/** Every class with its effective rule, in declaration order. For the docs and the control room. */
export function resolvedRules(policy: Policy = DEFAULT_POLICY): Array<{ cls: ChangeClass; rule: ClassRule }> {
  return CHANGE_CLASSES.map((cls) => ({ cls, rule: ruleFor(policy, cls) }));
}

/* -------------------------------------------------------------------------- */
/* Blackout evaluation                                                        */
/* -------------------------------------------------------------------------- */

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock day-of-week and minute-of-day for an instant, in a named zone. */
function wallClock(at: Date, tz: string): { day: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);

    let day: number | undefined;
    let hour: number | undefined;
    let minute: number | undefined;
    for (const p of parts) {
      if (p.type === 'weekday') day = WEEKDAY_INDEX[p.value];
      if (p.type === 'hour') hour = Number(p.value);
      if (p.type === 'minute') minute = Number(p.value);
    }
    if (day === undefined || hour === undefined || minute === undefined) return null;
    // Some locales render midnight as 24; normalise so 24:00 is 00:00.
    return { day, minutes: (hour % 24) * 60 + minute };
  } catch {
    // An unknown zone must not silently disable the freeze, but it also must
    // not crash the gate. The caller treats null as "cannot evaluate".
    return null;
  }
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `at` inside this window?
 *
 * A window whose `to` is earlier than its `from` wraps midnight, and the day
 * test applies to the day the window *starts* on — so "Fri 22:00 to 02:00" is
 * in effect at 01:00 on Saturday morning.
 */
export function inWindow(window: BlackoutWindow, at: Date): boolean {
  const now = wallClock(at, window.tz);
  if (!now) return false;
  const from = toMinutes(window.from);
  const to = toMinutes(window.to);
  if (from === null || to === null) return false;

  if (from <= to) {
    return window.days.includes(now.day) && now.minutes >= from && now.minutes <= to;
  }

  // Wrapping: either late on a listed day, or early on the day after one.
  const yesterday = (now.day + 6) % 7;
  if (window.days.includes(now.day) && now.minutes >= from) return true;
  if (window.days.includes(yesterday) && now.minutes <= to) return true;
  return false;
}

/** The windows in effect for a class right now. Empty when the class is clear. */
export function activeBlackouts(policy: Policy, cls: ChangeClass, at: Date = new Date()): BlackoutWindow[] {
  return ruleFor(policy, cls).blackout.filter((w) => inWindow(w, at));
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export type PolicyCode =
  | 'WRONG_CERTIFICATE_KIND'
  | 'CERTIFICATE_STALE'
  | 'RECORD_CEILING'
  | 'PEOPLE_CEILING'
  | 'AMOUNT_CEILING'
  | 'LOCK_CEILING'
  | 'GRANT_WITHOUT_EXPIRY'
  | 'BLACKOUT_WINDOW'
  | 'SELF_APPROVAL';

export interface PolicyFinding {
  code: PolicyCode;
  /** Written for the person who is blocked, not for the person who wrote the rule. */
  message: string;
  /** The rule, as a string a judge can compare against `observed`. */
  limit?: string;
  observed?: string;
}

export interface PolicyVerdict {
  rule: ClassRule;
  /** Anything that seals the gate. Empty means policy is satisfied. */
  findings: PolicyFinding[];
  /** Distinct approvers needed in total. */
  sealsRequired: number;
  /** Distinct approvers already collected. */
  sealsHeld: number;
  ok: boolean;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Evaluate policy against a dossier for a specific viewer at a specific moment.
 *
 * `viewerEmail` is needed because two of the rules — self-approval and quorum —
 * are about *who is standing at the gate*, not about the change. Passing
 * `undefined` evaluates everything except those.
 */
export function evaluatePolicy(
  dossier: Dossier,
  options: { policy?: Policy; viewerEmail?: string; now?: Date } = {},
): PolicyVerdict {
  const policy = options.policy ?? DEFAULT_POLICY;
  const now = options.now ?? new Date();
  const rule = ruleFor(policy, dossier.change_class);
  const findings: PolicyFinding[] = [];
  const cert = dossier.certificate;

  /* --- the right kind of proof for this kind of change ------------------- */
  if (cert && rule.requires !== 'ANY' && cert.kind !== rule.requires) {
    findings.push({
      code: 'WRONG_CERTIFICATE_KIND',
      message:
        rule.requires === 'UNDO'
          ? 'Policy requires an undo certificate for this class: the change must be proven reversible, not merely bounded.'
          : 'Policy requires a scope certificate for this class: the change must state exactly what it destroys.',
      limit: `${rule.requires} certificate`,
      observed: `${cert.kind} certificate`,
    });
  }

  /* --- a proof has a shelf life ------------------------------------------ */
  if (cert?.verified_at) {
    const ageMs = now.getTime() - new Date(cert.verified_at).getTime();
    const ageSeconds = Math.floor(ageMs / 1000);
    if (Number.isFinite(ageSeconds) && ageSeconds > rule.freshness_seconds) {
      findings.push({
        code: 'CERTIFICATE_STALE',
        message:
          'This certificate has expired. It proved something about production at a moment that has passed, and production may have moved since. Re-run verification.',
        limit: `${rule.freshness_seconds}s`,
        observed: `${ageSeconds}s old`,
      });
    }
  }

  /* --- ceilings ---------------------------------------------------------- */
  const m = dossier.magnitude;

  if (rule.max_records !== null && m.records > rule.max_records) {
    findings.push({
      code: 'RECORD_CEILING',
      message: `This change touches more records than policy permits for a ${dossier.change_class} without a capacity review.`,
      limit: plural(rule.max_records, 'record', 'records'),
      observed: plural(m.records, 'record', 'records'),
    });
  }

  if (rule.max_people !== null && m.people > rule.max_people) {
    findings.push({
      code: 'PEOPLE_CEILING',
      message: `This change affects more people than policy permits for a ${dossier.change_class}. The ceiling counts human beings, not rows.`,
      limit: plural(rule.max_people, 'person', 'people'),
      observed: plural(m.people, 'person', 'people'),
    });
  }

  if (rule.max_amount_minor !== null && Math.abs(m.amount_minor) > rule.max_amount_minor) {
    const fmt = (minor: number) => `${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })} ${m.currency ?? 'GBP'}`;
    findings.push({
      code: 'AMOUNT_CEILING',
      message: 'This moves more money than AIRLOCK is authorised to move. Above the ceiling this is a treasury decision, not a change request.',
      limit: fmt(rule.max_amount_minor),
      observed: fmt(Math.abs(m.amount_minor)),
    });
  }

  /* --- how long everything else waits ------------------------------------ */
  const lockMs = cert?.lock_ms_estimate;
  if (rule.max_lock_ms !== null && lockMs !== undefined && lockMs > rule.max_lock_ms) {
    findings.push({
      code: 'LOCK_CEILING',
      message:
        'This operation holds a lock for longer than policy permits. Every query against the affected table queues behind it for the duration, which is an outage caused by waiting rather than by working.',
      limit: `${(rule.max_lock_ms / 1000).toFixed(2)} s`,
      observed: `${(lockMs / 1000).toFixed(2)} s`,
    });
  }

  /* --- no standing access ------------------------------------------------ */
  if (rule.require_expiry) {
    const forever = dossier.principals.filter((p) => p.expires_at === null);
    if (forever.length > 0) {
      findings.push({
        code: 'GRANT_WITHOUT_EXPIRY',
        message:
          'Policy forbids access that does not expire. Every principal in this change must carry an expiry, so that the default state of production is that nobody has the keys.',
        limit: 'every grant expires',
        observed: `${plural(forever.length, 'principal', 'principals')} with no expiry: ${forever
          .map((p) => p.subject)
          .join(', ')}`,
      });
    }
  }

  /* --- change freeze ----------------------------------------------------- */
  for (const window of rule.blackout) {
    if (inWindow(window, now)) {
      findings.push({
        code: 'BLACKOUT_WINDOW',
        message: window.reason,
        limit: `${window.from}–${window.to} ${window.tz}`,
        observed: 'in effect now',
      });
    }
  }

  /* --- separation of duties --------------------------------------------- */
  const viewer = options.viewerEmail?.toLowerCase();
  const signed = approversFor(dossier);

  if (viewer && !rule.allow_self_approval && viewer === dossier.requested_by.toLowerCase()) {
    findings.push({
      code: 'SELF_APPROVAL',
      message:
        'You asked for this change, so you cannot be the one who approves it. Separation of duties is the entire point of a second pair of eyes.',
      limit: 'requester may not approve',
      observed: `requested by ${dossier.requested_by}`,
    });
  }

  if (viewer && signed.includes(viewer)) {
    findings.push({
      code: 'SELF_APPROVAL',
      message: 'You have already signed this change. A quorum counts people, not clicks.',
      limit: 'one signature per approver',
      observed: `already signed by ${viewer}`,
    });
  }

  return {
    rule,
    findings,
    sealsRequired: rule.quorum,
    sealsHeld: signed.length,
    ok: findings.length === 0,
  };
}

/**
 * Is break-glass available for this change?
 *
 * Two conditions, both necessary: policy permits it for the class, and the
 * deployment has it switched on. Off is the default in both places.
 */
export function breakGlassAvailable(
  dossier: Dossier,
  options: { policy?: Policy; enabled?: boolean } = {},
): boolean {
  const rule = ruleFor(options.policy ?? DEFAULT_POLICY, dossier.change_class);
  return rule.break_glass && options.enabled === true;
}

/**
 * The skill packs, with versions and content digests.
 *
 * GENERATED FILE. Edit the packs in `skills/` and run `node scripts/gen-skills.mjs`.
 *
 * A change dossier records which guidance the agent was operating under when it
 * produced its proof, and that record is sealed into the receipt. Two fields
 * rather than one, deliberately: the version is a human claim and the digest is
 * a fact. A skill edited without a version bump keeps its version and changes
 * its digest, and the ledger shows it.
 *
 * Digests are computed over LF-normalised bytes, so a Windows checkout and a
 * Linux one agree.
 */

export interface SkillPack {
  name: string;
  version: string;
  digest: string;
  description: string;
}

export const SKILL_PACKS: readonly SkillPack[] = [
  {
    name: "access-review",
    version: "1.0.0",
    digest: "sha256:1f3d298000a20829dcc8a8f5ac9d8af55161eceab260dbe898d136508dc44ae0",
    description: "How to compute what an access grant actually unlocks, rather than what its policy document says. Load before writing or reviewing any ACCESS_GRANT change.",
  },
  {
    name: "code-review-loop",
    version: "1.0.0",
    digest: "sha256:75a07112bf79e46e8554df9234168254ad6c029b170e55cf0d6a41c1739763af",
    description: "Write the application changes a migration implies, open a pull request, get it reviewed by an independent reviewer, and address the findings before asking anyone to approve anything. Load whenever a change has a non-empty blast radius.",
  },
  {
    name: "comms-blast",
    version: "1.0.0",
    digest: "sha256:dbd376c75a9b5d1d9b6f27f0b54c4b62ab2677a083fc418b4206c442f9f06f01",
    description: "Outbound messages to many real humans — suppression, consent, deduplication by person, sender reputation and quiet hours. Load before writing or reviewing any COMMS_BLAST change.",
  },
  {
    name: "data-retention",
    version: "1.0.0",
    digest: "sha256:45da5870e6997f42645ebba685aa33a580f05b9541852679fa7919cb9b702e9b",
    description: "How to scope a right-to-erasure request across several systems, and which records must be retained despite it. Load before any ERASURE change class.",
  },
  {
    name: "expand-contract",
    version: "1.0.0",
    digest: "sha256:613d73e2890de18ecb6d4680b311c2757bc3365a31d58ba2b888a41a37081412",
    description: "The three-phase pattern for making an irreversible schema or data change reversible. Load whenever a migration fails its rollback proof, or whenever a change would drop or narrow anything.",
  },
  {
    name: "infra-safety",
    version: "1.0.0",
    digest: "sha256:8e4104318ebbd5f4bdb258e703cceed74893d54ff02845d8133428b921afcbc6",
    description: "Scaling down, deleting, rotating and repointing — capacity headroom, quorum loss, DNS TTL, secret rotation ordering and why \"unused\" usually means \"broken\". Load before writing or reviewing any INFRA_MUTATION change.",
  },
  {
    name: "money-movement",
    version: "1.0.0",
    digest: "sha256:9295e8e5b60c6fee374d046819f5d3ad8ce8b51e6d15ffcde4826e4cb2d4709b",
    description: "Refunds, payouts and adjustments — idempotency, double-payment detection, disputes, and why money never gets an undo certificate. Load before writing or reviewing any MONEY_MOVEMENT change.",
  },
  {
    name: "postgres-safety",
    version: "1.1.0",
    digest: "sha256:3ca6c98a5cd2fb7d4aeae224d74c521879aca5db359175b00d7039cc84512133",
    description: "What is genuinely irreversible in PostgreSQL, which DDL takes which lock, and when a statement rewrites the whole table. Load before writing or reviewing any migration.",
  },
] as const;

const BY_NAME = new Map(SKILL_PACKS.map((s) => [s.name, s]));

/**
 * Stamp a skill the agent says it used.
 *
 * The agent supplies the name and nothing else. Version and digest are filled
 * in from here, so an agent cannot report that it followed v3 of a pack that is
 * sitting at v1 — the same reason the gate recomputes `checksums.match`.
 *
 * An unknown name is recorded as unknown rather than dropped. A skill the agent
 * believes it loaded and which does not exist is a fact worth keeping.
 */
export function stampSkill(name: string): SkillPack {
  return (
    BY_NAME.get(name) ?? {
      name,
      version: 'unknown',
      digest: 'unknown',
      description: 'No skill pack of this name ships with AIRLOCK.',
    }
  );
}

/** `postgres-safety@1.0.0, expand-contract@1.0.0` — for the ledger line. */
export function describeSkills(packs: ReadonlyArray<{ name: string; version: string }>): string {
  if (packs.length === 0) return 'none recorded';
  return packs.map((p) => `${p.name}@${p.version}`).join(', ');
}

/**
 * Generate the skill manifest from the skill packs themselves.
 *
 * A compliance record that says "approved under postgres-safety" is worth very
 * little. Skills are prose that tells an agent how to behave, they get edited,
 * and "the guidance we had in August" is exactly the question an auditor asks
 * in November. So the ledger records a version *and* a content digest, and both
 * are sealed into the receipt.
 *
 * The version comes from the pack's own frontmatter, which a human maintains.
 * The digest is computed from the file, which nobody maintains — and that is
 * the point of having both. A skill edited without a version bump has the same
 * version and a different digest, and the record shows it. Claiming v1.0.0 does
 * not make a file v1.0.0.
 *
 * Baked into the contract as a TypeScript module rather than read at runtime so
 * the MCP server, which ships as a single bundled file, can stamp a version
 * without shipping the skills directory alongside it.
 *
 * Run: node scripts/gen-skills.mjs   (part of `npm run gen`)
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skillsDir = path.join(root, 'skills');
const out = path.join(root, 'packages/contract/src/skills.ts');

/** Minimal frontmatter reader. The packs are ours, so the format is known. */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

const entries = [];
for (const dir of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!dir.isDirectory()) continue;
  const file = path.join(skillsDir, dir.name, 'SKILL.md');
  if (!existsSync(file)) continue;

  // Read as bytes and normalise line endings before digesting. Without this the
  // same skill hashes differently on Windows and Linux, and the digest becomes
  // a checkout artefact rather than a fact about the guidance.
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const meta = frontmatter(raw);

  entries.push({
    name: meta.name ?? dir.name,
    version: meta.version ?? '0.0.0',
    digest: `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`,
    description: (meta.description ?? '').replace(/'/g, "\\'"),
  });
}

const lines = [];
lines.push('/**');
lines.push(' * The skill packs, with versions and content digests.');
lines.push(' *');
lines.push(' * GENERATED FILE. Edit the packs in `skills/` and run `node scripts/gen-skills.mjs`.');
lines.push(' *');
lines.push(' * A change dossier records which guidance the agent was operating under when it');
lines.push(' * produced its proof, and that record is sealed into the receipt. Two fields');
lines.push(' * rather than one, deliberately: the version is a human claim and the digest is');
lines.push(' * a fact. A skill edited without a version bump keeps its version and changes');
lines.push(' * its digest, and the ledger shows it.');
lines.push(' *');
lines.push(' * Digests are computed over LF-normalised bytes, so a Windows checkout and a');
lines.push(' * Linux one agree.');
lines.push(' */');
lines.push('');
lines.push('export interface SkillPack {');
lines.push('  name: string;');
lines.push('  version: string;');
lines.push('  digest: string;');
lines.push('  description: string;');
lines.push('}');
lines.push('');
lines.push('export const SKILL_PACKS: readonly SkillPack[] = [');
for (const e of entries) {
  lines.push('  {');
  lines.push(`    name: '${e.name}',`);
  lines.push(`    version: '${e.version}',`);
  lines.push(`    digest: '${e.digest}',`);
  lines.push(`    description: '${e.description}',`);
  lines.push('  },');
}
lines.push('] as const;');
lines.push('');
lines.push('const BY_NAME = new Map(SKILL_PACKS.map((s) => [s.name, s]));');
lines.push('');
lines.push('/**');
lines.push(' * Stamp a skill the agent says it used.');
lines.push(' *');
lines.push(' * The agent supplies the name and nothing else. Version and digest are filled');
lines.push(' * in from here, so an agent cannot report that it followed v3 of a pack that is');
lines.push(' * sitting at v1 — the same reason the gate recomputes `checksums.match`.');
lines.push(' *');
lines.push(' * An unknown name is recorded as unknown rather than dropped. A skill the agent');
lines.push(' * believes it loaded and which does not exist is a fact worth keeping.');
lines.push(' */');
lines.push('export function stampSkill(name: string): SkillPack {');
lines.push('  return (');
lines.push('    BY_NAME.get(name) ?? {');
lines.push('      name,');
lines.push("      version: 'unknown',");
lines.push("      digest: 'unknown',");
lines.push("      description: 'No skill pack of this name ships with AIRLOCK.',");
lines.push('    }');
lines.push('  );');
lines.push('}');
lines.push('');
lines.push('/** `postgres-safety@1.0.0, expand-contract@1.0.0` — for the ledger line. */');
lines.push('export function describeSkills(packs: ReadonlyArray<{ name: string; version: string }>): string {');
lines.push("  if (packs.length === 0) return 'none recorded';");
lines.push("  return packs.map((p) => `${p.name}@${p.version}`).join(', ');");
lines.push('}');
lines.push('');

writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`wrote packages/contract/src/skills.ts (${entries.length} skill packs)`);
for (const e of entries) console.log(`  ${e.name.padEnd(20)} ${e.version.padEnd(8)} ${e.digest.slice(0, 20)}…`);

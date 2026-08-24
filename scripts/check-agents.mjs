/**
 * Check the agent specs against the privilege model they are supposed to encode.
 *
 * The claim AIRLOCK makes is strong and specific: *no principal in the run can
 * change production without a human*. That claim rests entirely on how these
 * JSON files are written, and a JSON file is exactly the kind of thing that
 * drifts silently. So the claim is asserted here rather than described in a
 * README.
 *
 * Run with `npm run check:agents`. It is part of `npm test`.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const agentsDir = path.join(root, 'agents');
const skillsDir = path.join(root, 'skills');

/** The one tool that moves a change towards production. */
const GATED_TOOL = 'airlock_request_approval';

/**
 * Tool selectors that grant the ability to change something.
 *
 * A connector to a production system may not carry any of these in
 * `enable_tools`. The agent investigates with read access and asks AIRLOCK for
 * everything else.
 */
const WRITE_SELECTORS = ['@all', '@write', '@destructive'];

/** Connectors that point at real systems. `airlock` is our own gate, not a system. */
const isProductionConnector = (name) => name !== 'airlock';

const failures = [];
const note = (file, message) => failures.push(`${file}: ${message}`);

const files = readdirSync(agentsDir).filter((f) => f.endsWith('.agent.json')).sort();
if (files.length === 0) failures.push('agents/: no agent specs found');

for (const file of files) {
  let spec;
  try {
    spec = JSON.parse(readFileSync(path.join(agentsDir, file), 'utf8'));
  } catch (error) {
    note(file, `is not valid JSON — ${error.message}`);
    continue;
  }

  const manifest = spec.manifest ?? {};
  const servers = manifest.mcp_servers ?? [];
  const skills = manifest.skills ?? [];

  if (!spec.name) note(file, 'has no name');
  if (!manifest.model?.name) note(file, 'has no model');
  if ((manifest.instructions ?? '').length < 400) {
    note(file, 'has instructions too short to be load-bearing');
  }

  /* --- production connectors must be read-only -------------------------- */
  for (const server of servers) {
    const enabled = server.enable_tools ?? [];
    if (!isProductionConnector(server.name)) continue;

    const writable = enabled.filter((t) => WRITE_SELECTORS.includes(t));
    if (writable.length > 0) {
      note(
        file,
        `connector "${server.name}" enables ${writable.join(', ')}. Production connectors are read-only in AIRLOCK; ` +
          'the write path is airlock_request_approval and nothing else.',
      );
    }
    if (enabled.length === 0) {
      note(file, `connector "${server.name}" has no enable_tools, so its scope is whatever the default happens to be`);
    }
  }

  /* --- the gate must actually be gated ----------------------------------- */
  //
  // An agent is acceptable in exactly one of two shapes, and the check is that
  // it is genuinely one of them rather than something in between:
  //
  //   1. it mounts the airlock server and holds precisely the one tool that
  //      moves a change forward, or
  //   2. it has no write capability at all — a reconnaissance agent that can
  //      look at everything and change nothing.
  //
  // The dangerous shape is an agent that can write somewhere without holding
  // the gate, and that is what this rejects.
  const airlock = servers.find((s) => s.name === 'airlock');
  const writeSelectors = servers.flatMap((s) => (s.enable_tools ?? []).filter((t) => WRITE_SELECTORS.includes(t)));

  if (airlock) {
    const gated = airlock.require_approval_for_tools ?? [];
    if (!gated.includes(GATED_TOOL)) {
      note(
        file,
        `mounts the airlock server but does not list ${GATED_TOOL} in require_approval_for_tools. ` +
          'That is the entire human-in-the-loop guarantee.',
      );
    }
    if (gated.length !== 1) {
      note(
        file,
        `holds ${gated.length} airlock tools for approval. Exactly one should be held — holding more trains ` +
          'people to click through, and holding fewer opens a second path to production.',
      );
    }
  } else if (writeSelectors.length > 0) {
    note(
      file,
      'can write somewhere but does not mount the airlock MCP server, so those writes bypass the gate. ' +
        'Either mount airlock and hold the approval tool, or drop the write selectors.',
    );
  }

  /* --- every skill referenced must exist --------------------------------- */
  for (const skill of skills) {
    const name = typeof skill === 'string' ? skill : skill.name;
    if (!existsSync(path.join(skillsDir, name, 'SKILL.md'))) {
      note(file, `references skill "${name}", which does not exist at skills/${name}/SKILL.md`);
    }
  }

  /* --- deferred loading, where it is claimed ------------------------------ */
  const preloaded = servers.filter((s) => s.preload === true).map((s) => s.name);
  const summary = [
    airlock ? `gated on ${GATED_TOOL}` : 'read-only — no path to production',
    `${servers.length} connectors`,
    `${skills.length} skills`,
    preloaded.length ? `preloaded: ${preloaded.join(', ')}` : 'all deferred',
  ].join(', ');
  console.log(`  ok  ${(spec.name ?? file).padEnd(24)}  ${summary}`);
}

/* --- every skill on disk should be reachable from some agent -------------- */

const referenced = new Set();
for (const file of files) {
  try {
    const spec = JSON.parse(readFileSync(path.join(agentsDir, file), 'utf8'));
    for (const skill of spec.manifest?.skills ?? []) {
      referenced.add(typeof skill === 'string' ? skill : skill.name);
    }
  } catch {
    /* already reported above */
  }
}

for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  if (!referenced.has(dir.name)) {
    note('skills/', `"${dir.name}" is not referenced by any agent, so nothing will ever load it`);
  }
}

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${files.length} agent spec(s) check out. ${referenced.size} skills referenced.`);

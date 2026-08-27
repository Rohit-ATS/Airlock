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

/**
 * Named write tools a production connector may carry, by connector.
 *
 * This exists for exactly one reason: the Qodo review loop. A schema migration
 * is only half a change, so the agent writes the application changes that go
 * with it and opens a pull request for an independent reviewer to read.
 *
 * That requires write access to GitHub, and granting `@write` would have been
 * the easy way to get it — and would have handed the agent `merge_pull_request`
 * at the same time, which is a second route to production straight past every
 * control in this repository.
 *
 * So the grant is enumerated instead, and it is enumerated around a principle:
 * **the agent may propose and may not apply.** Opening a PR is a proposal that
 * lands in front of a human, which is exactly where a change dossier lands. It
 * is the same rule as the gate, one layer out.
 */
const NAMED_WRITE_ALLOWANCE = {
  github: [
    'create_branch',
    'create_or_update_file',
    'push_files',
    'create_pull_request',
    'update_pull_request',
    'add_issue_comment',
    'create_pending_pull_request_review',
    'submit_pending_pull_request_review',
  ],
};

/**
 * Tools that must never appear, on any connector, whatever the allow-list says.
 *
 * The deny-list is checked first and independently, so an allow-list entry can
 * never accidentally re-admit one of these — a belt-and-braces arrangement for
 * the handful of verbs that would end the "no path to production" claim.
 */
const FORBIDDEN_TOOLS = [
  'merge_pull_request',
  'delete_branch',
  'delete_file',
  'delete_repository',
  'force_push',
  'create_release',
];

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

    // Checked first and independently of the allow-list, so an allow-list entry
    // can never accidentally re-admit a verb that ends the guarantee.
    const forbidden = enabled.filter((t) => FORBIDDEN_TOOLS.includes(t));
    if (forbidden.length > 0) {
      note(
        file,
        `connector "${server.name}" enables ${forbidden.join(', ')}. The agent may propose and may not apply — ` +
          'merging a pull request is applying, and would be a second route to production.',
      );
    }

    // Any named tool beyond @read-only has to be on the connector's allow-list.
    const allowed = NAMED_WRITE_ALLOWANCE[server.name] ?? [];
    const unexpected = enabled.filter(
      (t) => !t.startsWith('@') && !allowed.includes(t) && !FORBIDDEN_TOOLS.includes(t),
    );
    if (unexpected.length > 0) {
      note(
        file,
        `connector "${server.name}" enables ${unexpected.join(', ')}, which is not on its allow-list. ` +
          'Add it to NAMED_WRITE_ALLOWANCE deliberately, or remove it.',
      );
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

    /*
     * The gate's own tools must arrive with the conversation, not be discovered.
     *
     * Deferred loading is the right default for a connector the agent might
     * never touch — that is why every production connector here sets
     * `preload: false`, and the comment on `stripe` says so. It is the wrong
     * default for airlock, and the difference is not stylistic.
     *
     * With `preload: false` the harness hands the model `list_tools` and
     * `get_tool_info` instead of the tools, and the model has to go and read
     * its own manual one tool at a time before it can do anything at all. An
     * observed run spent eleven consecutive iterations doing exactly that:
     * list, then get_tool_info twelve times, one of them twice — and never
     * opened a change. Each of those iterations re-sends the whole context, so
     * against a tokens-per-minute ceiling the run exhausts its budget on
     * discovery and dies of a rate limit before it reaches the gate.
     *
     * So this is asserted, not left to whoever edits the JSON next: the twelve
     * tools that constitute AIRLOCK's entire surface are cheap to carry and are
     * the whole reason the agent exists.
     */
    if (airlock.preload !== true) {
      note(
        file,
        'mounts the airlock server with preload off, so the agent must discover the gate tools with ' +
          'list_tools/get_tool_info before it can use them. That costs a round trip per tool and burns the ' +
          'token budget on reading its own manual. Set "preload": true.',
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

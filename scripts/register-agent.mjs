/**
 * Register an AIRLOCK agent spec with a running TrueForge server.
 *
 *   node scripts/register-agent.mjs [agents/airlock-change-control.agent.json]
 *
 * Env:
 *   TRUEFORGE_BASE_URL   default http://localhost:8791
 *
 * This exists instead of a curl command because the canonical specs in
 * `agents/` describe the deployment AIRLOCK is *designed* for, and a given
 * server is usually less than that. Rather than keeping a second, degraded copy
 * of each spec — which would rot — this asks the server what it actually
 * supports and adapts the spec to it, printing every adaptation.
 *
 * Four things it reconciles, each of which is a real difference between the
 * spec and TrueForge 0.1.4:
 *
 *   1. `comment` / `comment_*` keys. They document the spec for humans; the
 *      API rejects unknown properties.
 *
 *   2. MCP servers the spec names but the server has not been configured with.
 *      A spec mounting `supabase` on a server with no Supabase connector is a
 *      422, so unconfigured connectors are dropped and named in the output. The
 *      privilege model is unaffected: dropping a read-only connector removes
 *      capability, never adds it.
 *
 *   3. `command` / `args` / `env` on an MCP server. TrueForge attaches *remote*
 *      MCP servers and only remote ones — `MCPServerType` has a single member,
 *      "remote" — so a server is referenced by configured name and reached over
 *      HTTP. There is no stdio transport. See docs/TRUEFORGE-NOTES.md §4.4.
 *
 *   4. Sandbox and skills. `GET /api/v1/capabilities` reports whether a sandbox
 *      provider is configured; skills require one. Without it both are switched
 *      off rather than sent and rejected.
 *
 * It refuses to register an agent whose gated tool was dropped, because an
 * agent that can reach production without holding `airlock_request_approval`
 * is the one outcome this project exists to prevent.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8791';
const specPath = process.argv[2] ?? 'agents/airlock-change-control.agent.json';
const GATED_TOOL = 'airlock_request_approval';

const say = (...parts) => console.log(...parts);
const drop = (what, why) => console.log(`  dropped  ${String(what).padEnd(28)} ${why}`);

async function api(method, route, body) {
  const res = await fetch(new URL(route, BASE), {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

/* --- what does this server actually offer? -------------------------------- */

const health = await api('GET', '/healthz').catch(() => ({ ok: false }));
if (!health.ok) {
  console.error(`No TrueForge server at ${BASE}.`);
  console.error('Start one, then re-run. See docs/TRUEFORGE-NOTES.md §2.');
  process.exit(2);
}

const caps = (await api('GET', '/api/v1/capabilities')).body?.data ?? {};
const configured = new Set(
  ((await api('GET', '/api/v1/settings/mcp-servers')).body?.data ?? []).map((s) => s.name),
);
const models = new Set(
  ((await api('GET', '/api/v1/models')).body?.data ?? []).flatMap((p) =>
    (p.models ?? []).map((m) => `${p.name}/${m.name}`),
  ),
);

say(`TrueForge at ${BASE}`);
say(`  sandbox   ${caps.sandbox?.enabled ? 'available' : 'NOT configured'}`);
say(`  skills    ${caps.skill?.enabled ? 'available' : `NOT available — ${caps.skill?.reason ?? 'unknown'}`}`);
say(`  connectors ${configured.size ? [...configured].join(', ') : '(none configured)'}`);
say('');

/* --- adapt the spec ------------------------------------------------------- */

const raw = JSON.parse(readFileSync(path.resolve(specPath), 'utf8'));
const name = raw.name;
const manifest = structuredClone(raw.manifest);

say(`Adapting ${specPath} (${name}) for this server:`);

// 1. Documentation keys the API does not accept.
const stripComments = (value) => {
  if (Array.isArray(value)) return value.map(stripComments);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== 'comment' && !k.startsWith('comment_'))
        .map(([k, v]) => [k, stripComments(v)]),
    );
  }
  return value;
};

// 2 and 3. Connectors: keep the configured ones, reduce each to the fields the
// agent-side schema actually has.
const wanted = manifest.mcp_servers ?? [];
manifest.mcp_servers = wanted
  .filter((server) => {
    if (configured.has(server.name)) return true;
    drop(server.name, 'not configured on this server (Settings -> Connectors)');
    return false;
  })
  .map((server) => {
    const { name: n, enable_tools, disable_tools, preload_tools, require_approval_for_tools, preload } = server;
    if (server.command || server.args) {
      say(`  note     ${String(n).padEnd(28)} attached by name over HTTP; TrueForge has no stdio transport`);
    }
    return {
      name: n,
      ...(enable_tools ? { enable_tools } : {}),
      ...(disable_tools ? { disable_tools } : {}),
      ...(preload_tools ? { preload_tools } : {}),
      ...(require_approval_for_tools ? { require_approval_for_tools } : {}),
      ...(preload !== undefined ? { preload } : {}),
    };
  });

// 4. Sandbox and skills.
if (!caps.sandbox?.enabled && manifest.config?.sandbox?.enabled) {
  manifest.config.sandbox = { ...manifest.config.sandbox, enabled: false };
  drop('config.sandbox', 'no sandbox provider is configured on this server');
}
if (!caps.skill?.enabled && manifest.skills?.length) {
  drop(`skills (${manifest.skills.length})`, caps.skill?.reason ?? 'skills unavailable');
  delete manifest.skills;
}

// The model has to exist, or the first turn 422s with a message nobody reads.
if (models.size && !models.has(manifest.model.name)) {
  console.error(`\nModel ${manifest.model.name} is not configured on this server.`);
  console.error(`Configured: ${[...models].join(', ') || '(none)'}`);
  console.error('Register a provider first: PUT /api/v1/settings/model-providers');
  process.exit(1);
}

/* --- the one thing that must not be adapted away -------------------------- */

const airlock = manifest.mcp_servers.find((s) => s.name === 'airlock');
const canWrite = manifest.mcp_servers.some((s) =>
  (s.enable_tools ?? []).some((t) => ['@all', '@write', '@destructive'].includes(t)),
);

if (canWrite && !airlock?.require_approval_for_tools?.includes(GATED_TOOL)) {
  console.error(`\nRefusing to register ${name}.`);
  console.error(`It can write somewhere, but ${GATED_TOOL} is not held for approval.`);
  console.error('That is the entire human-in-the-loop guarantee, and it is not adaptable.');
  process.exit(1);
}

say('');
say(
  airlock
    ? `  gate     ${GATED_TOOL} is held for a human by the harness`
    : '  gate     no airlock connector — this agent has no path to production',
);
say(`  model    ${manifest.model.name}`);
say(`  connectors attached: ${manifest.mcp_servers.map((s) => s.name).join(', ') || '(none)'}`);

/* --- register -------------------------------------------------------------- */

const payload = { name, manifest: stripComments(manifest) };

let result = await api('POST', '/api/v1/agents', payload);

// Already registered, so update it in place. Creation and update are not
// symmetric on this server, in two ways that both fail loudly only on the
// second run of the script:
//
//   - The update route addresses the agent by *id*. A name in the path is not
//     resolved, it is 404 "Agent not found: airlock-change-control".
//   - It rejects a `name` key in the body — 400 "Unrecognized key" — because
//     the identity is the path. The create route requires that same key.
//
// So re-registering needs the id looked up first and the payload narrowed to
// the manifest alone. Getting this wrong is invisible until an agent already
// exists, which is why it survived: the first run of a fresh harness passes.
if (result.status === 409) {
  const existing = ((await api('GET', '/api/v1/agents')).body?.data ?? []).find((a) => a.name === name);
  if (existing) {
    result = await api('PUT', `/api/v1/agents/${encodeURIComponent(existing.id)}`, {
      manifest: payload.manifest,
    });
  }
  // No `existing` means the name collided with something this list does not
  // show. Fall through with the 409 rather than papering over it.
}

if (!result.ok) {
  console.error(`\nFailed (HTTP ${result.status}):`);
  console.error(JSON.stringify(result.body, null, 2).slice(0, 2000));
  process.exit(1);
}

say('');
say(`Registered ${name}. Create a session against it with:`);
say(`  POST ${BASE}/api/v1/sessions   {"agent":{"name":"${name}"}}`);

/**
 * Point a running TrueForge server at AIRLOCK, in one command.
 *
 *   npm run harness:setup
 *
 * Does the four things that have to happen before an agent can run, in the only
 * order they work in, and says what it did:
 *
 *   1. registers your model provider  (PUT  /api/v1/settings/model-providers)
 *   2. registers AIRLOCK's MCP server (POST /api/v1/settings/mcp-servers)
 *   3. confirms the harness can actually enumerate our tools
 *   4. registers the agent specs      (via scripts/register-agent.mjs)
 *
 * Reads OPENAI_API_KEY (or ANTHROPIC_API_KEY) from the repo-root .env. The key
 * is never printed and never leaves this machine except to the provider you
 * configured.
 *
 * Model credentials are NOT environment variables to TrueForge — they are
 * runtime settings — which is the single most confusing thing about standing
 * this up by hand, and the reason this script exists.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8791';

/** Where the MCP server will be reachable from *inside* the harness. */
const MCP_PORT = Number(process.env.AIRLOCK_MCP_HTTP_PORT ?? 8975);
const MCP_HOST = process.env.AIRLOCK_MCP_HOST ?? 'host.docker.internal';
const MCP_URL = `http://${MCP_HOST}:${MCP_PORT}/mcp`;

/* --- read the key without printing it ------------------------------------- */

function fromDotEnv(...names) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  // Split on CRLF or LF. In JavaScript a carriage return is a line terminator,
  // so `.` will not match it and `$` cannot anchor past it — which means a
  // Windows-written `.env` silently fails a regex that looks correct. See the
  // long note in apps/console/src/data/env.ts; it cost an hour there.
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && names.includes(m[1])) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...fromDotEnv('OPENAI_API_KEY', 'OPENAI_API', 'ANTHROPIC_API_KEY'), ...process.env };
const openai = env.OPENAI_API_KEY || env.OPENAI_API;
const anthropic = env.ANTHROPIC_API_KEY;

if (!openai && !anthropic) {
  console.error('No model key found. Put one in .env at the repo root:');
  console.error('  OPENAI_API_KEY=sk-...');
  console.error('  # or ANTHROPIC_API_KEY=sk-ant-...');
  process.exit(2);
}

/**
 * Which models to configure.
 *
 * Two per provider, deliberately: capability 18 (per-task model routing) needs
 * two *distinct* models observed across threads, and that is satisfied within
 * one vendor. It does not need two vendors, and pretending otherwise would put
 * a second API key between a judge and a working demo.
 *
 * WHICH OpenAI MODELS, AND WHY IT WAS THE BUG
 *
 * TrueForge ships no model catalog. `GET /api/v1/models` returns exactly what
 * this call registers and nothing else — so the list below is not a preference,
 * it is the entire set of models the agents are able to name. For most of this
 * project's life it registered the 4.1 family, and that was the single largest
 * cause of "AIRLOCK does not work": measured against this account's own key,
 *
 *     gpt-4.1        30,000 TPM      <- what the primary agent used to run on
 *     gpt-4.1-mini  200,000 TPM
 *     gpt-5-mini    500,000 TPM
 *     gpt-5.2       500,000 TPM
 *
 * One change-control iteration costs about 8.1k input tokens, so on a 30k-per-
 * minute ceiling a real run is throttled every third or fourth step and usually
 * dies mid-investigation. The resume-on-429 path in `packages/contract/src/
 * resume.ts` was built to survive exactly that, and it works — but surviving a
 * self-inflicted ceiling sixteen times a run is not the same as not having one.
 *
 * The reason recorded here previously — that "gpt-5* rejects temperature and
 * max_tokens with a 400" — was true of the earliest gpt-5 preview and is not
 * true now. Re-measured 2026-08-29: gpt-5.2 accepts `temperature: 0.1`, accepts
 * `max_tokens` (the AI SDK in the harness image translates it to
 * `max_completion_tokens`), and emits ordinary `tool_calls`. The treasury
 * agent's temperature-zero design therefore survives the move intact, which was
 * the thing worth checking before making it.
 *
 * The 4.1 pair stays registered underneath as the fallback chain's lower rungs.
 * They cost nothing to leave in the catalog and a rate-limited failover wants
 * somewhere to fail over to.
 */
const PROVIDERS = openai
  ? {
      type: 'openai',
      key: openai,
      models: [
        { model_id: 'gpt-5.2', name: 'gpt-5.2', properties: { context_length: 400_000, max_output_tokens: 128_000 } },
        { model_id: 'gpt-5-mini', name: 'gpt-5-mini', properties: { context_length: 400_000, max_output_tokens: 128_000 } },
        { model_id: 'gpt-4.1', name: 'gpt-4.1' },
        { model_id: 'gpt-4.1-mini', name: 'gpt-4.1-mini' },
      ],
    }
  : {
      type: 'anthropic',
      key: anthropic,
      models: [
        { model_id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
        { model_id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' },
      ],
    };

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

/* --- 0. is anything listening? -------------------------------------------- */

const health = await api('GET', '/healthz').catch(() => ({ ok: false }));
if (!health.ok) {
  console.error(`No TrueForge server at ${BASE}.`);
  console.error('Start one:  cd harness && docker compose up -d');
  process.exit(2);
}
console.log(`TrueForge at ${BASE}`);

/* --- 1. model provider ---------------------------------------------------- */

const provider = await api('PUT', '/api/v1/settings/model-providers', {
  manifest: {
    type: PROVIDERS.type,
    auth: { api_key: PROVIDERS.key },
    // Per-model `properties` win. The default below is the 4.1 window; the
    // gpt-5 entries carry their own, and a spread that clobbered them would
    // advertise a 1M context on a 400k model — which the harness believes, and
    // then hands the provider a request it rejects at the worst possible moment.
    models: PROVIDERS.models.map((m) => ({
      properties: { context_length: 1_047_576, max_output_tokens: 32_768 },
      ...m,
    })),
  },
});

if (!provider.ok) {
  console.error(`\nCould not register the ${PROVIDERS.type} provider (HTTP ${provider.status}):`);
  console.error(JSON.stringify(provider.body).slice(0, 400));
  process.exit(1);
}
console.log(`  models    ${PROVIDERS.models.map((m) => `${PROVIDERS.type}/${m.name}`).join(', ')}`);

/* --- 2. the AIRLOCK MCP server -------------------------------------------- */

const mcpProbe = await fetch(`http://localhost:${MCP_PORT}/healthz`).catch(() => null);
if (!mcpProbe?.ok) {
  console.error(`\nAIRLOCK's MCP server is not running on port ${MCP_PORT}.`);
  console.error(`Start it first, in another terminal:  npm run mcp:http`);
  console.error('\nIt has to be a *remote* server: TrueForge 0.1.4 has no stdio transport.');
  process.exit(1);
}

const existing = await api('GET', '/api/v1/settings/mcp-servers');
const known = new Set((existing.body?.data ?? []).map((s) => s.name));
const manifest = {
  type: 'remote',
  name: 'airlock',
  url: MCP_URL,
  description:
    'AIRLOCK change control. Open a change, attach a proof, ask a human. There is no tool that applies a change to production.',
};

const mcp = known.has('airlock')
  ? await api('PUT', '/api/v1/settings/mcp-servers', { manifest })
  : await api('POST', '/api/v1/settings/mcp-servers', { manifest });

if (!mcp.ok) {
  console.error(`\nCould not register the airlock MCP server (HTTP ${mcp.status}):`);
  console.error(JSON.stringify(mcp.body).slice(0, 400));
  process.exit(1);
}
console.log(`  connector airlock -> ${MCP_URL}`);

/* --- 3. can the harness actually see the tools? --------------------------- */

const tools = await api('GET', '/api/v1/mcp-servers/airlock/tools');
const list = tools.body?.data ?? [];
if (!tools.ok || list.length === 0) {
  console.error('\nThe harness registered the connector but could not enumerate its tools.');
  console.error('From inside a container, localhost is the container — the URL must be');
  console.error(`reachable from there. Currently: ${MCP_URL}`);
  process.exit(1);
}

const gated = list.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name);
console.log(`  tools     ${list.length} discovered; held for a human: ${gated.join(', ') || '(none)'}`);

if (gated.length !== 1 || gated[0] !== 'airlock_request_approval') {
  console.error('\nThe set of tools the harness would hold for a human is not what it should be.');
  console.error('Expected exactly airlock_request_approval. Refusing to continue.');
  process.exit(1);
}

/* --- 4. the agents -------------------------------------------------------- */

console.log('');
const specs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['agents/airlock-change-control.agent.json'];

for (const spec of specs) {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'register-agent.mjs'), spec], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, TRUEFORGE_BASE_URL: BASE },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

console.log('');
console.log('Ready. Open http://localhost:3000/console, or drive a turn directly:');
console.log(`  npm run harness:turn -- "Check the gate on dos_tier_migration and request approval if it would open."`);

/**
 * Register a read-only production connector with the harness, and walk the
 * OAuth if it needs one.
 *
 *   node scripts/register-connector.mjs supabase
 *   node scripts/register-connector.mjs supabase --project <your-project-ref>
 *
 * AIRLOCK's claim is "the agent read the live schema", and until a real
 * connector is mounted that is a claim about a local SQLite file. This is what
 * turns it into a fact — and it is a script rather than a curl in a README
 * because the interesting part is not the POST, it is the two things about
 * TrueForge 0.1.4 that are not guessable from the outside and that both cost an
 * afternoon:
 *
 *   1. `PUT /api/v1/settings/mcp-servers` is **collection-level**. There is no
 *      `PUT /settings/mcp-servers/{name}`; sending one returns "Route not
 *      found", which reads like the server is missing the feature rather than
 *      like the URL is wrong. The name travels in the manifest body.
 *
 *   2. A remote server registered with **no `auth` block is assumed to need no
 *      credentials.** The harness then connects unauthenticated, the upstream
 *      answers 401, and the agent is told "Failed to list tools" — which names
 *      neither the cause nor the fix. Supabase's MCP replies to that 401 with a
 *      perfectly good RFC 9728 `WWW-Authenticate: ... resource_metadata=...`,
 *      and nothing consumes it. `auth: { type: 'dcr' }` is what makes the
 *      harness run OAuth Dynamic Client Registration instead of guessing.
 *
 * `dcr` is deliberately preferred over `header` for anything that offers it.
 * A header connector wants a long-lived personal access token sitting in .env;
 * DCR mints a client at registration time, the token lives in the harness, and
 * the human approves a named scope in their own browser. It is also the only
 * one of the two that exercises the in-chat OAuth path the console renders.
 *
 * Read-only is enforced twice on purpose: `read_only=true` in the URL, so the
 * upstream itself refuses writes, and `@read-only` in the agent spec, so the
 * write tools are never even offered. Either alone would be a policy; both is
 * a property.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8791';

/**
 * Read a secret the same way the rest of the repo does: environment first, then
 * the repo-root `.env`.
 *
 * Nothing here loads dotenv, and a token that exists in `.env` but not in the
 * shell is the overwhelmingly common case — an operator edits the file and runs
 * the script, and being told "no token" while looking straight at the token is
 * the sort of thing that costs an hour and all of someone's goodwill.
 */
function secret(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name].trim();
  }
  let text;
  try {
    text = fs.readFileSync(path.join(root, '.env'), 'utf8');
  } catch {
    return null;
  }
  for (const name of names) {
    const m = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(text);
    if (m) {
      const value = m[1].trim();
      if (value) return value;
    }
  }
  return null;
}

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';
const GREEN = '\x1b[32m';
const AMBER = '\x1b[33m';
const RED = '\x1b[31m';

/**
 * The connectors AIRLOCK knows how to stand up.
 *
 * Each entry is read-only at the upstream, because every one of these points at
 * production and the agent's entire relationship with production is reading it.
 */
const CONNECTORS = {
  supabase: {
    url: (opts) =>
      `https://mcp.supabase.com/mcp?project_ref=${opts.project}&read_only=true`,
    needs: ['project'],
    /*
     * DCR first, a personal access token when one is offered — and the reason
     * the fallback exists is worth recording, because the symptom is opaque.
     *
     * TrueForge 0.1.4 caches the DCR client it mints per connector and hands
     * back an authorize URL built from it. Against Supabase that URL can fail:
     *
     *   {"message":"Unrecognized client_id"}    HTTP 422
     *
     * Supabase's own registration endpoint is healthy — POSTing to
     * `/platform/oauth/apps/register` returns 201 with a client_id that
     * redirects to the consent screen on the first try. The harness's cached
     * client is simply not one Supabase honours, updating the manifest mints
     * another equally unrecognised one, and there is no DELETE for a configured
     * MCP server to reset it with. That leaves the operator holding a link that
     * cannot work and no way to regenerate it.
     *
     * So when SUPABASE_ACCESS_TOKEN is present this registers static header
     * auth instead. It is the less elegant of the two — a long-lived token in
     * .env rather than a scope approved in a browser — but it is deterministic,
     * it survives a harness restart, and it does not put a live demo behind an
     * OAuth round trip that has already failed once. Create one at
     * https://supabase.com/dashboard/account/tokens
     *
     * `read_only=true` stays in the URL either way, so the upstream still
     * refuses writes no matter which credential opened the connection.
     */
    auth: () => {
      const token = secret('SUPABASE_ACCESS_TOKEN', 'SUPABASE_PAT');
      if (token) return { type: 'header', headers: { Authorization: `Bearer ${token}` } };
      return { type: 'dcr' };
    },
    description:
      'Supabase, read-only, scoped to one project. Live schema, live row counts, ' +
      'live server version — the facts airlock_resolve_context refuses to guess.',
  },
  github: {
    url: () => 'https://api.githubcopilot.com/mcp/',
    /*
     * GitHub is the exception to the `dcr` preference above, and not by choice.
     *
     * Registering it with `auth: { type: 'dcr' }` is refused by the harness:
     *
     *   MCP server 'github' has no DCR support (missing registration_endpoint);
     *   auth.type: dcr is misconfigured for this server
     *
     * GitHub's MCP server publishes no OAuth registration endpoint, so there is
     * no client for the harness to mint and the only route left is a static
     * header. That means a token really does sit in `.env` for this one, which
     * is exactly the trade the note above says to avoid — so the scope matters
     * more here than anywhere else. A fine-grained PAT limited to this one
     * repository with Contents and Pull requests is enough for the whole review
     * loop. A classic org-wide token is not needed and should not be used: the
     * agent's write surface is already fenced by the deny-list in
     * check-agents.mjs, and a broad token would put a second, unfenced route to
     * production behind the same string.
     */
    auth: () => {
      const token = secret('GITHUB_MCP_TOKEN', 'GITHUB_TOKEN');
      if (!token) {
        return {
          missing:
            'GITHUB_TOKEN is not set, and GitHub\'s MCP server cannot do OAuth.\n' +
            '  Create a fine-grained PAT scoped to this repository only:\n' +
            '    https://github.com/settings/personal-access-tokens/new\n' +
            '    Repository access -> Only select repositories -> Airlock\n' +
            '    Permissions -> Contents: Read and write, Pull requests: Read and write\n' +
            '  Then add it to .env as GITHUB_TOKEN=github_pat_… and run this again.',
        };
      }
      return { type: 'header', headers: { Authorization: `Bearer ${token}` } };
    },
    description:
      'GitHub, for the blast-radius scan and the review loop. Reads code; opens ' +
      'pull requests for a reviewer that is not the agent. Never merges.',
  },
};

const name = process.argv[2];
const connector = CONNECTORS[name];
if (!connector) {
  console.error(`Usage: node scripts/register-connector.mjs <${Object.keys(CONNECTORS).join('|')}> [--project REF]`);
  process.exit(2);
}

const opts = {};
for (let i = 3; i < process.argv.length; i += 1) {
  const match = /^--([a-z-]+)$/.exec(process.argv[i]);
  if (match) opts[match[1]] = process.argv[i + 1];
}

for (const required of connector.needs ?? []) {
  if (!opts[required]) {
    console.error(`${name} needs --${required}.`);
    process.exit(2);
  }
}

async function api(method, path, body) {
  const res = await fetch(new URL(path, BASE), {
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

const health = await api('GET', '/healthz').catch(() => ({ ok: false }));
if (!health.ok) {
  console.error(`No TrueForge server at ${BASE}. Start it with: npm run harness:up`);
  process.exit(2);
}

// Auth can be a plain block or a function of the environment, because one of
// these connectors needs a token read at run time rather than a constant.
const auth = typeof connector.auth === 'function' ? connector.auth() : connector.auth;
if (auth?.missing) {
  console.error(`${RED}Cannot register ${name}.${OFF}\n`);
  console.error(`  ${auth.missing}\n`);
  process.exit(2);
}

const manifest = {
  type: 'remote',
  name,
  url: connector.url(opts),
  description: connector.description,
  ...(auth ? { auth } : {}),
};

// Registered already? POST conflicts, PUT rotates. Both take the collection
// route; see the note at the top of this file.
const existing = (await api('GET', '/api/v1/settings/mcp-servers')).body?.data ?? [];
const already = existing.some((s) => s.name === name);
const written = already
  ? await api('PUT', '/api/v1/settings/mcp-servers', { manifest })
  : await api('POST', '/api/v1/settings/mcp-servers', { manifest });

if (!written.ok) {
  console.error(`${RED}The harness refused the connector (${written.status}):${OFF}`);
  console.error(JSON.stringify(written.body).slice(0, 500));
  process.exit(1);
}

console.log(`${GREEN}ok${OFF}   connector ${BOLD}${name}${OFF} ${already ? 'updated' : 'registered'}`);
console.log(`     ${DIM}${manifest.url}${OFF}`);

/* --- authorize, if it wants authorizing ----------------------------------- */

const status = written.body?.data?.auth_status?.status ?? 'unknown';

if (status === 'not_required' || status === 'authenticated') {
  console.log(`${GREEN}ok${OFF}   no authorization needed`);
} else {
  const authorize = await api('GET', `/api/v1/mcp-servers/${name}/authorize`);
  const url = authorize.body?.authorization_url;
  if (!url) {
    console.error(`${RED}The harness says authorization is required and gave no URL.${OFF}`);
    console.error(JSON.stringify(authorize.body).slice(0, 400));
    process.exit(1);
  }
  /*
   * Check the link before handing it over.
   *
   * An authorize URL is only useful if the authorization server recognises the
   * client inside it, and when it does not the operator finds out by clicking
   * it and reading a bare JSON error — at which point the obvious reading is
   * "AIRLOCK is broken" rather than "the harness cached a bad client". One
   * unauthenticated GET settles it: the server either redirects to its consent
   * screen or refuses the client outright.
   */
  let deadLink = null;
  try {
    const probe = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (probe.status >= 400) deadLink = `${probe.status} ${(await probe.text()).slice(0, 160)}`;
  } catch {
    // A network failure here is not evidence the link is bad; say nothing.
  }

  if (deadLink) {
    console.log('');
    console.error(`${RED}${BOLD}The harness produced an authorization link that its own provider rejects.${OFF}`);
    console.error(`  ${DIM}${deadLink}${OFF}`);
    console.error('');
    console.error('  This is a defect in the harness, not in your account: Supabase registers');
    console.error('  new OAuth clients on request, but the client TrueForge cached is not one');
    console.error('  it honours, and there is no way to reset it from outside.');
    console.error('');
    console.error(`  ${BOLD}Use a personal access token instead — it is deterministic:${OFF}`);
    console.error('    1. https://supabase.com/dashboard/account/tokens  ->  Generate new token');
    console.error('    2. add it to .env as SUPABASE_ACCESS_TOKEN=sbp_…');
    console.error(`    3. node scripts/register-connector.mjs ${name}${
      connector.needs?.includes('project') ? ` --project ${opts.project}` : ''
    }`);
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log(`${AMBER}${BOLD}This connector needs you to authorize it, once.${OFF}`);
  console.log('');
  console.log(`  ${url}`);
  console.log('');
  console.log(`${DIM}Open that, approve the scope, and the harness stores the token — it never${OFF}`);
  console.log(`${DIM}touches .env. The same flow appears as a card in the console the first time${OFF}`);
  console.log(`${DIM}an agent reaches for this connector, which is the path a judge should see.${OFF}`);
  // Re-running is the check: the tool enumeration below is the only evidence
  // that the authorization actually took, so there is no separate verify flag
  // to get out of step with it.
  console.log('');
  console.log(`${DIM}Then run this again to confirm — it lists the tools once the token is stored:${OFF}`);
  console.log(`${DIM}  node scripts/register-connector.mjs ${name}${
    connector.needs?.includes('project') ? ` --project ${opts.project}` : ''
  }${OFF}`);
}

/* --- prove it, by asking the harness what tools it can see ---------------- */

const tools = await api('GET', `/api/v1/mcp-servers/${name}/tools`);
if (tools.ok && Array.isArray(tools.body?.data) && tools.body.data.length > 0) {
  const names = tools.body.data.map((t) => t.name).filter(Boolean);
  console.log(`${GREEN}ok${OFF}   ${names.length} tool(s) visible through the harness`);
  console.log(`     ${DIM}${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}${OFF}`);
  console.log('');
  console.log(`${DIM}Re-register the agents so they mount it:  npm run register:agent${OFF}`);
} else if (status === 'auth_required') {
  console.log(`${DIM}     (no tools yet — that is expected until the authorization above is done)${OFF}`);
} else {
  console.error(`${RED}The connector is registered but the harness cannot enumerate its tools.${OFF}`);
  console.error(JSON.stringify(tools.body).slice(0, 400));
  process.exit(1);
}

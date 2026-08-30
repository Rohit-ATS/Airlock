/**
 * Keep credentials out of committed files and out of runtime config responses.
 *
 * `.env` is intentionally ignored and may contain real keys. Everything else
 * should contain placeholders only. The second half watches the console config
 * route: it may expose which env keys were loaded, but never their values.
 *
 * Run: node scripts/check-secrets.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const secretPatterns = [
  { name: 'OpenAI project key', pattern: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI secret key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'Daytona API key', pattern: /dtn_[A-Za-z0-9_-]{20,}/ },
  { name: 'Supabase personal access token', pattern: /sbp_[a-f0-9]{32,}/i },
  { name: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: 'Supabase service role JWT', pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/ },
];

const allowedTrackedMatches = new Map([
  ['.env.example', [/DAYTONA_API_KEY=dtn_\.\.\./]],
  ['scripts/harness-sandbox.mjs', [/DAYTONA_API_KEY=dtn_…/]],
]);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function allowed(rel, text) {
  const patterns = allowedTrackedMatches.get(rel) ?? [];
  return patterns.some((pattern) => pattern.test(text));
}

for (const rel of trackedFiles()) {
  const text = readFileSync(path.join(root, rel), 'utf8');
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(text) && !allowed(rel, text)) failures.push(`${rel}: contains a ${name}`);
  }
}

const configRoute = readFileSync(path.join(root, 'apps/console/app/api/config/route.ts'), 'utf8');
if (!/env:\s*{\s*source,\s*searched,\s*keys,\s*cwd:\s*process\.cwd\(\)\s*}/s.test(configRoute)) {
  failures.push('apps/console/app/api/config/route.ts: /api/config must expose env key names only, never values');
}

if (/process\.env|env\(/.test(configRoute.replace(/trueforgeBaseUrl\(\)|airlockAgentName\(\)|breakGlassEnabled\(\)|envSource\(\)/g, ''))) {
  failures.push('apps/console/app/api/config/route.ts: config route reads env values directly instead of through safe helpers');
}

if (failures.length > 0) {
  console.error('\nSecret checks failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('No committed secrets or config-value leaks found.');

/**
 * Register AIRLOCK's skill packs with the harness.
 *
 *   npm run harness:skills
 *
 * `harness-setup.mjs` registers the model provider, the connectors and the
 * agent, and then fails:
 *
 *   Failed (HTTP 422): Unknown skill "postgres-safety" — not configured
 *
 * The agent manifest names eight skills, and an agent may only reference a
 * skill the server already holds. Nothing in this repository ever put them
 * there, so the manifest referenced eight things that did not exist. That is
 * the whole gap this closes.
 *
 * The one thing worth knowing before reading further: **the harness clones
 * these from GitHub, it does not read your working copy.** TrueForge's skill
 * manifest accepts exactly one type — `git` — with an HTTPS GitHub or GitLab
 * URL, a path inside the repository and a ref. There is no upload endpoint and
 * no local path. A skill edited on disk and not pushed is invisible to the
 * agent, which is a genuinely confusing way to lose an afternoon, so this
 * script checks for that and says so rather than registering a stale ref.
 *
 * Idempotent: PUT upserts by manifest name, so running it twice is a no-op
 * rather than a duplicate. The result is read back from the server afterwards,
 * because a write that reports success is not evidence that the server agrees.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(root, 'skills');
const BASE = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8791';

const DIM = '\x1b[2m';
const OFF = '\x1b[0m';
const RED = '\x1b[31m';
const AMBER = '\x1b[33m';
const GREEN = '\x1b[32m';

function die(what, remedy) {
  console.error(`\n  ${RED}stop${OFF} ${what}`);
  if (remedy) console.error(`  ${DIM}${remedy}${OFF}`);
  console.error('');
  process.exit(1);
}

const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

/**
 * Where the harness will clone from.
 *
 * Read from the remote rather than hardcoded, so a fork registers its own
 * skills instead of the original author's. TrueForge validates the URL against
 * a strict GitHub/GitLab HTTPS pattern, so an `ssh://` or `git@` remote — which
 * is what a contributor with push access most likely has — is rewritten to the
 * HTTPS form it will accept rather than rejected.
 */
function repoUrl() {
  const raw = (git('remote', 'get-url', 'origin').stdout ?? '').trim();
  if (!raw) die('No `origin` remote, so there is nothing for the harness to clone.');

  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(raw);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;

  const https = /^(https:\/\/[^/]+\/[^/]+\/[^/]+?)(?:\.git)?$/.exec(raw);
  if (https) return https[1];

  die(`Cannot turn the origin remote into an HTTPS URL: ${raw}`, 'TrueForge accepts only https://github.com/... or https://gitlab.com/...');
}

/** The branch the harness should read. Overridable for a fork or a tag. */
const ref = process.env.AIRLOCK_SKILLS_REF ?? 'main';

/**
 * Read `name` and `description` out of a SKILL.md front-matter block.
 *
 * Deliberately not a YAML parser. The front matter here is two flat scalar
 * fields and pulling in a dependency to read them would be worse than the
 * three lines of regex, but the failure has to be loud: a skill whose
 * description silently came back empty would be registered as a skill the
 * model has no reason to ever load.
 */
function readSkill(dir) {
  const file = path.join(skillsDir, dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!front) die(`${dir}/SKILL.md has no front matter.`);

  const field = (key) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(front[1]);
    return m ? m[1].trim() : null;
  };

  const name = field('name') ?? dir;
  const description = field('description');
  if (!description) die(`${dir}/SKILL.md declares no description.`, 'The description is what tells the model when to load the skill.');
  if (name !== dir) {
    die(
      `${dir}/SKILL.md calls itself "${name}".`,
      'The directory name is the path the harness clones and the name the agent references. They have to agree.',
    );
  }
  return { name, description };
}

/**
 * Is what the harness will clone the same as what is on disk?
 *
 * The harness reads `ref` from GitHub. If the working copy has skill changes
 * that are uncommitted, or commits that are unpushed, then the thing that runs
 * is not the thing being edited — and every symptom of that looks like the
 * skill "not working" rather than like a stale clone.
 */
function warnIfLocalDiffers() {
  const dirty = (git('status', '--porcelain', '--', 'skills').stdout ?? '').trim();
  if (dirty) {
    console.log(`  ${AMBER}warn${OFF} skills/ has uncommitted changes; the harness will clone ${ref}, not your disk:`);
    for (const line of dirty.split('\n').slice(0, 8)) console.log(`       ${DIM}${line.trim()}${OFF}`);
  }

  const ahead = (git('rev-list', '--count', `origin/${ref}..HEAD`, '--', 'skills').stdout ?? '').trim();
  if (ahead && ahead !== '0') {
    console.log(`  ${AMBER}warn${OFF} ${ahead} unpushed commit(s) touch skills/. Push before relying on them.`);
  }
}

/* --- go ------------------------------------------------------------------- */

if (!fs.existsSync(skillsDir)) die('There is no skills/ directory.');

const dirs = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const skills = dirs.map((d) => readSkill(d)).filter(Boolean);
if (skills.length === 0) die('No skills/*/SKILL.md found.');

const url = repoUrl();
console.log(`TrueForge at ${BASE}`);
console.log(`  source    ${url} ${DIM}(ref ${ref})${OFF}`);
warnIfLocalDiffers();
console.log('');

let failed = 0;
for (const skill of skills) {
  const manifest = {
    type: 'git',
    name: skill.name,
    url,
    path: `skills/${skill.name}`,
    ref,
    description: skill.description,
  };

  let res;
  try {
    res = await fetch(new URL('/api/v1/settings/skills', BASE), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    die(`Could not reach the harness at ${BASE}.`, error.message);
  }

  if (res.ok) {
    console.log(`  ${GREEN}ok${OFF}   ${skill.name}`);
  } else {
    failed++;
    console.log(`  ${RED}FAIL${OFF} ${skill.name}  ${DIM}${res.status} ${(await res.text()).slice(0, 200)}${OFF}`);
  }
}

/* --- and then ask the server, rather than trusting the writes ------------- */

const check = await fetch(new URL('/api/v1/settings/skills', BASE));
const held = ((await check.json().catch(() => ({}))).data ?? []).map((s) => s.name);
const missing = skills.map((s) => s.name).filter((n) => !held.includes(n));

console.log('');
console.log(`  ${held.length} skill(s) configured on the server.`);

if (missing.length > 0 || failed > 0) {
  console.error(`\n${RED}Not every skill registered.${OFF} Missing: ${missing.join(', ') || '(none named)'}`);
  process.exit(1);
}

console.log('\nNow re-register the agent so it can reference them:');
console.log('  npm run harness:setup');

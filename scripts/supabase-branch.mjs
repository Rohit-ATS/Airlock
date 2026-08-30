#!/usr/bin/env node
/**
 * Create, wait for, and tear down a Supabase preview branch.
 *
 * This is a smoke tool for Damir's branch-lifecycle lane. It does not run the
 * verifier yet; it proves the account can create an ephemeral data branch and
 * then cleans it up.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SupabaseBranchClient } from '../packages/verifier/dist/index.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const KEEP = args.has('--keep');

function fromDotEnv(...names) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && names.includes(m[1])) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...fromDotEnv('SUPABASE_ACCESS_TOKEN', 'SUPABASE_URL', 'SUPABASE_PROJECT_REF'), ...process.env };
const token = env.SUPABASE_ACCESS_TOKEN;
const ref = env.SUPABASE_PROJECT_REF ?? /https:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(env.SUPABASE_URL ?? '')?.[1];

if (!token || !ref) {
  console.error('Need SUPABASE_ACCESS_TOKEN and SUPABASE_URL (or SUPABASE_PROJECT_REF) in .env.');
  process.exit(2);
}

const name = process.argv.find((arg) => arg.startsWith('airlock/')) ?? `airlock/${Date.now()}`;
const client = new SupabaseBranchClient({ projectRef: ref, accessToken: token });
const created = await client.create({ name, withData: true, persistent: false });

console.log(`created ${created.name} (${created.project_ref || created.id || 'no ref returned yet'})`);
try {
  const ready = await client.waitUntilReady({ name: created.name, timeoutMs: 10 * 60_000 });
  console.log(`ready   ${ready.name} (${ready.project_ref})`);
  if (KEEP) {
    console.log('kept    --keep was set; delete it manually when done');
  }
} finally {
  if (!KEEP) {
    await client.delete(created.project_ref || created.id || created.name, { force: true });
    console.log('deleted');
  }
}

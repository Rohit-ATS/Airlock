/**
 * Generate contracts/dossier.schema.json from the Zod contract.
 *
 * The Zod schema in packages/contract is the source of truth — it is what the
 * console validates against and what the gate reads. The JSON Schema is emitted
 * from it so the Python verifier and any other consumer share one definition
 * rather than a hand-copied twin that drifts by Wednesday.
 *
 * Run: node scripts/gen-schema.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Dossier } = await import(pathToFileURL(path.join(root, 'packages/contract/dist/index.js')).href);

const schema = z.toJSONSchema(Dossier, { target: 'draft-2020-12', io: 'input' });

const out = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/Rohit-ATS/Airlock/contracts/dossier.schema.json',
  title: 'Change Dossier v3',
  description:
    'The single contract AIRLOCK is built on. The agent produces it, the verifier fills in the certificate, the console renders it, and the approval gate reads it. Generated from packages/contract/src/dossier.ts — do not edit by hand.',
  ...schema,
};

fs.writeFileSync(path.join(root, 'contracts/dossier.schema.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('wrote contracts/dossier.schema.json');

import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * ESLint for the console.
 *
 * This existed as `next lint` and nothing else: there was no config file
 * anywhere in the repository, so the command dropped into an interactive setup
 * prompt and hung. Next 16 then removed the subcommand altogether, after which
 * `npm run lint` failed with "Invalid project directory: .../lint" — `lint`
 * being read as a path. Nothing in CI ran it, so nobody found out.
 *
 * A lint script that cannot run is worse than no lint script: it is a quality
 * gate on the contributor checklist that silently gates nothing.
 *
 * `eslint-config-next` v16 ships native flat configs, so they are imported
 * directly. The `FlatCompat` shim that the older Next docs recommend throws
 * "Converting circular structure to JSON" against this version — worth writing
 * down, because the error names neither the config nor the shim and reads like
 * a bug in ESLint itself.
 *
 * The rule set is Next's own recommended pair and no house style on top.
 * Formatting opinions are not what this repository is short of, and every rule
 * added here is a rule somebody has to argue with in review. The checks that
 * actually hold this codebase together are `npm test` and `npm run typecheck`,
 * and both gate CI.
 */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', '*.tsbuildinfo'],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;

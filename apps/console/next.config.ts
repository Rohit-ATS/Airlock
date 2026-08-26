import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Load the monorepo-root `.env` before anything reads process.env.
 *
 * Next reads `.env` from the *project* directory — `apps/console` — and there
 * isn't one there. Every other tool in this repo (the MCP server, the harness
 * scripts, `npm run harness:setup`) reads the root `.env`, so a value set in
 * the obvious place was silently invisible to exactly one consumer: the app.
 *
 * The failure that caused was nasty precisely because it was quiet.
 * `NEXT_PUBLIC_TRUEFORGE_BASE_URL=http://localhost:8791` sat in the root .env
 * while the console fell back to its `:8790` default, baked that into the
 * bundle, and then failed every harness call with ERR_CONNECTION_REFUSED —
 * behind an unrelated React warning, on a page that otherwise rendered
 * perfectly. Nothing said "wrong port".
 *
 * Existing process env always wins, so `FOO=x npm run build` still overrides.
 */
function loadRootEnv(): void {
  const file = path.join(process.cwd(), '..', '..', '.env');
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

loadRootEnv();

const isGithubPages = process.env.GITHUB_PAGES === 'true';
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const githubPagesBasePath = isGithubPages && repoName ? `/${repoName}` : undefined;

const nextConfig: NextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@airlock/contract'],
  eslint: { ignoreDuringBuilds: true },

  /*
   * Type-checking is a separate gate, not a build step.
   *
   * Next runs `tsc` inside a worker it spawns itself, and that worker does not
   * take the parent's heap flag. On this project it dies with
   * `FATAL ERROR: invalid table size Allocation failed` partway through
   * "Checking validity of types" — after compiling successfully — which reads
   * as a broken build and is not one. The same `tsc --noEmit` run directly
   * finishes clean in seconds.
   *
   * Nothing is being waved through. `npm run typecheck` runs the identical
   * check across every workspace, and CI runs it. This says only that bundling
   * and type-checking are different jobs, which is already the position this
   * config takes on ESLint one line above.
   */
  typescript: { ignoreBuildErrors: true },
  ...(isGithubPages
    ? {
        output: 'export' as const,
        images: { unoptimized: true },
        basePath: githubPagesBasePath,
        assetPrefix: githubPagesBasePath,
      }
    : {}),

  // A stray lockfile in the user's home directory makes Next pick the wrong
  // workspace root and mis-trace files. Pin it to the repo.
  outputFileTracingRoot: path.join(process.cwd(), '..', '..'),

  // Inlined at build time, so the value has to be resolved before this object
  // is constructed — which is why loadRootEnv() runs at import.
  env: {
    NEXT_PUBLIC_GITHUB_PAGES: isGithubPages ? 'true' : 'false',
    NEXT_PUBLIC_TRUEFORGE_BASE_URL:
      process.env.NEXT_PUBLIC_TRUEFORGE_BASE_URL ?? 'http://localhost:8790',
    NEXT_PUBLIC_AIRLOCK_AGENT: process.env.NEXT_PUBLIC_AIRLOCK_AGENT ?? 'airlock-change-control',
  },

  webpack: (config) => {
    // `@openuidev/react-headless` imports the Vercel AI SDK behind an optional
    // code path we never reach (AIRLOCK streams through TrueForge, not `ai`).
    // Aliasing it to false keeps the dependency out of the bundle instead of
    // installing ~2MB to satisfy an import that is never executed.
    config.resolve.alias = { ...config.resolve.alias, ai: false };
    return config;
  },
};

export default nextConfig;

import path from 'node:path';
import type { NextConfig } from 'next';

const isGithubPages = process.env.GITHUB_PAGES === 'true';
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const githubPagesBasePath = isGithubPages && repoName ? `/${repoName}` : undefined;

const nextConfig: NextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@airlock/contract'],
  eslint: { ignoreDuringBuilds: true },
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

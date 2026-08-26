import { env } from '@/data/env';

/**
 * Everything AIRLOCK says to GitHub, in one place.
 *
 * It lives in one module for two reasons. The obvious one is that the webhook,
 * the scheduled sweep and the certificate delivery all need the same three
 * calls. The one that matters more: every URL this project builds towards
 * github.com is built here, behind the same allowlist, so there is exactly one
 * place to get that right — and it has already been got wrong twice.
 *
 * The rule is that a value arriving from a webhook body never reaches a URL. It
 * is compared against the configured allowlist, and the *configured* string is
 * what the request is built from.
 */

const GITHUB_API = 'https://api.github.com';

/** `owner` and `name`, captured separately so the URL is built from the captures. */
const REPO_SLUG = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;

/** `.` is legal in a repository name, so `..` passes the slug test. It must not pass this. */
const DOTS_ONLY = /^\.+$/;

/**
 * The repositories this deployment will talk to GitHub about.
 *
 * `GITHUB_REPO`, comma separated, falling back to `GITHUB_REPOSITORY` — the
 * variable Actions sets for you.
 */
export function allowedRepos(): string[] {
  const raw = env('GITHUB_REPO') ?? env('GITHUB_REPOSITORY') ?? '';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The configured spelling of `repo`, or null when it is not one of ours. */
export function resolveRepo(repo: string): { owner: string; name: string; slug: string } | null {
  const allowed = allowedRepos().find((candidate) => candidate === repo);
  if (!allowed) return null;
  const match = REPO_SLUG.exec(allowed);
  if (!match) return null;
  const [, owner, name] = match;
  if (DOTS_ONLY.test(owner) || DOTS_ONLY.test(name)) return null;
  return { owner, name, slug: `${owner}/${name}` };
}

function headers(write = false): Record<string, string> {
  const out: Record<string, string> = { accept: 'application/vnd.github+json' };
  const token = env('GITHUB_TOKEN');
  if (token) out.authorization = `Bearer ${token}`;
  if (write) out['content-type'] = 'application/json';
  return out;
}

/**
 * Issue a request against a path this module composed itself.
 *
 * `path` is assembled from validated components by the callers below; it is
 * never a string that arrived over the wire. The finished URL is still compared
 * against the origin and path we meant, because that check does not depend on
 * having thought of every trick.
 */
async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
  const url = new URL(path, GITHUB_API);
  if (url.origin !== GITHUB_API || url.pathname !== path.split('?')[0]) return null;
  try {
    return await fetch(url, { redirect: 'error', cache: 'no-store', ...init });
  } catch {
    return null;
  }
}

/** Paths changed by a pull request. Empty on any failure — the caller decides what that means. */
export async function listChangedFiles(repo: string, pull: number): Promise<string[]> {
  const target = resolveRepo(repo);
  if (!target || !Number.isSafeInteger(pull) || pull <= 0) return [];

  const path = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/pulls/${pull}/files`;
  const res = await call(`${path}?per_page=100`, { headers: headers() });
  if (!res?.ok) return [];

  const files = (await res.json()) as Array<{ filename?: string }>;
  return files.map((file) => file.filename ?? '').filter(Boolean);
}

/**
 * The text of a file at a specific commit.
 *
 * Pinned to a ref rather than a branch on purpose: the certificate has to be
 * about the bytes that were actually reviewed. A branch moves; a SHA does not,
 * and a proof about a moving target is not a proof.
 */
export async function readFileAtRef(repo: string, filePath: string, ref: string): Promise<string | null> {
  const target = resolveRepo(repo);
  if (!target) return null;

  // The file path is attacker-adjacent — it comes from a pull request listing —
  // so each segment is encoded and traversal is refused outright.
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((s) => DOTS_ONLY.test(s))) return null;
  const encoded = segments.map(encodeURIComponent).join('/');

  const path = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/contents/${encoded}`;
  const res = await call(`${path}?ref=${encodeURIComponent(ref)}`, { headers: headers() });
  if (!res?.ok) return null;

  const body = (await res.json()) as { content?: string; encoding?: string };
  if (typeof body.content !== 'string') return null;
  if (body.encoding && body.encoding !== 'base64') return null;
  try {
    return Buffer.from(body.content, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Say something on a pull request.
 *
 * This is the delivery half of the autonomy claim: the engineer's first contact
 * with AIRLOCK is a certificate appearing where they already were. Returns the
 * comment URL, or null if it could not be posted — which the caller must treat
 * as "not delivered", never as "delivered".
 */
export async function postPullRequestComment(repo: string, pull: number, body: string): Promise<string | null> {
  const target = resolveRepo(repo);
  if (!target || !Number.isSafeInteger(pull) || pull <= 0) return null;
  if (!env('GITHUB_TOKEN')) return null;

  const path = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/issues/${pull}/comments`;
  const res = await call(path, { method: 'POST', headers: headers(true), body: JSON.stringify({ body }) });
  if (!res?.ok) return null;

  const created = (await res.json()) as { html_url?: string };
  return created.html_url ?? '';
}

/** Open pull requests, newest first. Used by the scheduled sweep. */
export async function listOpenPullRequests(
  repo: string,
): Promise<Array<{ number: number; title: string; head_sha: string; author: string }>> {
  const target = resolveRepo(repo);
  if (!target) return [];

  const path = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/pulls`;
  const res = await call(`${path}?state=open&per_page=50&sort=created&direction=desc`, { headers: headers() });
  if (!res?.ok) return [];

  const pulls = (await res.json()) as Array<{
    number?: number;
    title?: string;
    head?: { sha?: string };
    user?: { login?: string };
  }>;
  return pulls
    .filter((p) => Number.isSafeInteger(p.number) && (p.number ?? 0) > 0)
    .map((p) => ({
      number: p.number as number,
      title: p.title ?? 'untitled',
      head_sha: p.head?.sha ?? '',
      author: p.user?.login ?? 'unknown',
    }));
}

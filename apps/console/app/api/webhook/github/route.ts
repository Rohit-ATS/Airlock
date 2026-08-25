import { createHmac, timingSafeEqual } from 'node:crypto';
import { airlockAgentName, env, githubWebhookSecret, trueforgeBaseUrl } from '@/data/env';
import { NextResponse } from 'next/server';
import { putDossier } from '@/data/dossierStore';

export const dynamic = 'force-dynamic';

/**
 * The GitHub webhook — capability 19.
 *
 * When a pull request touching `migrations/` is merged, this opens an AIRLOCK
 * change on its own, through the TrueForge HTTP API. Nobody types anything; the
 * run shows up in WAITING tagged "started by: webhook".
 *
 * The signature check is real. A hackathon endpoint that accepts unsigned POSTs
 * is an open door on a service holding production credentials, and this project
 * is specifically an argument about not doing that.
 */

const BASE_URL = trueforgeBaseUrl();
const AGENT_NAME = airlockAgentName();
const SECRET = githubWebhookSecret();

/** Constant-time compare of `sha256=<hex>` against the body HMAC. */
function verifySignature(body: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on length mismatch, so guard first — and still
  // compare, so we do not leak length through timing on the common path.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface PullRequestEvent {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    merged?: boolean;
    html_url?: string;
    user?: { login?: string };
    base?: { repo?: { full_name?: string } };
  };
  repository?: { full_name?: string };
}

export async function POST(request: Request) {
  const raw = await request.text();

  if (!SECRET) {
    // Refuse rather than silently accepting anything. An unconfigured secret is
    // a misconfiguration, not a reason to trust the caller.
    return NextResponse.json(
      { error: 'GITHUB_WEBHOOK_SECRET is not set; refusing to accept unsigned webhooks' },
      { status: 503 },
    );
  }

  if (!verifySignature(raw, request.headers.get('x-hub-signature-256'), SECRET)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  const event = request.headers.get('x-github-event');
  if (event === 'ping') return NextResponse.json({ ok: true });
  if (event !== 'pull_request') return NextResponse.json({ ok: true, ignored: `event ${event}` });

  let payload: PullRequestEvent;
  try {
    payload = JSON.parse(raw) as PullRequestEvent;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const pr = payload.pull_request;
  if (payload.action !== 'closed' || !pr?.merged) {
    return NextResponse.json({ ok: true, ignored: 'not a merged pull request' });
  }

  const repo = payload.repository?.full_name ?? pr.base?.repo?.full_name ?? 'unknown/unknown';

  // Only migrations open a change. Everything else is somebody else's problem.
  const files = await listChangedFiles(repo, pr.number);
  const migrations = files.filter((f) => f.startsWith('migrations/'));
  if (migrations.length === 0) {
    return NextResponse.json({ ok: true, ignored: 'no files under migrations/' });
  }

  const request_text =
    `Pull request #${pr.number} ("${pr.title ?? 'untitled'}") merged into ${repo} and changed ` +
    `${migrations.length} migration file${migrations.length === 1 ? '' : 's'}: ${migrations.join(', ')}. ` +
    `Read the migration, work out what it does to production, and prove it before asking anyone to approve it.`;

  const sessionId = await openHarnessSession(request_text);

  const dossierId = `dos_pr_${pr.number}_${Date.now().toString(36)}`;
  const dossier = await putDossier({
    dossier_id: dossierId,
    change_class: 'SCHEMA_MIGRATION',
    request: request_text,
    requested_by: pr.user?.login ? `github:${pr.user.login}` : 'github:unknown',
    started_by: 'webhook',
    created_at: new Date().toISOString(),
    session_id: sessionId,
    target: { systems: ['postgres'] },
    // No certificate. The run has to earn one; until then the gate is sealed
    // and the console renders no approval control for it.
  });

  return NextResponse.json({ ok: true, dossier_id: dossier.dossier_id, session_id: sessionId }, { status: 202 });
}

/**
 * `owner/name`, and nothing that can leave that shape.
 *
 * GitHub allows only alphanumerics, `-`, `_` and `.` in either half, so this is
 * the real rule rather than a guess at one. Anchored at both ends, with no
 * slash permitted inside either half.
 */
const REPO_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Changed files for a PR. Unauthenticated works for public repos. */
async function listChangedFiles(repo: string, number: number | undefined): Promise<string[]> {
  if (!number) return [];

  /*
   * `repo` and `number` arrive in the webhook body, which is to say from
   * whoever can reach this route. Interpolating them straight into the API URL
   * let a caller steer the request off api.github.com entirely — `..%2f..` to
   * walk the path, a userinfo `@` to change host, a `?` or `#` to reshape the
   * query. The signature check upstream raises the bar but does not remove the
   * class: a valid signature is not a promise that the payload is honest.
   *
   * So both are validated before they are used, and the result is checked
   * against the origin it is supposed to have. A request that would go
   * anywhere else is not sent.
   */
  if (!REPO_SLUG.test(repo)) return [];
  if (!Number.isSafeInteger(number) || number <= 0) return [];

  const url = new URL(
    // Each half is encoded on its own so a `.` or `-` survives while a
    // separator cannot be smuggled in.
    `/repos/${repo.split('/').map(encodeURIComponent).join('/')}/pulls/${number}/files`,
    'https://api.github.com',
  );
  url.searchParams.set('per_page', '100');

  // Belt and braces: whatever the two values did above, the request only goes
  // out if it is still pointed at the GitHub API.
  if (url.origin !== 'https://api.github.com') return [];

  const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
  const token = env('GITHUB_TOKEN');
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, {
      headers,
      // A redirect is the other way out of the allowed origin, and there is no
      // legitimate one on this endpoint.
      redirect: 'error',
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const files = (await res.json()) as Array<{ filename?: string }>;
    return files.map((f) => f.filename ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Open a TrueForge session and start the turn, through the documented HTTP API.
 * Non-streaming: the webhook returns immediately and the run continues on the
 * server, which is exactly why session durability matters.
 */
async function openHarnessSession(message: string): Promise<string | null> {
  try {
    const created = await fetch(new URL('/api/v1/sessions', BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { name: AGENT_NAME } }),
    });
    if (!created.ok) return null;
    const session = (await created.json()) as { id?: string };
    if (!session.id) return null;

    await fetch(new URL(`/api/v1/sessions/${session.id}/turns`, BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: [{ type: 'user.message', content: message }], stream: false }),
    });

    return session.id;
  } catch {
    return null;
  }
}

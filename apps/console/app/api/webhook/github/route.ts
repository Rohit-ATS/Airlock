import { createHmac, timingSafeEqual } from 'node:crypto';
import { githubWebhookSecret } from '@/data/env';
import { NextResponse } from 'next/server';
import { certifyPullRequest } from '@/github/certify';

export const dynamic = 'force-dynamic';

/**
 * The GitHub webhook — the trigger, and the first half of the autonomy claim.
 *
 * A pull request touching `migrations/` opens an AIRLOCK change on its own,
 * through the TrueForge HTTP API. Nobody types anything and nobody opens the
 * console: the run appears in WAITING tagged "started by: webhook", and the
 * engineer's first contact with AIRLOCK is a certificate arriving on their pull
 * request.
 *
 * Three things had to change for that to be true rather than nearly true. It
 * fires when the pull request *opens*, not when it merges, because a proof
 * delivered after the decision is a post-mortem. It reads the migration SQL at
 * the head commit instead of the file names, so the brief is about statements
 * rather than an instruction to go and look. And the brief itself is derived
 * from the diff by `deriveBrief` rather than being a sentence somebody wrote
 * once and stored in a template.
 *
 * The signature check is real. A hackathon endpoint that accepts unsigned POSTs
 * is an open door on a service holding production credentials, and this project
 * is specifically an argument about not doing that.
 */

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
    head?: { sha?: string };
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

  /*
   * Fire when the pull request appears, not when it merges.
   *
   * Merging was the wrong moment and it made the whole feature ceremonial: by
   * then the decision has been taken, the change is on main, and a certificate
   * is a post-mortem. The engineer needs it while they can still act on it, so
   * the trigger is `opened`, plus `reopened` and `synchronize` — a new head is
   * a new set of bytes and the old proof is about a commit that is no longer
   * the one under discussion.
   */
  const TRIGGERS = new Set(['opened', 'reopened', 'synchronize']);
  if (!payload.action || !TRIGGERS.has(payload.action)) {
    return NextResponse.json({ ok: true, ignored: `action ${payload.action ?? 'missing'}` });
  }
  if (!pr?.number) return NextResponse.json({ ok: true, ignored: 'no pull request number' });

  const repo = payload.repository?.full_name ?? pr.base?.repo?.full_name ?? '';
  const headSha = pr.head?.sha ?? '';
  if (!headSha) return NextResponse.json({ ok: true, ignored: 'no head sha' });

  const started = await certifyPullRequest({
    repo,
    pull: pr.number,
    headSha,
    author: pr.user?.login ?? 'unknown',
    startedBy: 'webhook',
  });

  return NextResponse.json(started.body, { status: started.status });
}

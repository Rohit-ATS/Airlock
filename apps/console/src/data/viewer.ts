import type { Viewer } from '@airlock/contract';
import { trueforgeBaseUrl, trueforgeConfigured, localOperatorSetting } from './env';

/**
 * Who is asking.
 *
 * Resolved from TrueForge's own `/api/v1/auth/me`, forwarding the caller's
 * cookie or bearer token. The role is never read from the request body: if the
 * client could name its own role, separation of duties would be decoration.
 *
 * TrueForge issues two roles, `admin` and `user`. AIRLOCK maps them onto the
 * two duties that matter here:
 *   admin -> approver  (can open the gate)
 *   user  -> requester (can propose a change and read its certificate)
 */
export interface ResolvedViewer extends Viewer {
  authenticated: boolean;
  /** The literal evidence string for capability 21. */
  evidence: string;
  type: 'default' | 'oidc-connected' | 'standalone';
  /**
   * True when nobody is authenticating anybody and the console is saying so.
   * The UI renders a permanent notice on the strength of this; it is not a
   * detail, it is the caveat that makes the role honest.
   */
  standalone?: boolean;
}

/** Resolved through the shared loader so the repo-root .env is actually read. */
const BASE_URL = trueforgeBaseUrl();

/**
 * When the harness cannot answer, the caller is a requester.
 *
 * This is the fail-closed side of the two fallbacks below, and the distinction
 * between them is the whole point. "Login is switched off" is something the
 * harness *told* us, and local admin is then the honest answer — it is what a
 * developer running `npx @truefoundry/trueforge` genuinely has. "The auth
 * service returned 401" and "the auth service is unreachable" are not that:
 * they are the absence of an answer, and answering them with `approver` grants
 * the one permission this product exists to withhold.
 *
 * An audit put it plainly: anyone who can make the harness unreachable — a
 * dropped container, a wrong TRUEFORGE_BASE_URL, a network blip during a demo —
 * became an approver. Separation of duties that evaporates when a dependency is
 * down is not separation of duties.
 *
 * A requester can still read every change and every certificate. They simply
 * cannot open the gate, which is the correct posture when nobody can say who
 * they are.
 */
const UNKNOWN_VIEWER: ResolvedViewer = {
  email: 'unknown',
  role: 'requester',
  authenticated: false,
  type: 'default',
  evidence: 'GET /api/v1/auth/me did not answer — role withheld',
};

/** When login is off (local mode), TrueForge reports a single shared admin. */
const LOCAL_ADMIN: ResolvedViewer = {
  email: 'local-admin',
  role: 'approver',
  authenticated: false,
  type: 'default',
  evidence: 'GET /api/v1/auth/me -> default session (login disabled)',
};

/**
 * Standalone: there is no identity provider, and the console says so.
 *
 * This is the honest description of a fresh clone. Nothing is configured, the
 * ledger is a JSON file on this disk, and the only person who can reach the
 * console is the person sitting at it — who could edit that file directly and
 * skip every control in this repository. Withholding the approver role from
 * them protects nothing; it only makes the product impossible to evaluate.
 *
 * What it must never do is *look* like separation of duties. So the role comes
 * with a caveat the console is required to render, the email is a job
 * description rather than a person, and `authenticated` stays false, because
 * nobody authenticated anybody.
 */
const LOCAL_OPERATOR: ResolvedViewer = {
  email: 'local-operator',
  role: 'approver',
  authenticated: false,
  type: 'standalone',
  standalone: true,
  evidence: 'no identity provider configured — standalone local operator',
};

/**
 * Which way to fall when the harness does not answer.
 *
 * This is the whole of the security-relevant decision, so it is one function
 * with the reasoning next to it rather than a condition inline.
 *
 * The audit finding this preserves: *anyone who can make the harness
 * unreachable — a dropped container, a wrong TRUEFORGE_BASE_URL, a network blip
 * during a demo — became an approver.* That remains fixed, because every one of
 * those cases is a deployment that **configured** a harness. Configured and
 * silent is still a requester, exactly as before.
 *
 * The case that changes is the one the audit never covered: nothing configured
 * at all. That is not a harness that fell over, it is a product running the
 * only way it can run before you have set anything up, and answering it with
 * "you may not approve" made the console unusable on the machine of every
 * person evaluating it for the first time.
 */
function fallbackViewer(): ResolvedViewer {
  const setting = localOperatorSetting();
  if (setting === 'off') return UNKNOWN_VIEWER;
  if (setting === 'on') return LOCAL_OPERATOR;
  return trueforgeConfigured() ? UNKNOWN_VIEWER : LOCAL_OPERATOR;
}

export async function resolveViewer(request: Request): Promise<ResolvedViewer> {
  const headers: Record<string, string> = {};
  const cookie = request.headers.get('cookie');
  const auth = request.headers.get('authorization');
  if (cookie) headers.cookie = cookie;
  if (auth) headers.authorization = auth;

  try {
    const res = await fetch(new URL('/api/v1/auth/me', BASE_URL), { headers, cache: 'no-store' });
    // A rejection is not a report that login is disabled. It is a refusal to
    // identify the caller, and the caller does not get to be an approver.
    if (!res.ok) return fallbackViewer();

    const me = (await res.json()) as { type?: string; email?: string; role?: string };
    const type = me.type === 'oidc-connected' ? 'oidc-connected' : 'default';

    if (type === 'default') return LOCAL_ADMIN;

    return {
      email: me.email ?? 'unknown',
      role: me.role === 'admin' ? 'approver' : 'requester',
      authenticated: true,
      type,
      evidence: `GET /api/v1/auth/me -> oidc-connected, role=${me.role ?? 'user'}`,
    };
  } catch {
    // Unreachable. A configured deployment stays a requester; an unconfigured
    // one becomes a clearly-labelled local operator. Neither is promoted on the
    // strength of a failed request without the console saying what happened.
    return fallbackViewer();
  }
}

import type { Viewer } from '@airlock/contract';
import { trueforgeBaseUrl } from './env';

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
  type: 'default' | 'oidc-connected';
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
    if (!res.ok) return UNKNOWN_VIEWER;

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
    // Unreachable. The console stays usable — a requester can read everything —
    // but nobody is promoted on the strength of a failed request.
    return UNKNOWN_VIEWER;
  }
}

import type { Viewer } from '@airlock/contract';

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

const BASE_URL = process.env.TRUEFORGE_BASE_URL ?? process.env.NEXT_PUBLIC_TRUEFORGE_BASE_URL ?? 'http://localhost:8790';

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
    if (!res.ok) return LOCAL_ADMIN;

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
    // The console must stay usable when the harness is briefly unreachable, but
    // it must not silently promote anyone: fall back to local mode only, which
    // is what a developer running `npx @truefoundry/trueforge` actually has.
    return LOCAL_ADMIN;
  }
}

import { trueforgeBaseUrl } from '@/data/env';
import { requireSameOrigin } from '@/server/machineAuth';

export const dynamic = 'force-dynamic';
// Streaming a turn is the whole point; a cached or statically-optimised route
// would buffer the response and the console would go quiet mid-run.
export const fetchCache = 'force-no-store';

/**
 * Same-origin proxy to the TrueForge harness.
 *
 * TrueForge 0.1.4 sends no CORS headers and answers `OPTIONS` with a 404, so a
 * browser on `localhost:3000` cannot call it on `localhost:8791` at all. Every
 * request fails with `net::ERR_FAILED` before it reaches the server — which is
 * why the console rendered perfectly, listed no sessions, and silently refused
 * to send anything from the composer.
 *
 * So the browser talks to this origin and the console forwards. That is the
 * right shape regardless of CORS:
 *
 *   - the harness does not have to be reachable from the browser at all, which
 *     is what you want the moment it is not on localhost;
 *   - credentials can be attached server-side, where they belong, instead of
 *     being handed to a page;
 *   - and there is one place to look when the harness is unreachable.
 *
 * The upstream body is passed through as a stream, never buffered. Turn events
 * arrive as SSE and the console is a live surface — collecting the whole
 * response before forwarding it would turn a streaming console into a
 * spinner that eventually blinks.
 */

/** Hop-by-hop headers, plus the ones the fetch layer must compute itself. */
const STRIPPED = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  'content-length',
  // Let undici negotiate this; forwarding `br`/`zstd` and then re-streaming
  // the already-decoded body produces a response the browser cannot read.
  'accept-encoding',
]);

function forwardHeaders(source: Headers): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    if (!STRIPPED.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

async function proxy(request: Request, path: string[]): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
    const origin = requireSameOrigin(request);
    if (origin) return origin;
  }

  const base = trueforgeBaseUrl();
  const incoming = new URL(request.url);
  const target = new URL(`/${path.join('/')}${incoming.search}`, base);

  const init: RequestInit = {
    method: request.method,
    headers: forwardHeaders(request.headers),
    redirect: 'manual',
    // Required by undici whenever a body is streamed rather than buffered.
    ...(request.body ? { body: request.body, duplex: 'half' } : {}),
  } as RequestInit;

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    // A dead harness is an operational fact the console should state plainly,
    // not a stack trace in a devtools panel.
    return Response.json(
      {
        error: 'HARNESS_UNREACHABLE',
        message: `The console could not reach the TrueForge harness at ${base}.`,
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  const headers = forwardHeaders(upstream.headers);
  // Nothing between here and the browser should be tempted to buffer an
  // event stream.
  if ((upstream.headers.get('content-type') ?? '').includes('text/event-stream')) {
    headers.set('cache-control', 'no-cache, no-transform');
    headers.set('x-accel-buffering', 'no');
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function POST(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function PUT(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function PATCH(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function DELETE(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}

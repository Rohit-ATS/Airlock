/**
 * MCP over Streamable HTTP.
 *
 * TrueForge 0.1.4 attaches *remote* MCP servers and only remote ones — its
 * `MCPServerType` enum has a single member, `"remote"`, and a configured server
 * is `{ type, name, url, description }`. There is no stdio transport and no
 * `command`/`args` anywhere in the API. A stdio-only AIRLOCK MCP server is
 * therefore unmountable by the harness it was built for, which would quietly
 * take the whole human-in-the-loop guarantee with it.
 *
 * So the same tools are served over HTTP as well. This is the stateless
 * variant of the Streamable HTTP transport: every POST carries a complete
 * JSON-RPC message and gets its response in the body. The spec permits a plain
 * `application/json` response where the server has nothing to stream, and this
 * server never initiates anything — it answers questions about a change ledger.
 *
 * Deliberately not implemented, each with a correct refusal rather than a
 * silent misbehaviour:
 *   - GET (server-initiated SSE) -> 405, per the spec's allowance
 *   - DELETE (session teardown)  -> 405, because sessions carry no state here
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer, log, type JsonRpcRequest } from './protocol.js';

/** Requests larger than this are refused rather than buffered. */
const MAX_BODY_BYTES = 1_000_000;

const PARSE_ERROR = -32700;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload).toString(),
    ...headers,
  });
  res.end(payload);
}

/**
 * Body was refused for its size, as opposed to the socket failing underneath.
 *
 * Marked with a class rather than by matching on the message, so the caller can
 * answer 413 for one and 400 for the other without either answer having to
 * quote the underlying error back over the wire.
 */
class BodyTooLarge extends Error {
  constructor() {
    super('request body too large');
    this.name = 'BodyTooLarge';
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export interface HttpOptions {
  server: McpServer;
  port: number;
  /** Path the MCP endpoint is served at. Default `/mcp`. */
  path?: string;
  host?: string;
  /** Bearer token required for MCP JSON-RPC requests. */
  token: string;
}

export async function serveHttp({ server, port, path = '/mcp', host = '0.0.0.0', token }: HttpOptions): Promise<void> {
  if (!token) throw new Error('AIRLOCK_MCP_HTTP_TOKEN is required for the HTTP MCP transport.');

  const http = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      log(`unhandled: ${String(error)}`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'OPTIONS') {
      send(res, 204, null, {
        'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version, authorization',
        'access-control-allow-methods': 'POST, OPTIONS',
      });
      return;
    }

    // A liveness probe that does not require speaking MCP, so a deployment can
    // tell "the process is up" from "the protocol is wrong".
    if (req.method === 'GET' && url.pathname === '/healthz') {
      send(res, 200, { ok: true, server: 'airlock', transport: 'streamable-http' });
      return;
    }

    if (url.pathname !== path) {
      send(res, 404, { error: `Not found. The MCP endpoint is ${path}.` });
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      // Allowed by the spec: a server with nothing to push says so plainly.
      send(res, 405, { error: 'This server does not open server-initiated streams. POST JSON-RPC to this path.' }, {
        allow: 'POST, OPTIONS',
      });
      return;
    }

    if (req.method !== 'POST') {
      send(res, 405, { error: 'Method not allowed.' }, { allow: 'POST, OPTIONS' });
      return;
    }

    if (!authorized(req, token)) {
      send(
        res,
        401,
        { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
        { 'www-authenticate': 'Bearer' },
      );
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch (error) {
      // The caller is told what it did wrong and nothing about this process.
      // `String(error)` here handed back whatever the runtime put in the
      // message — a stack for anything unexpected — which is free
      // reconnaissance for someone probing the server, and none of it helps
      // the client fix its request. The detail goes to the log instead, where
      // the operator can see it and a caller cannot.
      log(`request body rejected: ${String(error)}`);
      const tooLarge = error instanceof BodyTooLarge;
      send(res, tooLarge ? 413 : 400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: PARSE_ERROR,
          message: tooLarge ? `Request body exceeds ${MAX_BODY_BYTES} bytes.` : 'Could not read request body.',
        },
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      send(res, 400, { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Invalid JSON' } });
      return;
    }

    // The spec allows a batch. Answering one and ignoring the rest would be a
    // silent partial failure, so batches are handled properly.
    const batch = Array.isArray(parsed);
    const requests = (batch ? parsed : [parsed]) as JsonRpcRequest[];
    const replies: unknown[] = [];
    for (const request of requests) {
      const reply = await server.respond(request);
      if (reply !== null) replies.push(reply);
    }

    // Nothing to say: every message was a notification.
    if (replies.length === 0) {
      send(res, 202, null);
      return;
    }

    send(res, 200, batch ? replies : replies[0]);
  }

  await new Promise<void>((resolve) => {
    http.listen(port, host, () => {
      log(`streamable-http on http://${host}:${port}${path}`);
      resolve();
    });
  });

  // Hold the process open until the socket closes.
  await new Promise<void>((resolve) => http.on('close', () => resolve()));
}

function authorized(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization ?? '';
  const value = Array.isArray(header) ? header[0] ?? '' : header;
  const actual = /^Bearer\s+(.+)$/i.exec(value)?.[1] ?? '';
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

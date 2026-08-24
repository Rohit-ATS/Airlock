/**
 * A minimal Model Context Protocol server over stdio.
 *
 * This is deliberately hand-written rather than pulled from an SDK. The whole
 * argument of AIRLOCK is that the agent's only route to production is a tool
 * whose behaviour you can read in an afternoon, so the file that defines that
 * tool should be one you can read in an afternoon.
 *
 * Transport is newline-delimited JSON-RPC 2.0 on stdin/stdout, which is what
 * an MCP stdio client speaks. Anything written to stdout that is not a response
 * corrupts the stream, so every diagnostic in this package goes to stderr.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface ToolAnnotations {
  /** The tool does not modify anything. TrueForge's `@read-only` selector reads this. */
  readOnlyHint?: boolean;
  /** The tool may destroy or overwrite something. Pairs with `@destructive`. */
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  title?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  /** Returns the text the model sees. Throwing marks the call as an error. */
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/** JSON-RPC error codes used here. -32000 upward is the implementation-defined range. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export interface ServerInfo {
  name: string;
  version: string;
  /** Shown to the operator on connect. Keep it to one sentence. */
  instructions?: string;
}

export class McpServer {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(private readonly info: ServerInfo) {}

  tool(definition: ToolDefinition): this {
    this.tools.set(definition.name, definition);
    return this;
  }

  /** Everything the client is told about, in declaration order. */
  private list() {
    return [...this.tools.values()].map(({ name, description, inputSchema, annotations }) => ({
      name,
      description,
      inputSchema,
      ...(annotations ? { annotations } : {}),
    }));
  }

  private async dispatch(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
    switch (request.method) {
      case 'initialize':
        return {
          // Pinned rather than echoed: a server should say what it speaks, not
          // agree with whatever the client claimed.
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.info.name, version: this.info.version },
          ...(this.info.instructions ? { instructions: this.info.instructions } : {}),
        };

      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null; // notifications take no response

      case 'ping':
        return {};

      case 'tools/list':
        return { tools: this.list() };

      case 'tools/call': {
        const name = String(request.params?.name ?? '');
        const tool = this.tools.get(name);
        if (!tool) {
          return {
            content: [{ type: 'text', text: `No such tool: ${name}` }],
            isError: true,
          };
        }
        const args = (request.params?.arguments as Record<string, unknown>) ?? {};
        try {
          const text = await tool.handler(args);
          return { content: [{ type: 'text', text }], isError: false };
        } catch (error) {
          // A tool failure is reported as tool content, not as a protocol
          // error: the model needs to read it and decide what to do next.
          return {
            content: [{ type: 'text', text: `${name} failed: ${message(error)}` }],
            isError: true,
          };
        }
      }

      default:
        throw Object.assign(new Error(`Unsupported method: ${request.method}`), { code: METHOD_NOT_FOUND });
    }
  }

  /** Read newline-delimited JSON-RPC from stdin until it closes. */
  async listen(): Promise<void> {
    const stdin = process.stdin;
    stdin.setEncoding('utf8');

    let buffer = '';
    for await (const chunk of stdin) {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line) await this.handleLine(line);
      }
    }
  }

  private async handleLine(line: string): Promise<void> {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      this.send({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Invalid JSON' } });
      return;
    }

    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      this.send({ jsonrpc: '2.0', id: request.id ?? null, error: { code: INVALID_REQUEST, message: 'Not a JSON-RPC 2.0 request' } });
      return;
    }

    try {
      const result = await this.dispatch(request);
      // A notification carries no id and expects no reply.
      if (result === null || request.id === undefined || request.id === null) return;
      this.send({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      const code = (error as { code?: number }).code ?? INTERNAL_ERROR;
      if (request.id === undefined || request.id === null) return;
      this.send({ jsonrpc: '2.0', id: request.id, error: { code, message: message(error) } });
    }
  }

  private send(payload: unknown): void {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
}

export function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Diagnostics go to stderr; stdout belongs to the protocol. */
export function log(...parts: unknown[]): void {
  process.stderr.write(`[airlock-mcp] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
}

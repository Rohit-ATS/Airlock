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

/**
 * Check arguments against the tool's own advertised schema.
 *
 * Until this existed, `inputSchema` was advertising rather than enforcement:
 * `params.arguments` reached the handler exactly as it arrived, so a schema told
 * the model what to send and told the server nothing at all. That is a
 * reasonable default for a permissive API and a poor one here, because it means
 * *removing a field from a schema does not remove the capability*. AIRLOCK
 * deleted `checksums` from `airlock_attach_certificate` on exactly that
 * assumption, and a hand-written request carrying three invented digests still
 * wrote a PROVEN certificate which the console then rendered as MEASURED.
 *
 * Deliberately small: required, unknown properties, enums, coarse types. That is
 * the subset which turns "the model should not send this" into "this server will
 * not accept it", and it is the subset a tool author relies on when they take a
 * property out. It is not a general JSON Schema implementation and should not
 * grow into one — anything subtler belongs in the contract's zod parse, which
 * every write already passes through.
 *
 * Unknown properties are rejected rather than stripped. Silently dropping an
 * argument the caller believed it sent is how a model ends up confidently
 * reporting work that never happened.
 */
export function validateArguments(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required ?? []) as string[];

  for (const name of required) {
    if (args[name] === undefined || args[name] === null) problems.push(`${name} is required`);
  }

  for (const [name, value] of Object.entries(args)) {
    const spec = properties[name];
    if (!spec) {
      problems.push(
        `${name} is not an argument of this tool. If you expected it to be accepted, read the tool description — the field was removed deliberately.`,
      );
      continue;
    }
    if (value === undefined || value === null) continue;

    const expected = spec.type as string | undefined;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (expected === 'integer' || expected === 'number') {
      if (actual !== 'number') problems.push(`${name} must be a ${expected}, got ${actual}`);
    } else if (expected && expected !== actual) {
      problems.push(`${name} must be ${expected}, got ${actual}`);
    }

    const enumeration = spec.enum as unknown[] | undefined;
    if (enumeration && !enumeration.includes(value)) {
      problems.push(`${name} must be one of: ${enumeration.join(', ')}. Got ${JSON.stringify(value)}`);
    }

    // One level into arrays, which is where the enums that matter live:
    // `systems`, and the `system` on each scope record.
    const items = spec.items as Record<string, unknown> | undefined;
    if (expected === 'array' && items && Array.isArray(value)) {
      const itemEnum = items.enum as unknown[] | undefined;
      value.forEach((entry, i) => {
        if (itemEnum && !itemEnum.includes(entry)) {
          problems.push(`${name}[${i}] must be one of: ${itemEnum.join(', ')}. Got ${JSON.stringify(entry)}`);
        }
      });
    }
  }

  return problems;
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

        // Checked before the handler sees them, so a property absent from the
        // schema is absent from the server's behaviour and not merely absent
        // from the model's prompt.
        const problems = validateArguments(tool.inputSchema, args);
        if (problems.length > 0) {
          return {
            content: [
              {
                type: 'text',
                text: [`${name} was called with arguments this tool does not accept:`]
                  .concat(problems.map((p) => `  - ${p}`))
                  .join(String.fromCharCode(10)),
              },
            ],
            isError: true,
          };
        }

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

  /**
   * Handle one parsed JSON-RPC message and return what should be sent back,
   * or `null` when the message is a notification and takes no reply.
   *
   * Public because there are two transports. TrueForge 0.1.4 only speaks to
   * *remote* MCP servers over HTTP — its `MCPServerType` enum has exactly one
   * member, `"remote"` — so stdio alone would make this server unmountable by
   * the very harness it exists for. Both transports share this method so they
   * cannot drift into answering the same request differently.
   */
  async respond(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      if (request.id === undefined || request.id === null) return null;
      return { jsonrpc: '2.0', id: request.id, error: { code: INVALID_REQUEST, message: 'Not a JSON-RPC 2.0 request' } };
    }

    try {
      const result = await this.dispatch(request);
      if (result === null || request.id === undefined || request.id === null) return null;
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      const code = (error as { code?: number }).code ?? INTERNAL_ERROR;
      if (request.id === undefined || request.id === null) return null;
      return { jsonrpc: '2.0', id: request.id, error: { code, message: message(error) } };
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

    // An invalid-but-parseable message still needs its error delivered, and a
    // notification still needs its silence. `respond` decides both.
    const reply = await this.respond(request);
    if (reply !== null) this.send(reply);
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

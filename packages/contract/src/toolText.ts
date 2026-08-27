/**
 * Making a tool response readable.
 *
 * `tool.response` carries `content` as **a string** — structured results are
 * serialized, and the harness does not say which kind it serialized. So the
 * sandbox log, which rendered that string raw, spent most of a real run showing
 * things like this:
 *
 *     13:16:54   {"description":"Record the facts you LOOKED UP for this change,
 *                 instead of asking a human for them. A fact lives in a system
 *                 of record — the currency on a Stripe account, a user's coun…
 *
 * That is not a result. It is AIRLOCK's own tool *schema*, echoed back because
 * the agent had called the harness's `get_tool_info` to discover it. A judge
 * reading that log sees a wall of our own prompt text and concludes, reasonably,
 * that the thing is broken.
 *
 * Worse, the same raw rendering made real failures invisible. An error comes
 * back as a JSON envelope with the message buried two levels down:
 *
 *     {"error":[{"type":"text","text":"{\"error\":\"MCP server 'deferred-tools'
 *      not found\"}"}]}
 *
 * Clipped at 220 characters, that reads as noise, in the same grey as every
 * successful call. The run had failed and the log said so in a way nobody could
 * see.
 *
 * So responses are decoded before they are shown: the payload is identified,
 * the message is lifted out of whatever envelope it arrived in, and the caller
 * is told whether this line is a result, a schema, or a failure — so it can be
 * coloured as one. Nothing is discarded silently; anything unrecognised is
 * passed through as text, because a decoder that hides what it does not
 * understand is how you lose the one line that mattered.
 */

/**
 * One tool call, as it appears on the wire.
 *
 * `server` is kept apart from `name` because `airlock·airlock_check_gate` and a
 * same-named tool on another connector are different facts, and the log is
 * evidence.
 */
export interface WireToolCall {
  id: string;
  name: string;
  server: string | null;
  /** `mcp`, `truefoundry-system`, … — how the harness classifies the tool. */
  kind: string | null;
}

/**
 * Read the tool calls off a model event, in whichever shape it arrived.
 *
 * This exists because of a difference between TrueForge's two surfaces that is
 * invisible until you go looking, and which silently disabled a good deal of
 * this console:
 *
 *   - **Stored events** (`GET /sessions/{id}/events`) put the calls on
 *     `model.message`, complete with `function.name` and `tool_info`.
 *   - **The live stream** does not. A streamed `model.message` carries only
 *     `{ type, id, thread_id, created_at }` — no content, no `tool_calls`. The
 *     calls arrive on `model.message.delta` instead: the first frame of each
 *     call carries `id`, `function.name` and `tool_info`, and every frame after
 *     it carries only `index` and a fragment of `function.arguments`.
 *
 * Everything in AIRLOCK that watched for tool calls watched `model.message`,
 * because that is what the stored events show and that is what the fixtures
 * were captured from. On a live run — which is every run a person actually
 * watches — that branch never fired. The sandbox log showed responses with no
 * calls above them, lane tool counts stayed at zero, and the capability lamps
 * that key off a tool name could not light at all.
 *
 * So both shapes are read, and continuation frames are skipped rather than
 * guessed at: a frame with no `id` and no name is an argument fragment, not a
 * call, and inventing a name for it would put a phantom tool in the evidence.
 * Callers dedupe by `id`, since the same call appears on the delta and again in
 * the stored event if both are ever folded.
 */
export function readToolCalls(event: unknown): WireToolCall[] {
  const source = isRecord(event) ? event : {};
  const calls = source.tool_calls ?? source.toolCalls;
  if (!Array.isArray(calls)) return [];

  const out: WireToolCall[] = [];
  for (const entry of calls) {
    if (!isRecord(entry)) continue;
    const fn = isRecord(entry.function) ? entry.function : {};
    const name = typeof fn.name === 'string' && fn.name ? fn.name : typeof entry.name === 'string' ? entry.name : '';
    const id = typeof entry.id === 'string' ? entry.id : '';
    // An argument fragment. Skipped, not guessed.
    if (!id || !name) continue;

    const info = isRecord(entry.tool_info) ? entry.tool_info : isRecord(entry.toolInfo) ? entry.toolInfo : {};
    const server = info.server_name ?? info.serverName;
    const kind = info.type;
    out.push({
      id,
      name,
      server: typeof server === 'string' && server ? server : null,
      kind: typeof kind === 'string' && kind ? kind : null,
    });
  }
  return out;
}

/** How a call is written in a log: `airlock·airlock_check_gate`. */
export function qualifyToolCall(call: WireToolCall): string {
  return call.server ? `${call.server}·${call.name}` : call.name;
}

/** What a tool response turned out to be. */
export type ToolResponseKind =
  /** Ordinary prose from a tool. The common, good case. */
  | 'text'
  /** The tool, or the harness on its behalf, reported a failure. */
  | 'error'
  /** A tool *definition* — the agent was reading a schema, not doing work. */
  | 'schema'
  /** Structured data with no envelope we recognise. */
  | 'json';

export interface ToolResponseLine {
  kind: ToolResponseKind;
  /** Ready to render. Clipped, with the envelope removed. */
  text: string;
  /** False only for `error`. Kept explicit so callers do not re-derive it. */
  ok: boolean;
  /** Argument names, when this was a schema. Empty otherwise. */
  fields: string[];
}

/** The sandbox log's line budget. Long enough to be evidence, short enough to scan. */
export const LINE_LIMIT = 220;

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Pull the text out of an MCP content array: `[{ type: 'text', text: '…' }]`.
 * Returns null when the value is not one, so callers can fall through.
 */
function fromContentParts(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : null))
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Unwrap an error payload as far as it actually goes.
 *
 * Bounded rather than recursive-until-done: the observed envelope is a JSON
 * string inside an MCP text part inside an `error` key, which is two levels,
 * and an unbounded loop over attacker-adjacent content is a liability for no
 * benefit. Three is one more than anything seen.
 */
function unwrapError(value: unknown, depth = 0): string | null {
  if (depth > 3) return null;

  if (typeof value === 'string') {
    const inner = parseJson(value);
    if (inner !== undefined) {
      const deeper = unwrapError(inner, depth + 1);
      if (deeper) return deeper;
    }
    return value;
  }

  const parts = fromContentParts(value);
  if (parts !== null) return unwrapError(parts, depth + 1);

  if (isRecord(value)) {
    const carrier = value.error ?? value.message ?? value.detail;
    if (carrier !== undefined) return unwrapError(carrier, depth + 1);
  }

  return null;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Decode one `tool.response` content string for display.
 *
 * Never throws, and never returns an empty line for non-empty input — a log
 * that drops a line it could not parse is worse than one that shows the raw
 * bytes, because the operator cannot tell the difference between "nothing came
 * back" and "something came back and we hid it".
 */
export function readToolResponse(content: unknown, limit: number = LINE_LIMIT): ToolResponseLine {
  const raw = typeof content === 'string' ? content : content === undefined || content === null ? '' : String(content);
  if (!raw.trim()) return { kind: 'text', text: '', ok: true, fields: [] };

  const parsed = parseJson(raw);
  if (parsed === undefined) {
    return { kind: 'text', text: clip(raw, limit), ok: true, fields: [] };
  }

  // An error envelope, in any of the shapes this harness produces.
  if (isRecord(parsed) && parsed.error !== undefined) {
    const message = unwrapError(parsed.error) ?? JSON.stringify(parsed.error);
    return { kind: 'error', text: clip(message, limit), ok: false, fields: [] };
  }
  if (isRecord(parsed) && parsed.isError === true) {
    const message = fromContentParts(parsed.content) ?? JSON.stringify(parsed.content ?? parsed);
    return { kind: 'error', text: clip(message, limit), ok: false, fields: [] };
  }

  // A tool definition, echoed back by the harness's own `get_tool_info`. This
  // is the agent reading a manual, not the agent doing work, and it is labelled
  // as such so a log full of them is legible as what it is: deferred tool
  // loading costing round trips.
  if (isRecord(parsed) && typeof parsed.description === 'string' && parsed.inputSchema !== undefined) {
    const schema = isRecord(parsed.inputSchema) ? parsed.inputSchema : {};
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    const fields = Object.keys(properties);
    const shown = fields.map((f) => (required.has(f) ? `${f}*` : f));
    return {
      kind: 'schema',
      text: clip(shown.length ? `tool schema · ${shown.join(', ')}` : 'tool schema', limit),
      ok: true,
      fields,
    };
  }

  // MCP content parts with no envelope: the text is the result.
  const parts = fromContentParts(parsed) ?? (isRecord(parsed) ? fromContentParts(parsed.content) : null);
  if (parts !== null) return { kind: 'text', text: clip(parts, limit), ok: true, fields: [] };

  return { kind: 'json', text: clip(JSON.stringify(parsed), limit), ok: true, fields: [] };
}

/**
 * Label a response with the tool it came back from.
 *
 * `tool.response` carries `tool_call_id` and nothing else — no name — so the
 * name has to be carried forward from the `model.message` that made the call.
 * Both the run store and the activity summary do exactly that, and both used to
 * render a bare "tool returned", which tells an operator nothing at the one
 * moment they are trying to work out which call went wrong.
 */
export function labelToolResponse(line: ToolResponseLine, toolName?: string | null): string {
  const name = toolName?.trim();
  if (line.kind === 'schema') return name ? `${name} · ${line.text}` : line.text;
  if (!name) return line.text;
  return line.text ? `${name} → ${line.text}` : `${name} returned nothing`;
}

/**
 * Harness capability detection.
 *
 * Every lamp on the Harness Panel is lit by this file and by nothing else.
 * The input is the real TrueForge event stream, observed as it passes through
 * to the chat runtime — we do not synthesise, replay or embellish it.
 *
 * Consequence: a run that never exercises a capability ends below the total,
 * and that is the correct outcome. There is deliberately no way to light a lamp
 * from application code.
 */
import type { HarnessEvent } from './dossier.js';

/**
 * TrueForge events are typed openly (`{ type: string; [k: string]: unknown }`)
 * and the wire format differs between transports: the HTTP/JSON surface is
 * snake_case, the TypeScript SDK camelCases the same fields. We read both
 * rather than betting on one.
 */
export type RawEvent = { type: string; [key: string]: unknown };

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Read a field by either camelCase or snake_case spelling. */
function pick(e: Record<string, unknown>, camel: string, snake: string): unknown {
  return e[camel] !== undefined ? e[camel] : e[snake];
}

/** Cumulative state across a run. Detection is order-dependent for some caps. */
export interface DetectorState {
  mcpServers: Set<string>;
  models: Set<string>;
  toolSchemasLoaded: Set<string>;
  threads: Set<string>;
  lastTotalTokens: number;
  sawCompaction: boolean;
  /** Cost accumulated from real usage/metrics, keyed by model. */
  costByModel: Record<string, number>;
  costUsd: number;
  tokens: { input: number; output: number; total: number };
}

export function newDetectorState(): DetectorState {
  return {
    mcpServers: new Set(),
    models: new Set(),
    toolSchemasLoaded: new Set(),
    threads: new Set(),
    lastTotalTokens: 0,
    sawCompaction: false,
    costByModel: {},
    costUsd: 0,
    tokens: { input: 0, output: 0, total: 0 },
  };
}

/** MCP servers whose tools count as web search for capability 4. */
const SEARCH_SERVERS = /^(exa|brightdata|bright-data|tavily|perplexity|serper|firecrawl)/i;
/** Tool names that indicate the harness ran generated code in the sandbox. */
const CODE_MODE_TOOLS = /(execute_code|run_code|code_mode|python|run_python|bash|shell|execute_command)/i;
/** Tool names that indicate a skill body was read. */
const SKILL_TOOLS = /(read_skill|load_skill|skill)/i;
/** Marker the harness leaves when it offloads an oversized tool response. */
const OFFLOAD_MARKER = /(offload|truncated|written to|saved to|\/sandbox\/|preview of|full (?:result|output) (?:is |was )?(?:at|in))/i;
const COMPACTION_MARKER = /(compact|summar(?:y|ised|ized) of the conversation|context summary)/i;

interface Emit {
  capability: number;
  evidence: string;
  detail?: string;
}

/**
 * Inspect one event and return the capabilities it proves.
 *
 * Pure apart from mutating `state`, which accumulates the run-scoped facts a
 * single event cannot establish on its own (e.g. "two distinct models").
 */
export function detect(event: RawEvent, state: DetectorState): Emit[] {
  const out: Emit[] = [];
  const type = event.type;

  switch (type) {
    case 'mcp.initialize': {
      const servers = arr(pick(event, 'mcpServers', 'mcp_servers'));
      const names: string[] = [];
      for (const s of servers) {
        const name = str(obj(s).name);
        if (!name) continue;
        names.push(name);
        state.mcpServers.add(name);
      }
      if (names.length > 0 || servers.length > 0) {
        out.push({
          capability: 1,
          evidence: 'mcp.initialize',
          detail: names.length ? names.join(', ') : `${servers.length} server(s)`,
        });
      }
      if (state.mcpServers.size >= 2) {
        out.push({
          capability: 3,
          evidence: 'mcp.initialize',
          detail: `${state.mcpServers.size} servers: ${[...state.mcpServers].join(', ')}`,
        });
      }
      break;
    }

    case 'mcp.auth_required': {
      const servers = arr(pick(event, 'mcpServers', 'mcp_servers'));
      const names = servers.map((s) => str(obj(s).name)).filter(Boolean);
      out.push({
        capability: 2,
        evidence: 'mcp.auth_required',
        detail: names.length ? `authorization requested for ${names.join(', ')}` : 'authorization requested',
      });
      break;
    }

    case 'sandbox.created': {
      const id = str(pick(event, 'sandboxId', 'sandbox_id'));
      out.push({ capability: 5, evidence: 'sandbox.created', detail: id ? `sandbox ${id}` : undefined });
      break;
    }

    case 'thread.created': {
      const threadId = str(pick(event, 'threadId', 'thread_id'));
      const title = str(event.title);
      const info = obj(pick(event, 'agentInfo', 'agent_info'));
      const model = str(info.model);
      if (threadId) state.threads.add(threadId);
      out.push({
        capability: 8,
        evidence: 'thread.created',
        detail: title ? `subagent: ${title}` : 'subagent started',
      });
      if (model) {
        state.models.add(model);
        if (state.models.size >= 2) {
          out.push({
            capability: 18,
            evidence: 'thread.created.agentInfo.model',
            detail: `${state.models.size} models in play: ${[...state.models].join(', ')}`,
          });
        }
      }
      break;
    }

    case 'tool.approval_required': {
      const calls = arr(pick(event, 'toolCalls', 'tool_calls'));
      out.push({
        capability: 13,
        evidence: 'tool.approval_required',
        detail: `${calls.length || 1} call(s) held for a human`,
      });
      break;
    }

    case 'tool.response_required': {
      out.push({
        capability: 14,
        evidence: 'tool.response_required',
        detail: 'the agent stopped to ask a question',
      });
      break;
    }

    case 'model.message': {
      const content = pick(event, 'content', 'content');
      const text = typeof content === 'string' ? content : '';

      // Generative UI: the harness streams OpenUI blocks inside a fenced block.
      if (/```(?:openui|ui|jsx)\b/i.test(text) || /<OpenUI\b/i.test(text)) {
        out.push({ capability: 15, evidence: 'OpenUI block in model.message', detail: 'agent rendered a component' });
      }

      // Real usage numbers, straight from the model call.
      const usage = obj(event.usage);
      const inTok = num(pick(usage, 'inputTokens', 'input_tokens')) ?? 0;
      const outTok = num(pick(usage, 'outputTokens', 'output_tokens')) ?? 0;
      if (inTok || outTok) {
        state.tokens.input += inTok;
        state.tokens.output += outTok;
        state.tokens.total += inTok + outTok;

        // Compaction shows up as the active context dropping sharply after growth.
        if (state.lastTotalTokens > 0 && inTok > 0 && inTok < state.lastTotalTokens * 0.6 && state.lastTotalTokens > 20000) {
          if (!state.sawCompaction) {
            state.sawCompaction = true;
            out.push({
              capability: 12,
              evidence: 'active context dropped after exceeding the compaction threshold',
              detail: `${state.lastTotalTokens.toLocaleString()} → ${inTok.toLocaleString()} input tokens`,
            });
          }
        }
        if (inTok > state.lastTotalTokens) state.lastTotalTokens = inTok;
      }

      for (const call of arr(pick(event, 'toolCalls', 'tool_calls'))) {
        const c = obj(call);
        const fn = obj(c.function);
        const name = str(fn.name) ?? '';
        const info = obj(pick(c, 'toolInfo', 'tool_info'));
        const serverName = str(pick(info, 'serverName', 'server_name')) ?? '';
        const infoType = str(info.type) ?? '';

        if (name) state.toolSchemasLoaded.add(serverName ? `${serverName}.${name}` : name);

        if (serverName && SEARCH_SERVERS.test(serverName)) {
          out.push({ capability: 4, evidence: `tool call on ${serverName}`, detail: name });
        }
        if (CODE_MODE_TOOLS.test(name)) {
          out.push({ capability: 6, evidence: `sandbox code execution: ${name}`, detail: 'generated code, not tool calls' });
        }
        if (SKILL_TOOLS.test(name) && infoType === 'truefoundry-system') {
          out.push({ capability: 7, evidence: `skill loaded via ${name}`, detail: 'SKILL.md read on demand' });
        }
      }
      break;
    }

    case 'tool.response': {
      const content = str(event.content) ?? '';
      // Offloading: a large result is replaced by a path plus a short preview.
      if (content.length > 0 && content.length < 4000 && OFFLOAD_MARKER.test(content) && /\.(json|csv|txt|ndjson|log)\b/i.test(content)) {
        out.push({
          capability: 11,
          evidence: 'tool.response replaced by a sandbox file preview',
          detail: 'full result offloaded to an artifact',
        });
      }
      if (COMPACTION_MARKER.test(content) && content.length > 400 && !state.sawCompaction) {
        state.sawCompaction = true;
        out.push({ capability: 12, evidence: 'context compaction summary', detail: 'older history replaced by a summary' });
      }
      break;
    }

    case 'turn.done': {
      const st = obj(event.state);
      const metrics = obj(st.metrics);
      const cost = num(pick(metrics, 'totalCostInUsd', 'total_cost_in_usd'));
      if (cost !== undefined) state.costUsd += cost;
      const total = num(pick(metrics, 'totalTokens', 'total_tokens'));
      if (total !== undefined) state.tokens.total = Math.max(state.tokens.total, total);

      // A turn that ends cancelled was stopped by a human mid-flight. That is
      // the only proof that the cancel actually landed — and, on a multi-replica
      // deployment, that it was peered to the executor doing the work rather
      // than swallowed by whichever replica took the HTTP request.
      if (str(st.status) === 'cancelled') {
        out.push({
          capability: 23,
          evidence: 'turn.done with state.status = cancelled',
          detail: 'a running turn was stopped by a human',
        });
      }
      break;
    }

    default:
      break;
  }

  return out;
}

/**
 * Fold a stream of raw events into harness events, de-duplicated per capability.
 * The first proof of a capability wins — the lamp records when it *first* lit.
 */
export class HarnessLedger {
  readonly state: DetectorState = newDetectorState();
  private readonly seen = new Map<number, HarnessEvent>();

  /** Returns only the harness events that are new, so callers can animate them. */
  observe(event: RawEvent): HarnessEvent[] {
    const threadId = str(pick(event, 'threadId', 'thread_id')) ?? null;
    const stepId = str(event.id) ?? '';
    const at = str(pick(event, 'createdAt', 'created_at')) ?? new Date().toISOString();

    const fresh: HarnessEvent[] = [];
    for (const emit of detect(event, this.state)) {
      if (this.seen.has(emit.capability)) continue;
      const he: HarnessEvent = {
        capability: emit.capability,
        at,
        step_id: stepId,
        evidence: emit.evidence,
        thread_id: threadId,
        ...(emit.detail ? { detail: emit.detail } : {}),
      };
      this.seen.set(emit.capability, he);
      fresh.push(he);
    }
    return fresh;
  }

  /**
   * Prove a capability that is established by configuration or by observable
   * runtime behaviour rather than by a stream event — a resolved OIDC role, a
   * resumed stream, the agent spec we actually sent. Callers must pass the real
   * evidence string; there is no default.
   */
  proveOutOfBand(capability: number, evidence: string, detail?: string): HarnessEvent | null {
    if (this.seen.has(capability)) return null;
    const he: HarnessEvent = {
      capability,
      at: new Date().toISOString(),
      step_id: '',
      evidence,
      thread_id: null,
      ...(detail ? { detail } : {}),
    };
    this.seen.set(capability, he);
    return he;
  }

  events(): HarnessEvent[] {
    return [...this.seen.values()].sort((a, b) => a.capability - b.capability);
  }

  get litCount(): number {
    return this.seen.size;
  }

  isLit(capability: number): boolean {
    return this.seen.has(capability);
  }
}

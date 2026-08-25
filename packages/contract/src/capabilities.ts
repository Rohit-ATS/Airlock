/**
 * The AIRLOCK harness capability ledger.
 *
 * This file is the single source of truth for the Harness Panel, for
 * docs/CAPABILITIES.md, and for the counter in the demo video. If a capability
 * is listed here it must be provable by a real signal — see `proof`.
 *
 * Honesty rule (from the judging criteria, and from hard experience):
 *   a lamp lights only on evidence. If we cannot evidence it, it comes off the
 *   list and the denominator drops. An honest N/N beats a padded 22/22 that a
 *   judge disproves by clicking a single lamp.
 */

/** How a capability can be proven. Ordered strongest-first. */
export type ProofMode =
  /** A real TrueForge event crossed the wire during this run. Strongest. */
  | 'stream'
  /** Observable behaviour of the running system (a reconnect, a resolved role). */
  | 'runtime'
  /** The agent spec actually sent to the harness contains it. Statically checkable. */
  | 'config';

export interface CapabilitySpec {
  id: number;
  name: string;
  /** What it does *for AIRLOCK*. If this reads as decoration, cut the capability. */
  loadBearing: string;
  /** Where a judge sees it on screen. */
  visibleAt: string;
  proof: ProofMode;
  /** The literal signal that lights the lamp. Rendered in the lamp tooltip. */
  evidence: string;
  group: CapabilityGroup;
}

export const CAPABILITY_GROUPS = ['TOOLS', 'EXECUTION', 'CONTEXT', 'CONTROL', 'SURFACE', 'PLATFORM'] as const;
export type CapabilityGroup = (typeof CAPABILITY_GROUPS)[number];

export const CAPABILITIES: readonly CapabilitySpec[] = [
  {
    id: 1,
    name: 'Remote MCP servers',
    loadBearing:
      'Supabase MCP supplies the live schema and real row counts. Without it every migration the agent writes is fiction.',
    visibleAt: 'Connector chips on the run header',
    proof: 'stream',
    evidence: 'mcp.initialize',
    group: 'TOOLS',
  },
  {
    id: 2,
    name: 'MCP OAuth (in-chat)',
    loadBearing: 'GitHub is authorised in-chat mid-run so the blast-radius scan can read the codebase.',
    visibleAt: 'The in-chat authorization card',
    proof: 'stream',
    evidence: 'mcp.auth_required',
    group: 'TOOLS',
  },
  {
    id: 3,
    name: 'Multiple MCP servers',
    loadBearing: 'An erasure spans Postgres, Stripe, Slack and object storage. One connector cannot answer it.',
    visibleAt: 'Connectors drawer — two or more initialized',
    proof: 'stream',
    evidence: 'mcp.initialize naming 2+ distinct servers',
    group: 'TOOLS',
  },
  {
    id: 4,
    name: 'Web search',
    loadBearing:
      'Lock behaviour is Postgres-version specific. The risk report cites real sources instead of recalling them.',
    visibleAt: 'Cited sources in the risk report',
    proof: 'stream',
    evidence: 'tool call on a search MCP server',
    group: 'TOOLS',
  },
  {
    id: 5,
    name: 'Sandbox as a tool',
    loadBearing:
      'The verification harness runs here. No sandbox means no shadow execution, no certificate, and therefore no gate.',
    visibleAt: 'Sandbox log pane in DOING',
    proof: 'stream',
    evidence: 'sandbox.created',
    group: 'EXECUTION',
  },
  {
    id: 6,
    name: 'Code Mode',
    loadBearing: 'Scope across millions of rows is computed as one script, not four hundred tool calls.',
    visibleAt: 'The generated script in the sandbox pane',
    proof: 'stream',
    evidence: 'sandbox code-execution tool call',
    group: 'EXECUTION',
  },
  {
    id: 7,
    name: 'Skills (SKILL.md)',
    loadBearing: 'postgres-safety and expand-contract carry the Postgres rules the model must not improvise.',
    visibleAt: 'Skill badge on the run header',
    proof: 'stream',
    evidence: 'skill body read from the sandbox',
    group: 'CONTEXT',
  },
  {
    id: 8,
    name: 'Subagents',
    loadBearing: 'A 1.2M-row diff, a codebase scan and a migration draft cannot share one context window.',
    visibleAt: 'Parallel lanes in DOING',
    proof: 'stream',
    evidence: 'thread.created',
    group: 'EXECUTION',
  },
  {
    id: 9,
    name: 'Least-privilege tool scoping',
    loadBearing:
      'Production connectors are mounted read-only, and the only tool that moves a change towards production is airlock_request_approval on our own MCP server, listed in require_approval_for_tools. There is no code path — in the root agent or in any subagent it spawns — that changes production without a human.',
    visibleAt: 'Permissions view in the run header; packages/mcp/src/tools.ts',
    proof: 'config',
    evidence: 'enable_tools / require_approval_for_tools on the agent spec',
    group: 'CONTROL',
  },
  {
    id: 10,
    name: 'Deferred tool loading',
    loadBearing: 'Stripe and Slack schemas stay out of context until a change class actually needs them.',
    visibleAt: 'Panel counter: tool schemas loaded n / m',
    proof: 'config',
    evidence: 'preload:false on every mounted MCP server',
    group: 'CONTEXT',
  },
  {
    id: 11,
    name: 'Large-result offloading',
    loadBearing: 'A row-level diff becomes a sandbox artifact. Only the summary enters context.',
    visibleAt: 'The offloaded-to-artifact chip',
    proof: 'stream',
    evidence: 'tool.response replaced by a sandbox file preview',
    group: 'CONTEXT',
  },
  {
    id: 12,
    name: 'Context compaction',
    loadBearing: 'A full erasure review runs long enough to cross the compaction threshold.',
    visibleAt: 'Compaction marker on the run timeline',
    proof: 'stream',
    evidence: 'context summarised past compaction_threshold_tokens',
    group: 'CONTEXT',
  },
  {
    id: 13,
    name: 'Human approval checkpoint',
    loadBearing:
      'Applying to production is the only gated action, it is gated on a certificate, and the gate is a tool the harness holds rather than a prompt the model is asked to respect.',
    visibleAt: 'The Certificate card',
    proof: 'stream',
    evidence: 'tool.approval_required',
    group: 'CONTROL',
  },
  {
    id: 14,
    name: 'Ask-user questions',
    loadBearing: 'Statutory retention is a judgement call the agent must not make on its own.',
    visibleAt: 'Inline question card',
    proof: 'stream',
    evidence: 'tool.response_required (ask_user_question)',
    group: 'CONTROL',
  },
  {
    id: 15,
    name: 'Generative UI',
    loadBearing: 'The agent renders its own risk report and blast-radius table as components, not prose.',
    visibleAt: 'Inline components in the transcript',
    proof: 'stream',
    evidence: 'OpenUI block in a model.message',
    group: 'SURFACE',
  },
  {
    id: 16,
    name: 'Session persistence',
    loadBearing:
      'Verification takes minutes. Closing the tab must not orphan a change mid-flight against a live branch.',
    visibleAt: 'Reopen a session and the run is still there',
    proof: 'runtime',
    evidence: 'session rehydrated from the server',
    group: 'PLATFORM',
  },
  {
    id: 17,
    name: 'Replica failover',
    loadBearing: 'A long verification survives losing the replica it started on.',
    visibleAt: 'Stream reattaches after make kill-replica',
    proof: 'runtime',
    evidence: 'stream resumed after transport loss',
    group: 'PLATFORM',
  },
  {
    id: 18,
    name: 'Per-task model routing',
    loadBearing: 'Authoring a migration and scanning a repository need neither the same model nor the same price.',
    visibleAt: 'Per-lane model label and live cost',
    proof: 'stream',
    evidence: '2+ distinct models observed across threads',
    group: 'EXECUTION',
  },
  {
    id: 19,
    name: 'HTTP API + SDK',
    loadBearing:
      'A migration PR opens an AIRLOCK change on its own, and the agent writes its dossier back through the same API. Nobody types anything.',
    visibleAt: 'The started-by badge on the run: webhook, agent or schedule',
    proof: 'runtime',
    evidence: 'session created through the HTTP API by the webhook',
    group: 'PLATFORM',
  },
  {
    id: 20,
    name: 'Chat UI SDK, rethemed',
    loadBearing:
      'The AIRLOCK console is @truefoundry/trueforge-ui with a custom layout mounted inside its own provider stack — not a lookalike built beside it.',
    visibleAt: 'The product itself',
    proof: 'config',
    evidence: 'TrueForgeUI mounted with a custom layout and theme tokens',
    group: 'SURFACE',
  },
  {
    id: 21,
    name: 'Hosted mode + OIDC roles',
    loadBearing: 'Separation of duties: a requester proposes a change, only an approver can open the gate.',
    visibleAt: 'Role badge; a requester has no Approve control',
    proof: 'runtime',
    evidence: 'GET /api/v1/auth/me returns an oidc-connected role',
    group: 'PLATFORM',
  },
  {
    id: 22,
    name: 'AI Gateway',
    loadBearing:
      'Budgets, RBAC and unified traces across every model call. Explicitly not required by the hackathon, which is exactly why it is here.',
    visibleAt: 'Gateway row in the run header',
    proof: 'config',
    evidence: 'model provider base URL resolves to a gateway',
    group: 'PLATFORM',
  },
  {
    id: 23,
    name: 'Cross-replica cancellation',
    loadBearing:
      'Approval stops a change before it starts. Until now nothing stopped one already running. ABORT cancels the turn mid-flight — and because TrueForge peers cancellations between executors over Redis, it lands even when the request reaches a different replica from the one doing the work. Without it, a long verification against a live shadow branch cannot be called off once it has begun.',
    visibleAt: 'The ABORT control on a running turn',
    proof: 'stream',
    evidence: 'turn.done with state.status = cancelled',
    group: 'CONTROL',
  },
] as const;

export const CAPABILITY_TOTAL = CAPABILITIES.length;

export const capabilityById: ReadonlyMap<number, CapabilitySpec> = new Map(CAPABILITIES.map((c) => [c.id, c]));

/** Capability ids grouped for the rail, in render order. */
export function capabilitiesByGroup(): Array<{ group: CapabilityGroup; items: CapabilitySpec[] }> {
  return CAPABILITY_GROUPS.map((group) => ({
    group,
    items: CAPABILITIES.filter((c) => c.group === group),
  }));
}

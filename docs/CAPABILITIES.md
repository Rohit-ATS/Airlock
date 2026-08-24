# Where a judge can see each capability

> **Generated file.** Edit `packages/contract/src/capabilities.ts` and run
> `node scripts/gen-capabilities.mjs`. Do not edit this by hand.

AIRLOCK claims **22 TrueForge capabilities**. Each one is load-bearing — remove it and the
product stops working — and each one lights on the Harness Panel only when a real
signal proves it.

## The honesty rule

A lamp cannot be lit from application code. The only writer is
[`packages/contract/src/detectors.ts`](../packages/contract/src/detectors.ts), which folds the real
TrueForge event stream — observed as it passes through
[`apps/console/src/server/observedServer.ts`](../apps/console/src/server/observedServer.ts) — into the
ledger. A run that does not exercise a capability ends below the total, and that is the
correct outcome.

Three proof modes, strongest first:

| Mode | Meaning |
| --- | --- |
| `stream` | A real TrueForge event crossed the wire during the run |
| `runtime` | Observable behaviour of the running system (a reconnect, a resolved role) |
| `config` | The agent spec actually sent to the harness contains it |

## The ledger

| # | Capability | Why it is load-bearing | Proof | Signal that lights it | Where you see it |
| --- | --- | --- | --- | --- | --- |
| 1 | **Remote MCP servers** | Supabase MCP supplies the live schema and real row counts. Without it every migration the agent writes is fiction. | `stream` | `mcp.initialize` | Connector chips on the run header |
| 2 | **MCP OAuth (in-chat)** | GitHub is authorised in-chat mid-run so the blast-radius scan can read the codebase. | `stream` | `mcp.auth_required` | The in-chat authorization card |
| 3 | **Multiple MCP servers** | An erasure spans Postgres, Stripe, Slack and object storage. One connector cannot answer it. | `stream` | `mcp.initialize naming 2+ distinct servers` | Connectors drawer — two or more initialized |
| 4 | **Web search** | Lock behaviour is Postgres-version specific. The risk report cites real sources instead of recalling them. | `stream` | `tool call on a search MCP server` | Cited sources in the risk report |
| 5 | **Sandbox as a tool** | The verification harness runs here. No sandbox means no shadow execution, no certificate, and therefore no gate. | `stream` | `sandbox.created` | Sandbox log pane in DOING |
| 6 | **Code Mode** | Scope across millions of rows is computed as one script, not four hundred tool calls. | `stream` | `sandbox code-execution tool call` | The generated script in the sandbox pane |
| 7 | **Skills (SKILL.md)** | postgres-safety and expand-contract carry the Postgres rules the model must not improvise. | `stream` | `skill body read from the sandbox` | Skill badge on the run header |
| 8 | **Subagents** | A 1.2M-row diff, a codebase scan and a migration draft cannot share one context window. | `stream` | `thread.created` | Parallel lanes in DOING |
| 9 | **Least-privilege tool scoping** | Production connectors are mounted read-only, and the only tool that moves a change towards production is airlock_request_approval on our own MCP server, listed in require_approval_for_tools. There is no code path — in the root agent or in any subagent it spawns — that changes production without a human. | `config` | `enable_tools / require_approval_for_tools on the agent spec` | Permissions view in the run header; packages/mcp/src/tools.ts |
| 10 | **Deferred tool loading** | Stripe and Slack schemas stay out of context until a change class actually needs them. | `config` | `preload:false on every mounted MCP server` | Panel counter: tool schemas loaded n / m |
| 11 | **Large-result offloading** | A row-level diff becomes a sandbox artifact. Only the summary enters context. | `stream` | `tool.response replaced by a sandbox file preview` | The offloaded-to-artifact chip |
| 12 | **Context compaction** | A full erasure review runs long enough to cross the compaction threshold. | `stream` | `context summarised past compaction_threshold_tokens` | Compaction marker on the run timeline |
| 13 | **Human approval checkpoint** | Applying to production is the only gated action, it is gated on a certificate, and the gate is a tool the harness holds rather than a prompt the model is asked to respect. | `stream` | `tool.approval_required` | The Certificate card |
| 14 | **Ask-user questions** | Statutory retention is a judgement call the agent must not make on its own. | `stream` | `tool.response_required (ask_user_question)` | Inline question card |
| 15 | **Generative UI** | The agent renders its own risk report and blast-radius table as components, not prose. | `stream` | `OpenUI block in a model.message` | Inline components in the transcript |
| 16 | **Session persistence** | Verification takes minutes. Closing the tab must not orphan a change mid-flight against a live branch. | `runtime` | `session rehydrated from the server` | Reopen a session and the run is still there |
| 17 | **Replica failover** | A long verification survives losing the replica it started on. | `runtime` | `stream resumed after transport loss` | Stream reattaches after make kill-replica |
| 18 | **Per-task model routing** | Authoring a migration and scanning a repository need neither the same model nor the same price. | `stream` | `2+ distinct models observed across threads` | Per-lane model label and live cost |
| 19 | **HTTP API + SDK** | A migration PR opens an AIRLOCK change on its own, and the agent writes its dossier back through the same API. Nobody types anything. | `runtime` | `session created through the HTTP API by the webhook` | The started-by badge on the run: webhook, agent or schedule |
| 20 | **Chat UI SDK, rethemed** | The AIRLOCK console is @truefoundry/trueforge-ui with a custom layout mounted inside its own provider stack — not a lookalike built beside it. | `config` | `TrueForgeUI mounted with a custom layout and theme tokens` | The product itself |
| 21 | **Hosted mode + OIDC roles** | Separation of duties: a requester proposes a change, only an approver can open the gate. | `runtime` | `GET /api/v1/auth/me returns an oidc-connected role` | Role badge; a requester has no Approve control |
| 22 | **AI Gateway** | Budgets, RBAC and unified traces across every model call. Explicitly not required by the hackathon, which is exactly why it is here. | `config` | `model provider base URL resolves to a gateway` | Gateway row in the run header |

## Grouping on the panel

- **TOOLS** — Remote MCP servers, MCP OAuth (in-chat), Multiple MCP servers, Web search
- **EXECUTION** — Sandbox as a tool, Code Mode, Subagents, Per-task model routing
- **CONTEXT** — Skills (SKILL.md), Deferred tool loading, Large-result offloading, Context compaction
- **CONTROL** — Least-privilege tool scoping, Human approval checkpoint, Ask-user questions
- **SURFACE** — Generative UI, Chat UI SDK, rethemed
- **PLATFORM** — Session persistence, Replica failover, HTTP API + SDK, Hosted mode + OIDC roles, AI Gateway

## Source map

| Concern | File |
| --- | --- |
| Capability registry (this table) | `packages/contract/src/capabilities.ts` |
| Detectors — the only thing that lights a lamp | `packages/contract/src/detectors.ts` |
| Event tap on the real stream | `apps/console/src/server/observedServer.ts` |
| Run state fed by the tap | `apps/console/src/harness/store.ts` |
| The panel itself | `apps/console/src/harness/HarnessPanel.tsx` |
| The approval gate invariant | `packages/contract/src/gate.ts` |
| Gate tests (runtime) | `packages/contract/test/gate.test.mjs` |
| Gate proof (compile time) | `packages/contract/src/gate.typetest.ts` |
| Detector tests | `packages/contract/test/harness.test.mjs` |

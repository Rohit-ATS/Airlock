# TrueForge — verified reference

Everything here was checked against the live documentation at `trueforge.dev` and the
published packages on **24 August 2026**. TrueForge was released on 19 August 2026, so
nothing about its API can be recalled from memory — anything not written down here should
be re-checked before it is relied on.

Sections marked **UNVERIFIED** are things we could not confirm. Do not build on them
without checking first.

---

## 1. Packages (confirmed on npm)

| Package | Version | What it is |
| --- | --- | --- |
| `@truefoundry/trueforge` | `0.1.4` | The server: HTTP API + bundled chat UI. `npx @truefoundry/trueforge` |
| `@truefoundry/trueforge-core` | `0.1.4` | The harness library |
| `@truefoundry/trueforge-sdk` | `0.1.3` | TypeScript client. **Real and usable.** |
| `@truefoundry/trueforge-ui` | `0.2.4` | React chat UI, built on assistant-ui |

> **Trap:** `npm search` shows the description *"Placeholder so trusted publishing can be
> configured. Do not use."* for `trueforge-sdk`. That text belongs to version `0.0.0`,
> which is still tagged `placeholder`. `latest` is `0.1.3`, is 2.2 MB unpacked, and is the
> real client. Do not skip the SDK because of that description.

### Known packaging conflict in `trueforge-ui@0.2.4`

`@assistant-ui/core@0.2.23` declares a **peer dependency** on `zustand@^5.0.11`, but
`@openuidev/react-headless` and `@openuidev/react-ui` (the Generative UI renderers) depend
on `zustand@^4`. npm hoists v4 to the root, `@assistant-ui/core` resolves it, and the build
fails with:

```
Attempted import error: 'useShallow' is not exported from 'zustand/shallow'
```

`npm ls zustand` reports it as `invalid`. Our fix is in the root `package.json`:

```jsonc
"overrides": {
  "zustand": "^5.0.15",
  "@openuidev/react-headless": { "zustand": "^4.5.7" },
  "@openuidev/react-ui":       { "zustand": "^4.5.7" }
}
```

This is an upstream bug worth reporting to TrueFoundry.

---

## 2. Running the harness

**Local mode** — SQLite, no login, one process. Needs Node ≥ 22.14.

```bash
npx @truefoundry/trueforge@latest      # http://localhost:8790
```

**Hosted mode** — Postgres + Redis, multiple replicas, OIDC.

```bash
git clone https://github.com/truefoundry/trueforge && cd trueforge
cp packages/trueforge/.env.example packages/trueforge/.env
docker compose up --build              # http://localhost:8791
```

Ports differ: **8790 local, 8791 hosted.** Redis is what peers replicas so streams and
cancellations follow a client across them — that is the mechanism behind session durability
and replica failover.

| Variable | Purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | Public origin, used to build MCP OAuth and OIDC callbacks |
| `SQLITE_PATH` | Local-mode data file |
| `PORT` / `--port` | Server port |

---

## 3. The agent spec

Saved via `POST /api/v1/agents` as `manifest`, or passed inline as `spec` when creating a
session. **All fields are `snake_case`. Only `model` is required.**

```jsonc
{
  "model": { "name": "anthropic/claude-sonnet-4-6", "params": { "max_tokens": 4096, "temperature": 0.2 } },
  "instructions": "…",
  "mcp_servers": [
    {
      "name": "supabase",
      "enable_tools": ["@all"],              // or ["@read-only"], or literal names
      "disable_tools": [],
      "preload_tools": [],
      "require_approval_for_tools": ["@write", "@destructive"],   // this is the DEFAULT
      "preload": false                        // false = deferred tool loading
    }
  ],
  "skills": [{ "name": "postgres-safety" }],  // requires sandbox
  "config": {
    "sandbox": { "enabled": true, "file_downloads": true },
    "generative_ui": { "enabled": true },
    "ask_user_questions": { "enabled": true },
    "dynamic_sub_agents": { "enabled": true },
    "context_management": {
      "compaction": { "enabled": true, "compaction_threshold_tokens": 50000 },
      "large_tool_response": { "enabled": true }
    },
    "iteration_limit": 100                    // 1–1024
  },
  "response_format": { "type": "text" },
  "messages": []                              // seed messages, injected every session
}
```

`@read-only`, `@write` and `@destructive` are resolved from the **tool annotations the MCP
server publishes**, not from anything we declare.

### What is UI-configurable vs API-only

- **UI + API:** model (selection), instructions, connectors (attach + `preload`), skills,
  sandbox on/off, and the Generative UI / Ask-questions / Dynamic sub-agents toggles.
- **API only:** model params, `enable_tools` / `disable_tools`, `require_approval_for_tools`,
  `iteration_limit`, `context_management`, `response_format`, seed messages, sandbox
  `file_downloads`.

**Tool approval is API-only.** It cannot be configured from the chat UI.

---

## 4. Six corrections to the AIRLOCK blueprint

These matter because three planned capabilities rest on API that does not exist.

### 4.1 Subagents are **dynamic**, not declared

The blueprint assumes four named subagents (`migration-author`, `rollback-author`,
`blast-radius-scout`, `lock-analyst`), each with its own model and its own tool scope.
**The spec has no such field.** `config.dynamic_sub_agents` is `{ enabled: boolean }` and
nothing else.

What actually happens: the root agent calls a built-in `create_sub_agent` tool at runtime
with instructions it generates itself, and the harness runs those subagents in parallel.

The docs are explicit about the consequences:

> **Shared tools and sandbox** — subagents have access to the same MCP tools and sandbox
> environment as the root agent.
> **No user interaction** — only the root agent talks to the user. Subagent tool calls that
> require approval still pause for the user.
> **No nesting** — delegation is one level deep.

**Therefore:** per-subagent tool scoping (blueprint capability 9) is **not implementable**
as written, and neither is per-subagent model routing (capability 18).

### 4.2 What we do instead — and why it is a stronger claim

- **Capability 9 becomes least-privilege at the agent boundary.** Production connectors are
  mounted `enable_tools: ["@read-only"]`, and the single write path is listed in
  `require_approval_for_tools`. Because subagent tool calls still pause for approval, *no
  principal in the run* — root or subagent — can touch production without a human. That is
  a better safety story than "the scout has a smaller toolbox", and it is real.

  **Since v0.2 of this document that claim got stronger still, and it is worth writing down
  why.** The weakness of the original version was that "the write path is gated" depended on
  every connector being configured correctly, forever, by everyone. AIRLOCK now ships its own
  MCP server (`packages/mcp`), and the agent's entire vocabulary towards production is five
  tools: read the policy, open a change, attach a certificate, check the gate, ask a human.
  There is deliberately **no tool that applies a change**, so the dangerous state is not
  "misconfigured", it is *unrepresentable* — the same move the gate makes in the type system,
  made again in the tool surface.

  ```jsonc
  { "name": "airlock",
    "command": "npx", "args": ["-y", "@airlock/mcp"],
    "enable_tools": ["@all"],
    "require_approval_for_tools": ["airlock_request_approval"] }   // exactly one
  ```

  Two details make this work rather than merely read well:

  - MCP tool **annotations** (`readOnlyHint`, `destructiveHint`) are what TrueForge's
    `@read-only` and `@destructive` selectors resolve against, so they have to be set on our
    own tools too. `packages/mcp/test/server.test.mjs` asserts that exactly one tool is
    annotated destructive and that it is the one held for approval — if someone adds a second
    write path, the suite fails rather than the guarantee quietly weakening.
  - Because subagents **inherit** the root agent's MCP scope (§4.1), this needs no per-subagent
    configuration. The property TrueForge's design makes awkward for tool scoping is exactly
    the property that makes this airtight.
- **Capability 18 becomes per-agent routing.** Several named agents, each saved with its own
  `model`, invoked for the job that suits them. Cost is read from real telemetry, not
  estimated (§6).

### 4.3 Cost and model are observable, and that part is true

`thread.created.agentInfo.model` reports the model a subagent thread is running, and
`turn.done.state.metrics.total_cost_in_usd` reports real spend. The live per-lane model
label and the cost counter are therefore honest readouts, not decoration.

---

### 4.4 MCP servers are **remote only**. There is no stdio transport.

Found by running it, on 24 August, against 0.1.4.

`MCPServerType` is an enum with exactly one member:

```jsonc
// GET /api/v1/openapi.json -> components.schemas.MCPServerType
{ "type": "string", "enum": ["remote"] }
```

A configured MCP server is `{ type: "remote", name, url, description, auth? }`,
registered through `POST /api/v1/settings/mcp-servers`, and an agent attaches it
**by configured name**:

```jsonc
// components.schemas.MCPServer — the agent-side entry
{ "name": "airlock", "enable_tools": [...], "require_approval_for_tools": [...], "preload": false }
```

There is no `command`, no `args`, no `env`, anywhere in the API. The blueprint's
`{ "command": "npx", "args": ["-y", "@airlock/mcp"] }` cannot work, and — this is
the part that matters — it would not have failed loudly. TrueForge would have
accepted the agent, the connector would simply have had no tools, and
`airlock_request_approval` would not have existed. The entire human-in-the-loop
guarantee would have been missing, silently, with the console still looking
correct.

**What we do instead.** `@airlock/mcp` gained a Streamable HTTP transport
(`packages/mcp/src/http.ts`) alongside stdio. It runs beside the console and is
registered as a remote server. Verified end to end: the harness enumerates all
seven tools and reads their annotations, which is what `@read-only` and
`@destructive` resolve against.

```console
$ curl localhost:8791/api/v1/mcp-servers/airlock/tools
airlock_read_policy         {"readOnlyHint":true}
airlock_request_approval    {"readOnlyHint":false,"destructiveHint":true}   <- the held one
```

`scripts/register-agent.mjs` reconciles a canonical spec with what a given
server actually supports, and prints every adaptation rather than keeping a
second, degraded copy of each spec.

### 4.5 The sandbox is Daytona, and it is not optional

`GET /api/v1/capabilities` is authoritative and worth calling before blaming
your own spec:

```json
{ "sandbox": { "enabled": false },
  "skill":   { "enabled": false, "reason": "Skills run in a sandbox, which is not configured." } }
```

The shipped sandbox catalog offers exactly one provider type, `daytona`, and it
requires its own API key. **Skills require a sandbox**, so without a Daytona
account capabilities 5 (sandbox), 6 (Code Mode) and 7 (Skills) cannot light, and
`skills` must be dropped from the spec rather than sent and rejected. That is a
hard constraint on any demo, and it is better discovered here than an hour into
one.

### 4.6 The UI SDK's composer does not work against a live server

The `getSnapshot should be cached` defect in §1 is worse than a development
warning. Against a real TrueForge server the console throws

```
Maximum update depth exceeded. The result of getSnapshot should be cached to avoid an infinite loop.
Maximum update depth exceeded. This can happen when a resource repeatedly calls setState inside useEffect.
```

and the composer stops submitting: typing a message and pressing the send
control creates **no session on the server** — confirmed by
`GET /api/v1/sessions`, which showed only the sessions created by curl.

Reproduced previously with zero AIRLOCK code, mounting `TrueForgeUI` with its
own built-in layout, so it is not something the custom layout introduces. Turns
driven through the HTTP API against the same server work perfectly, which is how
the runs in §11 were done.


## 5. Sessions, turns, events

Hierarchy: **one Agent → many Sessions → many Turns → many Events → some Deltas.**

```ts
const client = new TrueForge({ baseUrl: 'http://localhost:8790', timeoutInSeconds: 600 });
const { data: session } = await client.sessions.create({ agent: { name: 'airlock-change-control' } });
const stream = await client.sessions.createTurnStream(session.id, {
  input: [{ type: 'user.message', content: '…' }],
});
for await (const { data: event, id } of stream.withMetadata()) { /* id = sequence number */ }
```

- Turns chain automatically (`previous_turn_id` defaults to `"auto"`). Never resend history.
- Creating a turn **cancels any turn still running in that session**.
- Default SDK timeout is 60 s — raise it for streaming turns.
- A turn's `input` **cannot mix** a `user.message` with approval/response items.

### Turn input items

| `type` | Fields |
| --- | --- |
| `user.message` | `content`: string, or parts `{type:'text'}` / `{type:'file', name, data}` (data URIs) |
| `user.tool_approval` | `thread_id`, `tool_call_id`, `approval: {status:'allow'}` \| `{status:'deny', reason?}` |
| `user.tool_response` | `thread_id`, `tool_call_id`, `content` (free-form string) |

### Event types (complete list)

Every event carries `type`, `id` (monotonic ULID), `created_at`, `thread_id`.
`thread_id` is `"main"` for the root agent, a generated id for a subagent, or `null` for
run-level events.

| Event | Notes |
| --- | --- |
| `turn.created` | First event, always. Carries `turn_id`, `previous_turn_id`, `input` |
| `turn.done` | Last event, always. `state.status` = `done` \| `cancelled` \| `error` |
| `model.message` | `content`, `tool_calls`, `finish_reason`, `usage` |
| `model.message.delta` | Increment, not running total. Shares the base event's `id`. Live stream only |
| `tool.response` | `tool_call_id`, `content` (a string — structured results are serialized) |
| `tool.approval_required` | `tool_calls: [{ id, source_event_id }]`. **Turn ends here** |
| `tool.response_required` | Same shape. Client-side tool, e.g. `ask_user_question` |
| `mcp.initialize` | `mcp_servers: [{ id, name, session_id?, transport_type? }]` |
| `mcp.auth_required` | `mcp_servers: [{ id, name, auth_url }]`. **Turn ends here** |
| `sandbox.created` | `sandbox_id`. Emitted **once per session** — later turns reuse it |
| `thread.created` | `title`, `agent_info: { type, name, input, model? }`, `parent` |
| `thread.done` | `state`. Does **not** close the turn stream |

**Wire format gotcha:** the HTTP/JSON surface is `snake_case`; the TypeScript SDK
camelCases the same fields (`turnId`, `sourceEventId`, `mcpServers`). AIRLOCK's detectors
read **both** spellings rather than betting on one.

### Pauses

A turn ends **paused** when it needs a human. The pause is reported two ways:

1. as the event itself on the stream, and
2. in `turn.done.state.required_actions`.

> A `done` turn carrying `required_actions` is **paused, not complete**. Treating
> `status === 'done'` as finished is the single easiest way to break this UI.

Resume by creating a **new turn** with the matching response items. After
`mcp.auth_required` the resuming turn must **not** include a `user.message` — resume with
empty input.

### Reconnecting

Persist `session.id`, `turnId`, and the last `sequenceNumber` from `.withMetadata()`.

- Turn still `running` → `subscribeToTurn(sessionId, turnId, { afterSequenceNumber })`
- Turn finished → rebuild from `listTurnEvents` (deltas already merged)

`listTurnEvents` only works for **completed** turns.

---

## 6. The UI SDK

`TrueForgeUI` mounts every provider it needs. The props that matter to us:

| Prop | What we pass |
| --- | --- |
| `server` | Our observed server (see below) |
| `layout` | **A custom component.** `LayoutProp` accepts `ComponentType<{className?}>`, rendered *inside the full provider stack* |
| `theme` | `{ preset, mode, tokens, brand, classNames }` |
| `overrides` | `Partial<AtomSlots>` — replace any built-in component |
| `initialSessionId` | Open an existing session on mount |

**This is why capability 20 is honest.** The AIRLOCK console is not a lookalike built beside
the SDK — it is the `layout` prop. The transcript, composer, thread list, tool-approval
cards, ask-user cards and MCP OAuth screen are all the SDK's own containers.

Containers available for a custom layout: `ThreadContainer`, `ComposerContainer`,
`ThreadListContainer`, `ToolApprovalContainer`, `AskUserContainer`, `AgentStepsContainer`,
`McpAuthContainer`, `SubAgentCard`, `SandboxToolCallCard`.

Useful hooks: `useTrueFoundryRespondToToolApproval`, `useTrueFoundryTurnId`,
`useTrueFoundryCancel`, `useTrueFoundryAgentSpec`, `useServerCapabilities`,
`useComposerPauseView`, `useShellMode`, `useAui` / `useAuiState`.

Theme tokens are kebab-cased CSS variables (`primaryButtonBg` → `--primary-button-bg`).
The one exception is `fontFamily` → `--font-agent-ui`.

`@truefoundry/trueforge-ui/styles.css` **must be imported.**

> If `window.location.search` contains `screenType=mcp-auth`, `TrueForgeUI` renders only the
> OAuth completion screen and no layout. Keep that callback on its own route.

### The event tap

`AgentUIServer` is a flat intersection (`AgentChatServer & AgentBuilderServer & { catalog? }`),
and `createTurn(req): AsyncIterable<TurnStreamData>`. So we build the real adapter with
`createTrueForgeAgentUIServer({ baseUrl })` and spread-override exactly one method,
observing each event and yielding it onward unmodified. Every other capability keeps
pointing at the real implementation.

---

## 7. Auth and roles

`GET /api/v1/auth/me` returns:

```jsonc
{ "type": "default" | "oidc-connected", "email": "…", "role": "…" }
```

Login is optional. With OIDC on, each person is `admin` or `user`, decided by:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OIDC_USER_ROLE_CLAIM` | `groups` | ID-token claim inspected for admin membership |
| `OIDC_ADMIN_ROLE_VALUE` | `admin` | Exact string granting `admin` (case-sensitive) |
| `OIDC_SCOPES` | — | e.g. `openid,profile,email,groups` |

**With login off, everyone is a single shared local admin.** Separation of duties is only
real with OIDC enabled — AIRLOCK maps `admin → approver`, `user → requester`, and resolves
it server-side so a client cannot name its own role.

SDK auth: pass the OIDC **ID token** as a bearer token. There is no device-code or
client-credentials flow yet.

---

## 8. HTTP API surface (from openapi.json, v0.1.4)

```
/api/v1/agents                                   GET POST
/api/v1/agents/{agent_id}                        GET PUT DELETE
/api/v1/auth/me | /login | /logout | /callback
/api/v1/capabilities
/api/v1/catalogs/{mcp-servers,model-providers,sandbox-providers,skills}
/api/v1/mcp-servers, /{name}/authorize, /{name}/tools, /oauth/callback
/api/v1/models  /api/v1/skills
/api/v1/sessions                                 GET POST
/api/v1/sessions/{id}                            GET PUT DELETE
/api/v1/sessions/{id}/cancel
/api/v1/sessions/{id}/events
/api/v1/sessions/{id}/turns                      GET POST
/api/v1/sessions/{id}/turns/{turn_id}            GET
/api/v1/sessions/{id}/turns/{turn_id}/events
/api/v1/sessions/{id}/turns/{turn_id}/subscribe
/api/v1/sessions/{id}/turns/{turn_id}/download-sandbox-file
/api/v1/settings/{mcp-servers,model-providers,sandbox-providers,skills}
```

---

## 9. Sandbox and skills

- The sandbox is **off by default** and provisioned only when needed. Required for skills
  and Code Mode. The agent loop stays on the server — **secrets never enter the sandbox**.
- Only **Daytona** is supported today. The API key needs permission to write and delete
  snapshots and write sandboxes.
- Skills are git-backed `SKILL.md` packs. Only `name` + `description` enter input context;
  the body is read from the sandbox on demand (progressive disclosure).
- Skill names: letters, numbers, `.`, `_`, `-`, max 64 chars.
- **Attaching skills requires `config.sandbox.enabled: true`.**

---

## 10. UNVERIFIED — do not build on these without checking

1. **The exact tool name for Code Mode execution.** The docs describe Code Mode as the
   agent running a Python script that calls MCP tools, but do not name the tool. Our
   detector matches a set of plausible names and will need correcting against a real run.
2. **The exact marker for large-result offloading.** Documented behaviour (a sandbox file
   path plus a short preview) is clear; the literal string is not. Same caveat.
3. **Whether a compaction event is emitted.** Compaction is documented as behaviour, but no
   `compaction` event type appears in the event reference. We currently infer it from a
   sharp drop in input tokens after the 50k threshold, which is a heuristic and is labelled
   as one in the UI.
4. **AI Gateway / MCP Gateway wiring.** Out of scope of the TrueForge docs; needs the
   TrueFoundry Gateway documentation.
5. **Helm chart specifics** beyond `replicaCount`, `postgresql.enabled`, `redis.enabled`,
   `server.publicBaseUrl`, `configs.oidc.enabled`.

Items 1–3 affect three capability lamps. Per the honesty rule, if a real run does not prove
them, they stay dark and the denominator drops.

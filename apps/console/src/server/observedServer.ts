/**
 * Wiring the harness event tap to the real TrueForge server.
 *
 * The tap itself lives in `@airlock/contract` (`observer.ts`), generic over the
 * chunk type and with no dependency on the UI SDK — so the invariant it carries
 * ("observed on the way past, yielded onward unmodified, never re-ordered,
 * never dropped") is testable without standing up a chat server. This file is
 * the twenty lines that connect it to `createTrueForgeAgentUIServer`.
 *
 * If the wrapper were removed, the console would still work — it would just
 * stop being able to prove anything. That is the right dependency direction.
 */
import { createTrueForgeAgentUIServer } from '@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter';
import type { AgentUIServer, TurnStreamData } from '@truefoundry/trueforge-ui';
import { observeTurnStream, type ObserverHooks } from '@airlock/contract';

export type { ObserverHooks } from '@airlock/contract';

/**
 * Wrap a server so its turn stream is observed.
 *
 * `AgentUIServer` is a flat intersection of the chat and builder contracts, so
 * spreading and overriding one method is safe and keeps every other capability
 * (sessions, catalogs, agent library) pointing at the real implementation.
 */
export function withHarnessObserver(base: AgentUIServer, hooks: ObserverHooks): AgentUIServer {
  const createTurn: AgentUIServer['createTurn'] = (req) =>
    observeTurnStream<TurnStreamData>(
      base.createTurn(req),
      {
        sessionId: req.sessionId,
        // A turn created with no input is a resume: an approval, an answer, or
        // an MCP authorization coming back.
        resumed: !req.input || req.input.length === 0,
      },
      hooks,
    );

  return { ...base, createTurn };
}

export interface AirlockServerOptions {
  baseUrl: string;
  token?: string;
  hooks: ObserverHooks;
}

/** Build the real TrueForge server, observed. */
export function createAirlockServer({ baseUrl, token, hooks }: AirlockServerOptions): AgentUIServer {
  const base = createTrueForgeAgentUIServer({
    baseUrl,
    ...(token ? { token } : {}),
  }) as unknown as AgentUIServer;
  return withHarnessObserver(base, hooks);
}

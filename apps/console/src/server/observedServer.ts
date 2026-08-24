/**
 * The harness event tap.
 *
 * AIRLOCK does not build its own chat backend. It uses the real TrueForge
 * server adapter from `@truefoundry/trueforge-ui` and wraps exactly one method:
 * `createTurn`, the async iterable of turn events.
 *
 * Every event is observed on its way past and then yielded onward, unmodified.
 * That gives the Harness Panel a source of truth it cannot fake:
 *
 *   - we never synthesise an event,
 *   - we never re-order or drop one,
 *   - a capability lights only because the harness actually did the thing.
 *
 * If the wrapper were removed, the console would still work — it would just
 * stop being able to prove anything. That is the right dependency direction.
 */
import { createTrueForgeAgentUIServer } from '@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter';
import type { AgentUIServer, TurnStreamData } from '@truefoundry/trueforge-ui';
import type { RawEvent } from '@airlock/contract';

export interface ObserverHooks {
  /** Called for every event, in stream order, before the UI sees it. */
  onEvent: (event: RawEvent, meta: { sessionId: string; sequenceNumber: number }) => void;
  /** A turn stream opened. */
  onStreamOpen?: (meta: { sessionId: string; resumed: boolean }) => void;
  /** A turn stream ended, cleanly or otherwise. */
  onStreamClose?: (meta: { sessionId: string; error?: unknown }) => void;
}

/**
 * Wrap a server so its turn stream is observed.
 *
 * `AgentUIServer` is a flat intersection of the chat and builder contracts, so
 * spreading and overriding one method is safe and keeps every other capability
 * (sessions, catalogs, agent library) pointing at the real implementation.
 */
export function withHarnessObserver(base: AgentUIServer, hooks: ObserverHooks): AgentUIServer {
  const createTurn: AgentUIServer['createTurn'] = (req) => {
    const inner = base.createTurn(req);

    // A fresh generator per call; the UI may open several over a session.
    async function* observed(): AsyncGenerator<TurnStreamData> {
      // A turn created with no input is a resume (approval, answer, or MCP auth),
      // which is exactly the reconnect path capability 16/17 care about.
      const resumed = !req.input || req.input.length === 0;
      hooks.onStreamOpen?.({ sessionId: req.sessionId, resumed });
      try {
        for await (const data of inner) {
          try {
            const event = (data as { event?: unknown }).event as RawEvent | undefined;
            if (event && typeof event.type === 'string') {
              hooks.onEvent(event, {
                sessionId: req.sessionId,
                sequenceNumber: Number((data as { sequenceNumber?: number }).sequenceNumber ?? 0),
              });
            }
          } catch {
            // Observation must never be able to break the chat. If a detector
            // throws, the event still reaches the UI untouched.
          }
          yield data;
        }
        hooks.onStreamClose?.({ sessionId: req.sessionId });
      } catch (error) {
        hooks.onStreamClose?.({ sessionId: req.sessionId, error });
        throw error;
      }
    }

    return observed();
  };

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

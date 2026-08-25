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

/**
 * Make every session in this console run the AIRLOCK agent.
 *
 * Left alone, the SDK creates a session from whatever the composer's model
 * picker is set to — a bare model with no connectors. That is a perfectly good
 * chat window and a completely useless airlock: with no `airlock` MCP server
 * mounted there is no `airlock_request_approval`, nothing is held for a human,
 * and the gate the whole product is built around simply is not in the loop.
 *
 * So the console pins the agent. A caller that explicitly asks for a different
 * one still gets it — this sets a default, it does not remove a choice — but
 * the default for *this* console is the change-control agent, because that is
 * what this console is.
 */
export function withAirlockAgent(base: AgentUIServer, agentName: string): AgentUIServer {
  const createSession: AgentUIServer['createSession'] = (req) =>
    base.createSession(req?.agentName || req?.agentSpec ? req : { ...req, agentName });

  return { ...base, createSession };
}

/**
 * Return the *same* array for the same answer.
 *
 * The SDK reads its catalogs (models, connectors, skills, agents,
 * capabilities) through `useSyncExternalStore`. React compares snapshots by
 * identity, so a method that returns a freshly-parsed array on every call —
 * which any `fetch(...).then(r => r.json())` does — makes every snapshot look
 * new, and React re-renders, and re-reads, forever:
 *
 *   Maximum update depth exceeded.
 *   The result of getSnapshot should be cached to avoid an infinite loop.
 *
 * This is an upstream defect (reproducible with the SDK's own layout and zero
 * AIRLOCK code) but it is only *fatal* once the calls start succeeding. While
 * the console was pointed at the wrong port every catalog call failed, the
 * stores stayed empty, nothing churned, and the bug looked like a harmless
 * warning. Fixing the connection turned it into a crash — which is a fair
 * description of how the last two hours went.
 *
 * The fix is small and safe: memoise by value. If the payload is unchanged,
 * hand back the identical reference, and React stops.
 */
function withStableCatalogs(base: AgentUIServer): AgentUIServer {
  const cache = new Map<string, { key: string; value: unknown }>();

  const stabilise = <A extends unknown[], R>(
    name: string,
    fn: ((...args: A) => Promise<R>) | undefined,
  ): ((...args: A) => Promise<R>) | undefined => {
    if (typeof fn !== 'function') return fn;
    return async (...args: A): Promise<R> => {
      const value = await fn(...args);
      const key = `${name}:${JSON.stringify(args)}`;
      let serialised: string;
      try {
        serialised = JSON.stringify(value);
      } catch {
        // Not serialisable, so it cannot be compared — pass it straight on
        // rather than pretending to stabilise it.
        return value;
      }
      const previous = cache.get(key);
      if (previous && previous.key === serialised) return previous.value as R;
      cache.set(key, { key: serialised, value });
      return value;
    };
  };

  const next = { ...base } as Record<string, unknown>;
  // Read-only catalogs only. Anything that mutates must never be memoised.
  for (const method of ['getCapabilities', 'getModels', 'getSkills', 'getMcp', 'searchAgents', 'listSessions']) {
    const original = (base as unknown as Record<string, unknown>)[method];
    const wrapped = stabilise(method, original as ((...a: unknown[]) => Promise<unknown>) | undefined);
    if (wrapped) next[method] = wrapped.bind(base);
  }
  return next as unknown as AgentUIServer;
}

export interface AirlockServerOptions {
  baseUrl: string;
  token?: string;
  hooks: ObserverHooks;
  /** The registered agent every new session runs. */
  agentName?: string;
}

/** Build the real TrueForge server, pinned to the AIRLOCK agent and observed. */
export function createAirlockServer({ baseUrl, token, hooks, agentName }: AirlockServerOptions): AgentUIServer {
  const base = createTrueForgeAgentUIServer({
    baseUrl,
    ...(token ? { token } : {}),
  }) as unknown as AgentUIServer;

  const stable = withStableCatalogs(base);
  const pinned = agentName ? withAirlockAgent(stable, agentName) : stable;
  return withHarnessObserver(pinned, hooks);
}

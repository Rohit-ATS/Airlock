/**
 * The harness event tap.
 *
 * AIRLOCK does not build its own chat backend. It uses the real TrueForge
 * server adapter and wraps exactly one method — the async iterable of turn
 * events — so that every event can be observed on its way past and then
 * yielded onward, unmodified.
 *
 * That is what gives the Harness Panel a source of truth it cannot fake:
 *
 *   - we never synthesise an event,
 *   - we never re-order or drop one,
 *   - a capability lights only because the harness actually did the thing.
 *
 * Those three lines are the entire credibility of the panel, so they live here
 * rather than in the app, expressed generically over the chunk type and with no
 * dependency on the UI SDK at all. Two consequences, both deliberate:
 *
 *   1. The invariant is *testable* without standing up a chat server, and
 *      `test/observer.test.mjs` holds it down — a passthrough that quietly
 *      dropped an event would still render a perfectly plausible console.
 *   2. It sits beside `detectors.ts`, which is the only thing that can light a
 *      lamp. The tap feeds the detectors; keeping them in one package means the
 *      whole evidence path is one file away from itself.
 */

/**
 * The shape the transport hands us. Deliberately minimal: everything else on a
 * chunk is the SDK's business and none of ours.
 */
export interface TurnStreamChunk {
  event?: unknown;
  sequenceNumber?: number;
}

export interface StreamMeta {
  sessionId: string;
  /**
   * A turn created with no input is a resume — an approval, an answer, or an
   * MCP authorization coming back. That is exactly the reconnect path session
   * durability and replica failover care about.
   */
  resumed: boolean;
}

export interface ObserverHooks {
  /** Called for every event, in stream order, before the UI sees it. */
  onEvent: (event: { type: string; [key: string]: unknown }, meta: { sessionId: string; sequenceNumber: number }) => void;
  onStreamOpen?: (meta: StreamMeta) => void;
  onStreamClose?: (meta: { sessionId: string; error?: unknown }) => void;
}

/**
 * Observe a turn stream without changing it.
 *
 * Generic over the chunk type so the SDK's `TurnStreamData` flows through
 * untouched and un-narrowed: whatever went in comes out, by identity.
 *
 * Observation is wrapped in its own try/catch on purpose. A detector that
 * throws must never break the chat — the failure mode of "the console stopped
 * streaming because a regex was wrong" is far worse than a dark lamp, and the
 * dependency has to point that way round: remove this wrapper entirely and the
 * console still works, it just stops being able to prove anything.
 */
export async function* observeTurnStream<T extends TurnStreamChunk>(
  inner: AsyncIterable<T>,
  meta: StreamMeta,
  hooks: ObserverHooks,
): AsyncGenerator<T> {
  hooks.onStreamOpen?.(meta);
  try {
    for await (const chunk of inner) {
      try {
        const event = chunk?.event as { type?: unknown } | undefined;
        if (event && typeof event.type === 'string') {
          hooks.onEvent(event as { type: string; [key: string]: unknown }, {
            sessionId: meta.sessionId,
            sequenceNumber: Number(chunk.sequenceNumber ?? 0),
          });
        }
      } catch {
        // Observation must never be able to break the chat. If a detector
        // throws, the event still reaches the UI untouched.
      }
      yield chunk;
    }
    hooks.onStreamClose?.({ sessionId: meta.sessionId });
  } catch (error) {
    // A transport failure is reported and then re-thrown: the UI has to see it,
    // and swallowing it here would turn a dropped connection into a stream that
    // simply stops, which is the hardest kind of bug to diagnose from a console.
    hooks.onStreamClose?.({ sessionId: meta.sessionId, error });
    throw error;
  }
}

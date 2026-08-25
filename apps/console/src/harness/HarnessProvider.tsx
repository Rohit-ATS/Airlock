'use client';

import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { StopCause } from '@airlock/contract';
import { RunStore, type RunState } from './store';

const StoreCtx = createContext<RunStore | null>(null);

/**
 * Things a human can do to a run while it is running.
 *
 * Kept separate from the store on purpose: the store folds events and knows
 * nothing about the transport, and `abort` has to reach the harness. Putting it
 * on the store would give every component that reads run state the ability to
 * cancel one.
 */
export interface RunControls {
  /**
   * Cancel the turn in flight. Peered across replicas by the harness.
   *
   * `cause` is recorded rather than inferred. A cancelled turn looks identical
   * whether a person pressed the button or a ceiling was reached, and those are
   * very different things to find in a log afterwards.
   */
  abort: (cause?: StopCause) => Promise<void>;
}

const ControlsCtx = createContext<RunControls | null>(null);

export function HarnessProvider({
  store,
  controls,
  children,
}: {
  store: RunStore;
  controls?: RunControls;
  children: ReactNode;
}) {
  return (
    <StoreCtx.Provider value={store}>
      <ControlsCtx.Provider value={controls ?? null}>{children}</ControlsCtx.Provider>
    </StoreCtx.Provider>
  );
}

/** Null when the console is mounted without a live harness to cancel against. */
export function useRunControls(): RunControls | null {
  return useContext(ControlsCtx);
}

export function useRunStore(): RunStore {
  const store = useContext(StoreCtx);
  if (!store) throw new Error('useRunStore must be used inside <HarnessProvider>');
  return store;
}

/** Subscribe to the whole run. Cheap: the store commits one object per event. */
export function useRun(): RunState {
  const store = useRunStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * Subscribe to a slice, so a component that only cares about the lit count is
 * not re-rendered by every token delta.
 */
export function useRunSelector<T>(select: (s: RunState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useRunStore();
  const cache = useRef<{ value: T; has: boolean }>({ value: undefined as T, has: false });

  const get = () => {
    const next = select(store.getSnapshot());
    if (!cache.current.has || !isEqual(cache.current.value, next)) {
      cache.current = { value: next, has: true };
    }
    return cache.current.value;
  };

  return useSyncExternalStore(store.subscribe, get, get);
}

/** Convenience: the lit set, as a stable Set for O(1) lamp lookups. */
export function useLitCapabilities(): { lit: Set<number>; fresh: number | null; count: number } {
  const events = useRunSelector(
    (s) => s.harnessEvents,
    (a, b) => a.length === b.length,
  );
  const fresh = useRunSelector((s) => s.freshCapability);
  return useMemo(
    () => ({ lit: new Set(events.map((e) => e.capability)), fresh, count: events.length }),
    [events, fresh],
  );
}

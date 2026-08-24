'use client';

import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { RunStore, type RunState } from './store';

const StoreCtx = createContext<RunStore | null>(null);

export function HarnessProvider({ store, children }: { store: RunStore; children: ReactNode }) {
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
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

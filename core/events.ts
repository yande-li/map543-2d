export type Unsubscribe = () => void;

export interface TypedEmitter<TMap extends Record<string, unknown>> {
  on<K extends keyof TMap>(
    type: K,
    listener: (payload: TMap[K]) => void
  ): Unsubscribe;
  once<K extends keyof TMap>(
    type: K,
    listener: (payload: TMap[K]) => void
  ): Unsubscribe;
  emit<K extends keyof TMap>(type: K, payload: TMap[K]): void;
  hasListeners<K extends keyof TMap>(type: K): boolean;
  clear(): void;
}

type AnyListener = (payload: never) => void;

/**
 * Lightweight, strongly-typed event emitter returning disposer functions.
 */
export function createEmitter<
  TMap extends Record<string, unknown>,
>(): TypedEmitter<TMap> {
  const listeners = new Map<keyof TMap, Set<AnyListener>>();

  const on = <K extends keyof TMap>(
    type: K,
    listener: (payload: TMap[K]) => void
  ): Unsubscribe => {
    let set = listeners.get(type);
    if (!set) {
      set = new Set<AnyListener>();
      listeners.set(type, set);
    }
    const fn = listener as AnyListener;
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) {
        listeners.delete(type);
      }
    };
  };

  const once = <K extends keyof TMap>(
    type: K,
    listener: (payload: TMap[K]) => void
  ): Unsubscribe => {
    let unsub: Unsubscribe = () => {};
    unsub = on(type, (payload) => {
      unsub();
      listener(payload);
    });
    return unsub;
  };

  const emit = <K extends keyof TMap>(type: K, payload: TMap[K]): void => {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      (fn as (p: TMap[K]) => void)(payload);
    }
  };

  const hasListeners = <K extends keyof TMap>(type: K): boolean => {
    const set = listeners.get(type);
    return set !== undefined && set.size > 0;
  };

  const clear = (): void => {
    listeners.clear();
  };

  return { on, once, emit, hasListeners, clear };
}

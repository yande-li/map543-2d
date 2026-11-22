import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { type ViewportState } from '../core/viewport';
import { type MapClickListener, useMap } from './MapContext';

/**
 * Subscribes to the current map viewport state without manual useEffect boilerplate.
 */
export function useViewport(): ViewportState {
  const { viewport } = useMap();
  return useSyncExternalStore(
    (onStoreChange) => viewport.subscribe(onStoreChange),
    () => viewport.getState(),
    () => viewport.getState()
  );
}

/**
 * Subscribes to a derived slice of ViewportState, re-rendering only when the selected value changes.
 */
export function useViewportSelector<T>(
  selector: (state: ViewportState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const { viewport } = useMap();
  const selectorRef = useRef(selector);
  const isEqualRef = useRef(isEqual);
  selectorRef.current = selector;
  isEqualRef.current = isEqual;

  const cacheRef = useRef<{ initialized: boolean; value: T }>({
    initialized: false,
    value: undefined as T,
  });

  const getSnapshot = useCallback((): T => {
    const next = selectorRef.current(viewport.getState());
    if (
      cacheRef.current.initialized &&
      isEqualRef.current(cacheRef.current.value, next)
    ) {
      return cacheRef.current.value;
    }
    cacheRef.current.initialized = true;
    cacheRef.current.value = next;
    return next;
  }, [viewport]);

  return useSyncExternalStore(
    (onStoreChange) => viewport.subscribe(onStoreChange),
    getSnapshot,
    getSnapshot
  );
}

/**
 * Registers a map click listener that stays up to date without manual useEffect wiring.
 */
export function useMapClick(handler: MapClickListener): void {
  const { subscribeClick } = useMap();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribeClick((event) => {
      handlerRef.current(event);
    });
  }, [subscribeClick]);
}

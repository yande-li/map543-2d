import React, { createContext, useContext } from 'react';
import { type ControlPosition } from '../core/controls';
import { Viewport } from '../core/viewport';
import { type MapPointerEvent } from '../core/interactions';

export type MapClickListener = (event: MapPointerEvent) => void;

export interface MapContextValue {
  viewport: Viewport;
  getContainer: () => HTMLDivElement | null;
  subscribeClick: (listener: MapClickListener) => () => void;
  getControlSlot?: (position: ControlPosition) => HTMLElement | null;
  releaseControlSlot?: (position: ControlPosition) => void;
}

const MAP_CONTEXT_KEY = Symbol.for('map543-2d/MapContext');

function getOrCreateMapContext(): React.Context<MapContextValue | null> {
  const store = globalThis as unknown as Record<
    symbol,
    React.Context<MapContextValue | null> | undefined
  >;
  let ctx = store[MAP_CONTEXT_KEY];
  if (!ctx) {
    ctx = createContext<MapContextValue | null>(null);
    store[MAP_CONTEXT_KEY] = ctx;
  }
  return ctx;
}

export const MapContext = getOrCreateMapContext();

export function useMap(): MapContextValue {
  const ctx = useContext(MapContext);
  if (!ctx) {
    throw new Error('useMap must be used within a <MapView>');
  }
  return ctx;
}

export const MapProvider: React.FC<{
  value: MapContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <MapContext.Provider value={value}>{children}</MapContext.Provider>
);

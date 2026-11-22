import React, { createContext, useContext } from 'react';
import { Viewport } from '../core/viewport';
import { type MapClickEvent } from '../core/interactions';

export type MapClickListener = (event: MapClickEvent) => void;

export interface MapContextValue {
  viewport: Viewport;
  getContainer: () => HTMLDivElement | null;
  subscribeClick: (listener: MapClickListener) => () => void;
}

export const MapContext = createContext<MapContextValue | null>(null);

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

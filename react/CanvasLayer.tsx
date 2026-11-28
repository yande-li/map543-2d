import React, { useEffect, useRef } from 'react';
import { MAP_Z_INDEX } from '../core/controls';
import {
  CanvasRenderer,
  type CanvasDrawCallback,
} from '../core/canvasRenderer';
import { useMap } from './MapContext';

export interface CanvasLayerProps {
  zIndex?: number;
  maxDpr?: number;
  /** Optional reduced maxDpr applied during active viewport interaction. */
  interactionMaxDpr?: number;
  /** Delay in ms after viewport interaction stops before restoring full detail. */
  interactionIdleDelayMs?: number;
  className?: string;
  onDraw: CanvasDrawCallback;
}

/**
 * DPR-aware canvas layer synchronized with viewport changes via CanvasRenderer.
 */
export const CanvasLayer: React.FC<CanvasLayerProps> = ({
  zIndex = MAP_Z_INDEX.vector,
  maxDpr = 2,
  interactionMaxDpr,
  interactionIdleDelayMs,
  className = '',
  onDraw,
}) => {
  const { viewport } = useMap();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<CanvasRenderer | null>(null);
  const latestOptionsRef = useRef({
    maxDpr,
    interactionMaxDpr,
    interactionIdleDelayMs,
    onDraw,
  });
  latestOptionsRef.current = {
    maxDpr,
    interactionMaxDpr,
    interactionIdleDelayMs,
    onDraw,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const opts = latestOptionsRef.current;
    const layer = new CanvasRenderer({
      maxDpr: opts.maxDpr,
      ...(opts.interactionMaxDpr !== undefined
        ? { interactionMaxDpr: opts.interactionMaxDpr }
        : {}),
      ...(opts.interactionIdleDelayMs !== undefined
        ? { interactionIdleDelayMs: opts.interactionIdleDelayMs }
        : {}),
      onDraw: opts.onDraw,
    });
    layerRef.current = layer;
    layer.attachCanvas(canvas, viewport);

    return () => {
      layer.onDetach();
      layerRef.current = null;
    };
  }, [viewport]);

  useEffect(() => {
    layerRef.current?.setOptions({
      onDraw,
      maxDpr,
      ...(interactionMaxDpr !== undefined ? { interactionMaxDpr } : {}),
      ...(interactionIdleDelayMs !== undefined
        ? { interactionIdleDelayMs }
        : {}),
    });
  }, [onDraw, maxDpr, interactionMaxDpr, interactionIdleDelayMs]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex,
      }}
    />
  );
};

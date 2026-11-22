import React, { useEffect, useRef } from 'react';
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

const IDLE_DELAY_MS = 140;

/**
 * DPR-aware canvas layer synchronized with viewport viewport changes via CanvasRenderer.
 */
export const CanvasLayer: React.FC<CanvasLayerProps> = ({
  zIndex = 100,
  maxDpr = 2,
  interactionMaxDpr,
  interactionIdleDelayMs = IDLE_DELAY_MS,
  className = '',
  onDraw,
}) => {
  const { viewport } = useMap();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<CanvasRenderer | null>(null);
  const latestOptionsRef = useRef({
    zIndex,
    maxDpr,
    interactionMaxDpr,
    interactionIdleDelayMs,
    className,
    onDraw,
  });
  latestOptionsRef.current = {
    zIndex,
    maxDpr,
    interactionMaxDpr,
    interactionIdleDelayMs,
    className,
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
      interactionIdleDelayMs: opts.interactionIdleDelayMs,
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
      interactionIdleDelayMs,
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

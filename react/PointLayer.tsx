import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { type Viewport, type ViewportState } from '../core/viewport';
import { type CoordPrecision } from '../core/batch';
import { hitTestPoints } from '../core/hitTest';
import { getWasmRuntime } from '../wasm/bridge';
import {
  type PointItem,
  attachPointHover,
  packPoints,
  drawBatchPoints,
} from '../core/pointLayer';
import { CanvasLayer } from './CanvasLayer';
import { useMap } from './MapContext';

export interface PointLayerProps {
  points: readonly PointItem[];
  zIndex?: number;
  hitRadiusPx?: number;
  marginPx?: number;
  /** Coordinate buffer precision in bits: 32 (default) or 16. */
  precision?: CoordPrecision;
  className?: string;
  onPointClick?: (point: PointItem, index: number) => void;
  onPointHover?: (point: PointItem | null, index: number) => void;
}

/**
 * React wrapper around core/pointLayer for Canvas point rendering with WASM batch
 * projection and nearest-point hit-testing.
 */
export const PointLayer: React.FC<PointLayerProps> = memo(
  ({
    points,
    zIndex = 300,
    hitRadiusPx = 18,
    marginPx = 30,
    precision = 32,
    className,
    onPointClick,
    onPointHover,
  }) => {
    const { viewport, getContainer, subscribeClick } = useMap();
    const outXYRef = useRef<Float32Array>(new Float32Array(0));
    const outIdxRef = useRef<Int32Array>(new Int32Array(0));
    const onPointClickRef = useRef(onPointClick);
    const onPointHoverRef = useRef(onPointHover);
    onPointClickRef.current = onPointClick;
    onPointHoverRef.current = onPointHover;

    useEffect(() => {
      return () => {
        outXYRef.current = new Float32Array(0);
        outIdxRef.current = new Int32Array(0);
      };
    }, []);

    const spatial = useMemo(
      () => packPoints(points, precision),
      [points, precision]
    );

    const hasClick = Boolean(onPointClick);
    const hasHover = Boolean(onPointHover);

    useEffect(() => {
      if (!hasClick || points.length === 0) return;
      return subscribeClick(({ x, y }) => {
        const rt = getWasmRuntime();
        const sh = spatial.staticHandle;
        const target =
          rt !== null && sh && sh.epoch === rt.arenaEpoch ? sh : spatial;
        const idx = hitTestPoints(x, y, target, viewport, hitRadiusPx);
        if (idx >= 0) {
          onPointClickRef.current?.(points[idx], idx);
        }
      });
    }, [points, spatial, viewport, subscribeClick, hitRadiusPx, hasClick]);

    useEffect(() => {
      if (!hasClick && !hasHover) return;
      return attachPointHover(
        getContainer(),
        viewport,
        spatial,
        hitRadiusPx,
        (idx) => {
          onPointHoverRef.current?.(idx >= 0 ? points[idx] : null, idx);
        }
      );
    }, [
      getContainer,
      viewport,
      spatial,
      hitRadiusPx,
      hasClick,
      hasHover,
      points,
    ]);

    const onDraw = useCallback(
      (ctx: CanvasRenderingContext2D, _state: ViewportState, cam: Viewport) => {
        if (spatial.count === 0) return;
        if (outIdxRef.current.length < spatial.count) {
          outIdxRef.current = new Int32Array(spatial.count);
          outXYRef.current = new Float32Array(spatial.count * 2);
        }
        drawBatchPoints(
          ctx,
          cam,
          points,
          spatial,
          outXYRef.current,
          outIdxRef.current,
          marginPx
        );
      },
      [points, spatial, marginPx]
    );

    return (
      <CanvasLayer
        zIndex={zIndex}
        {...(className ? { className } : {})}
        onDraw={onDraw}
      />
    );
  }
);
PointLayer.displayName = 'PointLayer';

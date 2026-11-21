import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { type Camera, type ViewportState } from '../core/camera';
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
  }) => {
    const { camera, getContainer, subscribeClick } = useMap();
    const outXYRef = useRef<Float32Array>(new Float32Array(0));
    const outIdxRef = useRef<Int32Array>(new Int32Array(0));

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

    useEffect(() => {
      if (!onPointClick || points.length === 0) return;
      return subscribeClick(({ x, y }) => {
        const rt = getWasmRuntime();
        const sh = spatial.staticHandle;
        const target =
          rt !== null && sh && sh.epoch === rt.arenaEpoch ? sh : spatial;
        const idx = hitTestPoints(x, y, target, camera, hitRadiusPx);
        if (idx >= 0) {
          onPointClick(points[idx], idx);
        }
      });
    }, [points, spatial, camera, subscribeClick, hitRadiusPx, onPointClick]);

    useEffect(() => {
      if (!onPointClick) return;
      return attachPointHover(getContainer(), camera, spatial, hitRadiusPx);
    }, [getContainer, camera, spatial, hitRadiusPx, onPointClick]);

    const onDraw = useCallback(
      (ctx: CanvasRenderingContext2D, _state: ViewportState, cam: Camera) => {
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

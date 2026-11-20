import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { type Camera, type ViewportState } from '../core/camera';
import {
  hitTestPoints,
  hitTestPointsI16,
  hitTestStaticPoints,
} from '../core/hitTest';
import { getWasmRuntime } from '../wasm/bridge';
import {
  type PointItem,
  attachPointHover,
  packPoints,
  drawBatchPoints,
} from '../core/pointLayer';
import { CanvasLayer } from './CanvasLayer';
import { useMap } from './MapContext';
import { useWasmReady } from './useWasmReady';

export interface PointLayerProps {
  points: PointItem[];
  zIndex?: number;
  hitRadiusPx?: number;
  marginPx?: number;
  /** Coordinate buffer precision: 'f32' (default) or 'i16' (50% RAM reduction). */
  precision?: 'f32' | 'i16';
  onPointClick?: (point: PointItem, index: number) => void;
}

/**
 * Thin React wrapper around core/pointLayer for high-density Canvas point rendering
 * with WASM batch projection and nearest-point hit-testing.
 */
export const PointLayer: React.FC<PointLayerProps> = memo(
  ({
    points,
    zIndex = 300,
    hitRadiusPx = 18,
    marginPx = 30,
    precision = 'f32',
    onPointClick,
  }) => {
    const { camera, getContainer, subscribeClick } = useMap();
    const outXYRef = useRef<Float32Array>(new Float32Array(0));
    const outIdxRef = useRef<Int32Array>(new Int32Array(0));
    const wasmReady = useWasmReady();

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
      return subscribeClick((x, y) => {
        const rt = getWasmRuntime();
        const sh = spatial.staticHandle;
        const idx =
          rt !== null && sh && sh.epoch === rt.arenaEpoch
            ? hitTestStaticPoints(x, y, sh, camera, hitRadiusPx)
            : spatial.latsI16 && spatial.lonsI16
              ? hitTestPointsI16(
                  x,
                  y,
                  spatial.latsI16,
                  spatial.lonsI16,
                  spatial.count,
                  camera,
                  hitRadiusPx
                )
              : hitTestPoints(x, y, spatial, camera, hitRadiusPx);
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
        if (!wasmReady || spatial.count === 0) return;
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
      [wasmReady, points, spatial, marginPx]
    );

    return <CanvasLayer zIndex={zIndex} onDraw={onDraw} />;
  }
);
PointLayer.displayName = 'PointLayer';

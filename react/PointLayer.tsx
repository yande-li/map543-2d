import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type Camera, type ViewportState } from '../core/camera';
import { findNearestPointFast } from '../core/hitTest';
import {
  type PointItem,
  attachPointHoverCursor,
  buildPointSpatialBuffers,
  drawBatchPoints,
} from '../core/pointLayer';
import { initWasm, isWasmReady } from '../wasm/wasmBridge';
import { CanvasLayer } from './CanvasLayer';
import { useMap } from './MapContext';

export type { PointItem };

export interface PointLayerProps {
  points: PointItem[];
  zIndex?: number;
  hitRadiusPx?: number;
  marginPx?: number;
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
    onPointClick,
  }) => {
    const { camera, getContainer, subscribeClick } = useMap();
    const outXYRef = useRef<Float32Array>(new Float32Array(0));
    const outIdxRef = useRef<Int32Array>(new Int32Array(0));
    const [wasmReady, setWasmReady] = useState(() => isWasmReady());

    useEffect(() => {
      let active = true;
      if (!isWasmReady()) {
        void initWasm().then((ok) => {
          if (active && ok) setWasmReady(true);
        });
      }
      return () => {
        active = false;
      };
    }, []);

    const spatial = useMemo(() => buildPointSpatialBuffers(points), [points]);

    useEffect(() => {
      if (!onPointClick || points.length === 0) return;
      return subscribeClick((x, y) => {
        const idx = findNearestPointFast(x, y, spatial, camera, hitRadiusPx);
        if (idx >= 0) {
          onPointClick(points[idx], idx);
        }
      });
    }, [points, spatial, camera, subscribeClick, hitRadiusPx, onPointClick]);

    useEffect(() => {
      if (!onPointClick) return;
      return attachPointHoverCursor(
        getContainer(),
        camera,
        spatial,
        hitRadiusPx
      );
    }, [getContainer, camera, spatial, hitRadiusPx, onPointClick]);

    const onDraw = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        _state: ViewportState,
        cam: Camera
      ) => {
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

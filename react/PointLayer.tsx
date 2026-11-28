import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { MAP_Z_INDEX } from '../core/controls';
import { type Viewport, type ViewportState } from '../core/viewport';
import { type CoordPrecision } from '../core/batch';
import {
  type PointItem,
  type PointLayerHandle,
  attachPointInteractions,
  createPointLayerHandle,
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
  /** Default stroke color for symbols without per-point `strokeColor`. */
  strokeColor?: string;
  /** Default stroke width in CSS pixels (default: 1 when strokeColor is set). */
  strokeWidth?: number;
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
export const PointLayer = memo(
  forwardRef<PointLayerHandle, PointLayerProps>(
    (
      {
        points,
        zIndex = MAP_Z_INDEX.point,
        hitRadiusPx = 18,
        marginPx = 30,
        strokeColor,
        strokeWidth,
        precision = 32,
        className,
        onPointClick,
        onPointHover,
      },
      ref
    ) => {
      const { viewport, getContainer, subscribeClick } = useMap();
      const onPointClickRef = useRef(onPointClick);
      const onPointHoverRef = useRef(onPointHover);
      onPointClickRef.current = onPointClick;
      onPointHoverRef.current = onPointHover;

      const spatial = useMemo(
        () => packPoints(points, precision),
        [points, precision]
      );

      useImperativeHandle(
        ref,
        () => createPointLayerHandle(points, spatial, viewport, hitRadiusPx),
        [points, spatial, viewport, hitRadiusPx]
      );

      const hasClick = Boolean(onPointClick);
      const hasHover = Boolean(onPointHover);

      useEffect(() => {
        if (!hasClick && !hasHover) return;
        return attachPointInteractions({
          container: getContainer(),
          viewport,
          points,
          spatial,
          hitRadiusPx,
          subscribeClick,
          ...(hasClick
            ? {
                onPointClick: (pt, idx) => onPointClickRef.current?.(pt, idx),
              }
            : {}),
          ...(hasHover
            ? {
                onPointHover: (pt, idx) => onPointHoverRef.current?.(pt, idx),
              }
            : {}),
        });
      }, [
        getContainer,
        viewport,
        spatial,
        hitRadiusPx,
        subscribeClick,
        hasClick,
        hasHover,
        points,
      ]);

      const drawOpts = useMemo(
        () => ({
          margin: marginPx,
          ...(strokeColor !== undefined ? { strokeColor } : {}),
          ...(strokeWidth !== undefined ? { strokeWidth } : {}),
        }),
        [marginPx, strokeColor, strokeWidth]
      );

      const onDraw = useCallback(
        (
          ctx: CanvasRenderingContext2D,
          _state: ViewportState,
          cam: Viewport
        ) => {
          if (spatial.count === 0) return;
          drawBatchPoints(ctx, cam, points, spatial, drawOpts);
        },
        [points, spatial, drawOpts]
      );

      return (
        <CanvasLayer
          zIndex={zIndex}
          {...(className ? { className } : {})}
          onDraw={onDraw}
        />
      );
    }
  )
);
PointLayer.displayName = 'PointLayer';

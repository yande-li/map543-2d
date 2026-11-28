import React, { memo, useCallback, useMemo, useRef } from 'react';
import { MAP_Z_INDEX } from '../core/controls';
import { type CoordPrecision } from '../core/batch';
import {
  type HeatmapBuffers,
  type HeatmapColorStop,
  type HeatmapIntensityMode,
  type HeatmapKernelType,
  type HeatmapMaxIntensity,
  type HeatmapPoint,
  type HeatmapScratch,
  buildHeatmapPalette,
  drawHeatmap,
  packHeatmapPoints,
} from '../core/heatmapLayer';
import { type Viewport, type ViewportState } from '../core/viewport';
import { CanvasLayer } from './CanvasLayer';

export interface HeatmapLayerProps {
  points?: readonly HeatmapPoint[];
  buffers?: HeatmapBuffers;
  timeRange?: readonly [number, number];
  radiusPx?: number;
  gridScale?: number;
  maxIntensity?: HeatmapMaxIntensity;
  intensityMode?: HeatmapIntensityMode;
  kernel?: HeatmapKernelType;
  opacity?: number;
  colorStops?: readonly HeatmapColorStop[];
  precision?: CoordPrecision;
  zIndex?: number;
  className?: string;
}

const EMPTY_POINTS: readonly HeatmapPoint[] = [];

/**
 * React wrapper around core/heatmapLayer for WASM-accelerated pixel-matrix heatmaps.
 */
export const HeatmapLayer: React.FC<HeatmapLayerProps> = memo(
  ({
    points = EMPTY_POINTS,
    buffers: externalBuffers,
    timeRange,
    radiusPx = 24,
    gridScale = 0.25,
    maxIntensity = 'global',
    intensityMode = 'sqrt',
    kernel = 'gaussian',
    opacity = 0.85,
    colorStops,
    precision = 32,
    zIndex = MAP_Z_INDEX.heatmap,
    className,
  }) => {
    const scratchRef = useRef<HeatmapScratch>({});
    const buffers = useMemo(
      () => externalBuffers ?? packHeatmapPoints(points, precision),
      [externalBuffers, points, precision]
    );
    const palette = useMemo(
      () => (colorStops ? buildHeatmapPalette(colorStops) : undefined),
      [colorStops]
    );

    const drawOpts = useMemo(
      () => ({
        radiusPx,
        gridScale,
        maxIntensity,
        intensityMode,
        kernel,
        opacity,
        ...(timeRange ? { timeRange } : {}),
        ...(palette ? { palette } : {}),
      }),
      [
        radiusPx,
        gridScale,
        maxIntensity,
        intensityMode,
        kernel,
        opacity,
        timeRange,
        palette,
      ]
    );

    const onDraw = useCallback(
      (ctx: CanvasRenderingContext2D, _state: ViewportState, cam: Viewport) => {
        drawHeatmap(ctx, buffers, cam, drawOpts, scratchRef.current);
      },
      [buffers, drawOpts]
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
HeatmapLayer.displayName = 'HeatmapLayer';

import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { type ViewportState } from '../core/camera';
import {
  type StyledVectorLayer,
  type VectorScratchBuffers,
  drawVectorLayers,
  uploadVectorLayers,
} from '../core/vectorLayer';
import { type PreparedFeature } from '../formats/types';
import { type StaticGeometryHandle } from '../core/batch';
import { CanvasLayer } from './CanvasLayer';
import { useMap } from './MapContext';

export interface VectorLayerProps {
  fillLayers: StyledVectorLayer[];
  strokeLayers: StyledVectorLayer[];
  smoothFactor?: number;
  lowPower?: boolean;
  zIndex?: number;
  skipOnInteractLayers?: ReadonlySet<string>;
  /** Reset the shared WASM static arena before uploading new layers (default: false). */
  resetOnUpload?: boolean;
  /** WASM arena coordinate precision: 'f32' (default) or 'u16' (50% arena RAM reduction). */
  precision?: 'f32' | 'u16';
  /** Max DPR during active pan/zoom interaction (default: 0.45 to reduce Canvas2D CPU/RAM). */
  interactionMaxDpr?: number;
}

/**
 * Thin React wrapper around core/vectorLayer for WASM-accelerated Geobuf
 * fill and stroke background rendering.
 */
export const VectorLayer: React.FC<VectorLayerProps> = memo(
  ({
    fillLayers,
    strokeLayers,
    smoothFactor = 1.0,
    lowPower = false,
    zIndex = 100,
    skipOnInteractLayers,
    resetOnUpload = false,
    precision = 'f32',
    interactionMaxDpr = 0.45,
  }) => {
    const { camera } = useMap();
    const scratchRef = useRef<VectorScratchBuffers>({
      xy: new Float32Array(0),
      lens: new Int32Array(0),
    });
    const handlesRef = useRef<WeakMap<PreparedFeature, StaticGeometryHandle>>(
      new WeakMap()
    );

    useEffect(() => {
      return () => {
        scratchRef.current = {
          xy: new Float32Array(0),
          lens: new Int32Array(0),
        };
        handlesRef.current = new WeakMap();
      };
    }, []);

    useEffect(() => {
      handlesRef.current = uploadVectorLayers(fillLayers, strokeLayers, {
        reset: resetOnUpload,
        precision,
      });
    }, [fillLayers, strokeLayers, resetOnUpload, precision]);

    const maxDpr = useMemo(() => {
      if (lowPower) return 1;
      const sf = Math.max(0, smoothFactor ?? 1.0);
      if (sf >= 1.8) return 1;
      if (sf <= 0.6) return 2;
      return 1.5;
    }, [lowPower, smoothFactor]);

    const onDraw = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        state: ViewportState,
        _camera: unknown,
        isInteracting = false
      ) => {
        drawVectorLayers(
          ctx,
          state,
          fillLayers,
          strokeLayers,
          handlesRef.current,
          scratchRef.current,
          {
            smoothFactor,
            isInteracting,
            projection: camera.getProjection(),
            ...(skipOnInteractLayers ? { skipOnInteractLayers } : {}),
          }
        );
      },
      [fillLayers, strokeLayers, smoothFactor, skipOnInteractLayers, camera]
    );

    return (
      <CanvasLayer
        zIndex={zIndex}
        maxDpr={maxDpr}
        interactionMaxDpr={Math.min(maxDpr, interactionMaxDpr)}
        onDraw={onDraw}
      />
    );
  }
);
VectorLayer.displayName = 'VectorLayer';

import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { type ViewportState } from '../core/camera';
import {
  type StyledVectorLayer,
  type VectorLayerStyle,
  type VectorScratchBuffers,
  drawVectorLayers,
  uploadVectorLayers,
} from '../core/vectorLayer';
import { type PreparedFeature } from '../formats/types';
import { type CoordPrecision, type StaticGeometryHandle } from '../core/batch';
import { CanvasLayer } from './CanvasLayer';
import { useMap } from './MapContext';

const EMPTY_LAYERS: readonly StyledVectorLayer[] = [];

export interface VectorLayerProps {
  fillLayers: readonly StyledVectorLayer[];
  strokeLayers?: readonly StyledVectorLayer[];
  /** Optional layer name -> style map when passing PreparedLayer[] directly from parseGeobuf. */
  styles?: Readonly<Record<string, VectorLayerStyle>>;
  smoothFactor?: number;
  lowPower?: boolean;
  zIndex?: number;
  skipOnInteractLayers?: ReadonlySet<string>;
  /** Reset the shared WASM static arena before uploading new layers (default: false). */
  resetOnUpload?: boolean;
  /** Arena coordinate precision in bits: 32 (default) or 16. */
  precision?: CoordPrecision;
  /** Max DPR during active pan/zoom interaction (default: 0.45). */
  interactionMaxDpr?: number;
}

/**
 * React wrapper around core/vectorLayer for WASM-accelerated Geobuf fill and stroke rendering.
 */
export const VectorLayer: React.FC<VectorLayerProps> = memo(
  ({
    fillLayers,
    strokeLayers = EMPTY_LAYERS,
    styles,
    smoothFactor = 1.0,
    lowPower = false,
    zIndex = 100,
    skipOnInteractLayers,
    resetOnUpload = false,
    precision = 32,
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
            ...(styles ? { styles } : {}),
            ...(skipOnInteractLayers ? { skipOnInteractLayers } : {}),
          }
        );
      },
      [
        fillLayers,
        strokeLayers,
        styles,
        smoothFactor,
        skipOnInteractLayers,
        camera,
      ]
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

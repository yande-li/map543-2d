import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { type ViewportState } from '../core/viewport';
import { toMapError, type MapError } from '../core/errors';
import {
  type VectorLayerStyle,
  computeVectorMaxDpr,
  drawVectorLayers,
  uploadVectorLayers,
} from '../core/vectorLayer';
import { parseGeobufInput, type ParsedGeobuf } from '../formats/geobuf';
import { type PreparedFeature, type PreparedLayer } from '../formats/types';
import { type CoordPrecision, type StaticGeometryHandle } from '../core/batch';
import { CanvasLayer } from './CanvasLayer';
import { useMap } from './MapContext';
import { useGeobuf } from './useGeobuf';

const EMPTY_LAYERS: readonly PreparedLayer[] = [];

export interface VectorLayerProps {
  /** Geobuf URL to fetch and parse automatically (no manual useEffect required). */
  src?: string;
  /** Pre-fetched Geobuf binary buffer or parsed { fillLayers, strokeLayers } object. */
  data?: ArrayBuffer | Uint8Array | ParsedGeobuf;
  fillLayers?: readonly PreparedLayer[];
  strokeLayers?: readonly PreparedLayer[];
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
  className?: string;
  onLoad?: (layers: ParsedGeobuf) => void;
  onError?: (error: MapError) => void;
}

function resolveGeobufData(
  data: ArrayBuffer | Uint8Array | ParsedGeobuf | undefined
): { parsed: ParsedGeobuf | null; error: MapError | null } {
  if (!data) return { parsed: null, error: null };
  try {
    return { parsed: parseGeobufInput(data), error: null };
  } catch (err) {
    return { parsed: null, error: toMapError(err, 'GEOBUF_DECODE_ERROR') };
  }
}

/**
 * React wrapper around core/vectorLayer for WASM-accelerated Geobuf fill and stroke rendering.
 */
export const VectorLayer: React.FC<VectorLayerProps> = memo(
  ({
    src,
    data,
    fillLayers,
    strokeLayers,
    styles,
    smoothFactor = 1.0,
    lowPower = false,
    zIndex = 100,
    skipOnInteractLayers,
    resetOnUpload = false,
    precision = 32,
    interactionMaxDpr = 0.45,
    className,
    onLoad,
    onError,
  }) => {
    const { viewport } = useMap();
    const shouldFetch = !fillLayers && !data ? src : null;
    const fetched = useGeobuf(shouldFetch);
    const dataResult = useMemo(() => resolveGeobufData(data), [data]);

    const onLoadRef = useRef(onLoad);
    const onErrorRef = useRef(onError);
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;

    useEffect(() => {
      if (fetched.data) {
        onLoadRef.current?.(fetched.data);
      }
    }, [fetched.data]);

    useEffect(() => {
      const err = fetched.error ?? dataResult.error;
      if (err) {
        onErrorRef.current?.(err);
      }
    }, [fetched.error, dataResult.error]);

    const resolvedFillLayers =
      fillLayers ??
      dataResult.parsed?.fillLayers ??
      fetched.data?.fillLayers ??
      EMPTY_LAYERS;
    const resolvedStrokeLayers =
      strokeLayers ??
      dataResult.parsed?.strokeLayers ??
      fetched.data?.strokeLayers ??
      EMPTY_LAYERS;

    const handlesRef = useRef<WeakMap<PreparedFeature, StaticGeometryHandle>>(
      new WeakMap()
    );

    useEffect(() => {
      return () => {
        handlesRef.current = new WeakMap();
      };
    }, []);

    useEffect(() => {
      handlesRef.current = uploadVectorLayers(
        resolvedFillLayers,
        resolvedStrokeLayers,
        {
          reset: resetOnUpload,
          precision,
        }
      );
    }, [resolvedFillLayers, resolvedStrokeLayers, resetOnUpload, precision]);

    const maxDpr = useMemo(
      () => computeVectorMaxDpr(lowPower, smoothFactor),
      [lowPower, smoothFactor]
    );

    const onDraw = useCallback(
      (
        ctx: CanvasRenderingContext2D,
        state: ViewportState,
        _viewport: unknown,
        isInteracting = false
      ) => {
        drawVectorLayers(
          ctx,
          state,
          resolvedFillLayers,
          resolvedStrokeLayers,
          handlesRef.current,
          {
            smoothFactor,
            isInteracting,
            projection: viewport.getProjection(),
            ...(styles ? { styles } : {}),
            ...(skipOnInteractLayers ? { skipOnInteractLayers } : {}),
          }
        );
      },
      [
        resolvedFillLayers,
        resolvedStrokeLayers,
        styles,
        smoothFactor,
        skipOnInteractLayers,
        viewport,
      ]
    );

    return (
      <CanvasLayer
        zIndex={zIndex}
        maxDpr={maxDpr}
        interactionMaxDpr={Math.min(maxDpr, interactionMaxDpr)}
        {...(className ? { className } : {})}
        onDraw={onDraw}
      />
    );
  }
);
VectorLayer.displayName = 'VectorLayer';

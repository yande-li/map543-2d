import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type ViewportState } from '../core/camera';
import {
  type StyledVectorLayer,
  type VectorScratchBuffers,
  drawVectorLayers,
  uploadVectorLayers,
} from '../core/vectorLayer';
import { type PreparedFeature } from '../formats/fgb';
import { type StaticGeometryHandle } from '../core/batch';
import { initWasm, isWasmReady } from '../wasm/wasmBridge';
import { CanvasLayer } from './CanvasLayer';

export interface VectorLayerProps {
  fillLayers: StyledVectorLayer[];
  strokeLayers: StyledVectorLayer[];
  smoothFactor?: number;
  lowPower?: boolean;
  zIndex?: number;
  skipOnInteractLayers?: ReadonlySet<string>;
}

/**
 * Thin React wrapper around core/vectorLayer for WASM-accelerated FGB/Geobuf
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
  }) => {
    const scratchRef = useRef<VectorScratchBuffers>({
      xy: new Float32Array(0),
      lens: new Int32Array(0),
    });
    const handlesRef = useRef<WeakMap<PreparedFeature, StaticGeometryHandle>>(
      new WeakMap()
    );
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
        scratchRef.current = {
          xy: new Float32Array(0),
          lens: new Int32Array(0),
        };
        handlesRef.current = new WeakMap();
      };
    }, []);

    useEffect(() => {
      if (!wasmReady) return;
      handlesRef.current = uploadVectorLayers(fillLayers, strokeLayers);
    }, [wasmReady, fillLayers, strokeLayers]);

    const maxDpr = useMemo(() => {
      if (lowPower) return 1;
      const sf = smoothFactor || 1.0;
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
        if (!wasmReady) return;
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
            ...(skipOnInteractLayers ? { skipOnInteractLayers } : {}),
          }
        );
      },
      [wasmReady, fillLayers, strokeLayers, smoothFactor, skipOnInteractLayers]
    );

    return (
      <CanvasLayer
        zIndex={zIndex}
        maxDpr={maxDpr}
        interactionMaxDpr={Math.min(maxDpr, 0.45)}
        onDraw={onDraw}
      />
    );
  }
);
VectorLayer.displayName = 'VectorLayer';

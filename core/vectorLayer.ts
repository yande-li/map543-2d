import { type ViewportState } from './camera';
import {
  type Projection,
  MERCATOR_PROJECTION,
  getWrappedSlices,
} from './projection';
import { type StaticGeometryHandle, uploadStaticRings } from './batch';
import {
  getPixelStep,
  shouldCullFeature,
  shouldSkipLayer,
  drawDecimatedRings,
  drawStaticDirect,
} from './vectorLod';
import { type PreparedFeature } from '../formats/types';
import { resetWasmArena } from '../wasm/bridge';

export interface VectorLayerStyle {
  color?: string;
  weight?: number;
  opacity?: number;
  fillColor?: string;
  fillOpacity?: number;
  dashArray?: string;
  stroke?: boolean;
}

export interface StyledVectorLayer {
  name: string;
  style: VectorLayerStyle;
  features: PreparedFeature[];
}

export interface VectorScratchBuffers {
  xy: Float32Array;
  lens: Int32Array;
}

export interface DrawVectorOptions {
  smoothFactor?: number;
  isInteracting?: boolean;
  skipOnInteractLayers?: ReadonlySet<string>;
  minInteractFeaturePx?: number;
  minPixelStep?: number;
  projection?: Projection;
}

const EMPTY_LAYER_SET = new Set<string>();

export interface UploadVectorOptions {
  /** Reset the shared WASM arena before uploading (default: false to avoid invalidating other maps). */
  reset?: boolean;
}

/**
 * Uploads all fill/stroke features into the WASM static geometry arena.
 */
export function uploadVectorLayers(
  fillLayers: readonly StyledVectorLayer[],
  strokeLayers: readonly StyledVectorLayer[],
  options: UploadVectorOptions = {}
): WeakMap<PreparedFeature, StaticGeometryHandle> {
  if (options.reset) {
    resetWasmArena();
  }
  const handles = new WeakMap<PreparedFeature, StaticGeometryHandle>();
  const upload = (layers: readonly StyledVectorLayer[]) => {
    for (const layer of layers) {
      for (const f of layer.features) {
        if (handles.has(f)) continue;
        const handle = uploadStaticRings(
          f.packedXY,
          f.ringLengths,
          f.ringCount
        );
        if (handle) {
          handles.set(f, handle);
        }
      }
    }
  };
  upload(fillLayers);
  upload(strokeLayers);
  return handles;
}

/**
 * Renders fill and stroke vector layers across wrapped viewport slices using
 * WASM static ring handles when available and decimated fallback otherwise.
 */
export function drawVectorLayers(
  ctx: CanvasRenderingContext2D,
  state: ViewportState,
  fillLayers: readonly StyledVectorLayer[],
  strokeLayers: readonly StyledVectorLayer[],
  handles: WeakMap<PreparedFeature, StaticGeometryHandle>,
  scratch: VectorScratchBuffers,
  options: DrawVectorOptions = {}
): void {
  if (fillLayers.length === 0 && strokeLayers.length === 0) return;

  const {
    smoothFactor = 1.0,
    isInteracting = false,
    skipOnInteractLayers = EMPTY_LAYER_SET,
    minInteractFeaturePx = 6,
    minPixelStep = 0.75,
    projection = MERCATOR_PROJECTION,
  } = options;

  const { scale, offsetY, viewLatMin, viewLatMax, slices } = getWrappedSlices(
    state,
    2,
    projection
  );

  const sf = Math.max(0, smoothFactor ?? 1.0);
  const basePixelStep =
    sf <= 0.6 ? 0.5 : Math.max(minPixelStep, Math.pow(sf, 2.2));
  const effectivePixelStep = getPixelStep(isInteracting, basePixelStep, 6.0);
  const pxPerDeg = scale / 360;

  const traceFeature = (
    f: PreparedFeature,
    drawOffsetX: number,
    closePath: boolean
  ) => {
    const handle = handles.get(f);
    if (
      handle &&
      drawStaticDirect(
        ctx,
        handle,
        scale,
        drawOffsetX,
        offsetY,
        effectivePixelStep,
        closePath
      )
    ) {
      return;
    }
    if (scratch.xy.length < f.packedXY.length) {
      scratch.xy = new Float32Array(f.packedXY.length);
    }
    if (scratch.lens.length < f.ringCount) {
      scratch.lens = new Int32Array(f.ringCount);
    }
    drawDecimatedRings(
      ctx,
      f.packedXY,
      f.ringLengths,
      f.ringCount,
      scale,
      drawOffsetX,
      offsetY,
      effectivePixelStep,
      closePath,
      scratch.xy,
      scratch.lens
    );
  };

  const isFeatureVisible = (
    f: PreparedFeature,
    adjLonMin: number,
    adjLonMax: number
  ): boolean => {
    if (
      f.maxLon < adjLonMin ||
      f.minLon > adjLonMax ||
      f.maxLat < viewLatMin ||
      f.minLat > viewLatMax
    ) {
      return false;
    }
    return !shouldCullFeature(
      f.minLon,
      f.maxLon,
      f.minLat,
      f.maxLat,
      pxPerDeg,
      isInteracting,
      minInteractFeaturePx
    );
  };

  const drawFillLayer = (
    layer: StyledVectorLayer,
    drawOffsetX: number,
    adjLonMin: number,
    adjLonMax: number
  ) => {
    const s = layer.style;
    const fillColor = s.fillColor ?? s.color;
    if (!fillColor) return;

    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = s.fillOpacity ?? 0.2;
    ctx.beginPath();
    for (const f of layer.features) {
      if (!f.isPolygon || !isFeatureVisible(f, adjLonMin, adjLonMax)) {
        continue;
      }
      traceFeature(f, drawOffsetX, true);
    }
    ctx.fill('evenodd');
    ctx.restore();
  };

  const drawStrokeLayer = (
    layer: StyledVectorLayer,
    drawOffsetX: number,
    adjLonMin: number,
    adjLonMax: number
  ) => {
    const s = layer.style;
    const weight = s.weight ?? 1;
    if (weight <= 0 || s.stroke === false) return;

    ctx.save();
    ctx.strokeStyle = s.color ?? '#888';
    ctx.lineWidth = weight;
    ctx.globalAlpha = s.opacity ?? 1;
    if (!isInteracting && s.dashArray) {
      const dashes = s.dashArray
        .split(/[,\s]+/)
        .map(Number)
        .filter((v) => Number.isFinite(v) && v > 0);
      if (dashes.length > 0) ctx.setLineDash(dashes);
    }
    ctx.beginPath();
    for (const f of layer.features) {
      if (!isFeatureVisible(f, adjLonMin, adjLonMax)) {
        continue;
      }
      traceFeature(f, drawOffsetX, f.isPolygon);
    }
    ctx.stroke();
    ctx.restore();
  };

  for (const { drawOffsetX, adjLonMin, adjLonMax } of slices) {
    for (const layer of fillLayers) {
      if (!shouldSkipLayer(layer.name, isInteracting, skipOnInteractLayers)) {
        drawFillLayer(layer, drawOffsetX, adjLonMin, adjLonMax);
      }
    }
    for (const layer of strokeLayers) {
      if (!shouldSkipLayer(layer.name, isInteracting, skipOnInteractLayers)) {
        drawStrokeLayer(layer, drawOffsetX, adjLonMin, adjLonMax);
      }
    }
  }
}

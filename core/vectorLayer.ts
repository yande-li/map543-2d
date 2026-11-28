import { type ViewportState } from './viewport';
import {
  type Projection,
  MERCATOR_PROJECTION,
  getWrappedSlices,
} from './projection';
import {
  type CoordPrecision,
  type StaticGeometryHandle,
  encodeRings16,
  uploadStaticRings,
} from './batch';
import {
  getPixelStep,
  shouldCullFeature,
  shouldSkipLayer,
  simplifyRings,
} from './vectorLod';
import {
  type PreparedFeature,
  type PreparedLayer,
  type VectorLayerStyle,
} from '../formats/types';
import { getWasmRuntime, resetWasmArena } from '../wasm/bridge';

export type { VectorLayerStyle };

export interface DrawVectorOptions {
  smoothFactor?: number;
  isInteracting?: boolean;
  skipOnInteractLayers?: ReadonlySet<string>;
  minInteractFeaturePx?: number;
  minPixelStep?: number;
  projection?: Projection;
  styles?: Readonly<Record<string, VectorLayerStyle>>;
}

const EMPTY_LAYER_SET = new Set<string>();
const DEFAULT_VECTOR_STYLE: VectorLayerStyle = {
  color: '#64748b',
  fillColor: '#334155',
  fillOpacity: 0.25,
  weight: 1,
  opacity: 0.8,
};
const dashArrayCache = new WeakMap<VectorLayerStyle, number[]>();

export function computeVectorMaxDpr(smoothFactor = 1.0): number {
  const sf = Math.max(0, smoothFactor);
  if (sf >= 1.8) return 1;
  if (sf <= 0.6) return 2;
  return 1.5;
}

export interface UploadVectorOptions {
  /** Reset the shared WASM arena before uploading (default: false). */
  reset?: boolean;
  /** Arena coordinate precision in bits: 32 (default) or 16. */
  precision?: CoordPrecision;
}

/**
 * Uploads all fill/stroke features into the WASM static geometry arena.
 */
export function uploadVectorLayers(
  fillLayers: readonly PreparedLayer[],
  strokeLayers: readonly PreparedLayer[] = [],
  options: UploadVectorOptions = {}
): WeakMap<PreparedFeature, StaticGeometryHandle> {
  if (options.reset) {
    resetWasmArena();
  }
  const use16 = options.precision === 16;
  const uploadAll = (): {
    handles: WeakMap<PreparedFeature, StaticGeometryHandle>;
    exhausted: boolean;
  } => {
    const handles = new WeakMap<PreparedFeature, StaticGeometryHandle>();
    let exhausted = false;
    const upload = (layers: readonly PreparedLayer[]) => {
      for (const layer of layers) {
        for (const f of layer.features) {
          if (handles.has(f)) continue;
          const handle = uploadStaticRings(
            use16 ? encodeRings16(f.packedXY) : f.packedXY,
            f.ringLengths,
            f.ringCount
          );
          if (handle) {
            handles.set(f, handle);
          } else {
            exhausted = true;
          }
        }
      }
    };
    upload(fillLayers);
    upload(strokeLayers);
    return { handles, exhausted };
  };

  const first = uploadAll();
  if (first.exhausted && !options.reset) {
    resetWasmArena();
    return uploadAll().handles;
  }
  return first.handles;
}

interface DrawFrameContext {
  ctx: CanvasRenderingContext2D;
  rt: ReturnType<typeof getWasmRuntime>;
  scratchBase: number;
  handles: WeakMap<PreparedFeature, StaticGeometryHandle>;
  scale: number;
  offsetY: number;
  viewLatMin: number;
  viewLatMax: number;
  pxPerDeg: number;
  effectivePixelStep: number;
  isInteracting: boolean;
  minInteractFeaturePx: number;
  styles: Readonly<Record<string, VectorLayerStyle>> | undefined;
}

function resolveLayerStyle(
  layer: PreparedLayer,
  styles: Readonly<Record<string, VectorLayerStyle>> | undefined
): VectorLayerStyle {
  return layer.style ?? styles?.[layer.name] ?? DEFAULT_VECTOR_STYLE;
}

function isFeatureVisibleInFrame(
  f: PreparedFeature,
  fc: DrawFrameContext,
  adjLonMin: number,
  adjLonMax: number
): boolean {
  if (
    f.maxLon < adjLonMin ||
    f.minLon > adjLonMax ||
    f.maxLat < fc.viewLatMin ||
    f.minLat > fc.viewLatMax
  ) {
    return false;
  }
  return !shouldCullFeature(
    f.minLon,
    f.maxLon,
    f.minLat,
    f.maxLat,
    fc.pxPerDeg,
    fc.isInteracting,
    fc.minInteractFeaturePx
  );
}

function traceFeatureInFrame(
  f: PreparedFeature,
  fc: DrawFrameContext,
  drawOffsetX: number,
  closePath: boolean
): void {
  if (fc.rt === null) return;
  const handle = fc.handles.get(f);
  if (!handle) return;
  simplifyRings(
    fc.ctx,
    fc.rt,
    fc.scratchBase,
    handle,
    fc.scale,
    drawOffsetX,
    fc.offsetY,
    fc.effectivePixelStep,
    closePath
  );
}

function drawFillLayerInFrame(
  layer: PreparedLayer,
  fc: DrawFrameContext,
  drawOffsetX: number,
  adjLonMin: number,
  adjLonMax: number
): void {
  const s = resolveLayerStyle(layer, fc.styles);
  const fillColor = s.fillColor ?? s.color;
  if (!fillColor) return;

  const { ctx } = fc;
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.globalAlpha = s.fillOpacity ?? 0.2;
  ctx.beginPath();
  for (const f of layer.features) {
    if (!f.isPolygon || !isFeatureVisibleInFrame(f, fc, adjLonMin, adjLonMax)) {
      continue;
    }
    traceFeatureInFrame(f, fc, drawOffsetX, true);
  }
  ctx.fill('evenodd');
  ctx.restore();
}

function drawStrokeLayerInFrame(
  layer: PreparedLayer,
  fc: DrawFrameContext,
  drawOffsetX: number,
  adjLonMin: number,
  adjLonMax: number
): void {
  const s = resolveLayerStyle(layer, fc.styles);
  const weight = s.weight ?? 1;
  if (weight <= 0 || s.stroke === false) return;

  const { ctx } = fc;
  ctx.save();
  ctx.strokeStyle = s.color ?? '#888';
  ctx.lineWidth = weight;
  ctx.globalAlpha = s.opacity ?? 1;
  if (!fc.isInteracting && s.dashArray) {
    let dashes = dashArrayCache.get(s);
    if (dashes === undefined) {
      dashes = s.dashArray
        .split(/[,\s]+/)
        .map(Number)
        .filter((v) => Number.isFinite(v) && v > 0);
      dashArrayCache.set(s, dashes);
    }
    if (dashes.length > 0) ctx.setLineDash(dashes);
  }
  ctx.beginPath();
  for (const f of layer.features) {
    if (!isFeatureVisibleInFrame(f, fc, adjLonMin, adjLonMax)) {
      continue;
    }
    traceFeatureInFrame(f, fc, drawOffsetX, f.isPolygon);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Renders fill and stroke vector layers across wrapped viewport slices.
 */
export function drawVectorLayers(
  ctx: CanvasRenderingContext2D,
  state: ViewportState,
  fillLayers: readonly PreparedLayer[],
  strokeLayers: readonly PreparedLayer[],
  handles: WeakMap<PreparedFeature, StaticGeometryHandle>,
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
    styles,
  } = options;

  const { scale, offsetY, viewLatMin, viewLatMax, slices } = getWrappedSlices(
    state,
    2,
    projection
  );

  const sf = Math.max(0, smoothFactor);
  const basePixelStep =
    sf <= 0.6 ? 0.5 : Math.max(minPixelStep, Math.pow(sf, 2.2));
  const effectivePixelStep = getPixelStep(isInteracting, basePixelStep, 6.0);
  const rt = getWasmRuntime();
  const scratchBase = rt !== null ? rt.getScratchBase() : 0;

  const fc: DrawFrameContext = {
    ctx,
    rt,
    scratchBase,
    handles,
    scale,
    offsetY,
    viewLatMin,
    viewLatMax,
    pxPerDeg: scale / 360,
    effectivePixelStep,
    isInteracting,
    minInteractFeaturePx,
    styles,
  };

  for (const { drawOffsetX, adjLonMin, adjLonMax } of slices) {
    for (const layer of fillLayers) {
      if (!shouldSkipLayer(layer.name, isInteracting, skipOnInteractLayers)) {
        drawFillLayerInFrame(layer, fc, drawOffsetX, adjLonMin, adjLonMax);
      }
    }
    for (const layer of strokeLayers) {
      if (!shouldSkipLayer(layer.name, isInteracting, skipOnInteractLayers)) {
        drawStrokeLayerInFrame(layer, fc, drawOffsetX, adjLonMin, adjLonMax);
      }
    }
  }
}

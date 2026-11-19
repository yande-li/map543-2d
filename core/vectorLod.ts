import {
  decimatePackedRings,
  decimateStaticRings,
  StaticGeometryHandle,
} from './batch';
import { getWasmRuntime } from '../wasm/wasmBridge';

export type ZoomControlPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface VectorLodOptions {
  /** Base screen-space decimation step in CSS pixels (default: 0.75). */
  basePixelStep?: number;
  /** Screen-space decimation step during active interaction in CSS pixels (default: 6). */
  interactionPixelStep?: number;
  /** Minimum feature width/height in CSS pixels to render during interaction (default: 6). */
  minInteractionFeaturePx?: number;
  /** Layer names to skip entirely while interacting. */
  skipLayersOnInteract?: ReadonlySet<string>;
}

/**
 * Computes the effective decimation step in CSS pixels for the current frame.
 */
export function computeEffectivePixelStep(
  isInteracting: boolean,
  basePixelStep = 0.75,
  interactionPixelStep = 6
): number {
  if (!isInteracting) return basePixelStep;
  return Math.max(basePixelStep * interactionPixelStep, interactionPixelStep);
}

/**
 * Returns true if the given layer should be skipped during active interaction.
 */
export function shouldSkipLayer(
  layerName: string,
  isInteracting: boolean,
  skipLayersOnInteract?: ReadonlySet<string>
): boolean {
  return (
    isInteracting &&
    skipLayersOnInteract !== undefined &&
    skipLayersOnInteract.has(layerName)
  );
}

/**
 * Returns true if a feature's bounding box is smaller than minPx in both axes during interaction.
 */
export function shouldCullFeatureOnInteract(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  pxPerDeg: number,
  isInteracting: boolean,
  minPx = 6
): boolean {
  if (!isInteracting || minPx <= 0) return false;
  return (
    (maxLon - minLon) * pxPerDeg < minPx &&
    (maxLat - minLat) * pxPerDeg < minPx
  );
}

function traceCanvasRings(
  ctx: CanvasRenderingContext2D,
  xy: Float32Array,
  lens: Int32Array,
  ringCount: number,
  xyBaseIdx: number,
  lenBaseIdx: number,
  closePath: boolean
): void {
  let cursor = xyBaseIdx;
  for (let r = 0; r < ringCount; r++) {
    const len = lens[lenBaseIdx + r];
    if (len < 2) continue;
    ctx.moveTo(xy[cursor], xy[cursor + 1]);
    for (let i = 2; i < len; i += 2) {
      ctx.lineTo(xy[cursor + i], xy[cursor + i + 1]);
    }
    if (closePath) ctx.closePath();
    cursor += len;
  }
}

/**
 * Decimates packed WGS84 rings into screen-space coordinates and traces them onto a 2D canvas.
 */
export function traceDecimatedFeature(
  ctx: CanvasRenderingContext2D,
  packedXY: Float32Array,
  ringLengths: Int32Array,
  ringCount: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  pixelStep: number,
  closePath: boolean,
  scratchXY: Float32Array,
  scratchLens: Int32Array
): void {
  const outFloats = decimatePackedRings(
    packedXY,
    ringLengths,
    ringCount,
    scale,
    offsetX,
    offsetY,
    pixelStep,
    scratchXY,
    scratchLens
  );
  if (outFloats === 0) return;

  traceCanvasRings(ctx, scratchXY, scratchLens, ringCount, 0, 0, closePath);
}

/**
 * Decimates rings already resident in the WASM static arena and traces them onto a 2D canvas.
 * Returns true if traced via static handle, false if handle is missing/expired.
 */
export function traceDecimatedStaticFeature(
  ctx: CanvasRenderingContext2D,
  handle: StaticGeometryHandle,
  scale: number,
  offsetX: number,
  offsetY: number,
  pixelStep: number,
  closePath: boolean,
  scratchXY: Float32Array,
  scratchLens: Int32Array
): boolean {
  const outFloats = decimateStaticRings(
    handle,
    scale,
    offsetX,
    offsetY,
    pixelStep,
    scratchXY,
    scratchLens
  );
  if (outFloats === 0) return false;

  traceCanvasRings(
    ctx,
    scratchXY,
    scratchLens,
    handle.ringCount,
    0,
    0,
    closePath
  );
  return true;
}

/**
 * Zero-copy-out variant: decimates static arena rings and reads output directly from
 * WASM linear memory views (rt.f32 / rt.i32) with zero JS scratch allocation or TypedArray.set copies.
 */
export function traceStaticRingsDirect(
  ctx: CanvasRenderingContext2D,
  handle: StaticGeometryHandle,
  scale: number,
  offsetX: number,
  offsetY: number,
  pixelStep: number,
  closePath: boolean
): boolean {
  if (handle.ringCount <= 0) return false;
  const rt = getWasmRuntime();
  if (rt === null || handle.epoch !== rt.arenaEpoch) return false;

  const outXYOffset = rt.getScratchBase();
  const outLenOffset = outXYOffset + handle.totalInFloats * 4;
  const totalBytes = outLenOffset + handle.ringCount * 4;
  if (!rt.ensureCapacity(totalBytes)) return false;

  const outFloats = rt.exports.decimateRingsBatch(
    handle.ringCount,
    handle.xyOffset,
    handle.lenOffset,
    outXYOffset,
    outLenOffset,
    scale,
    offsetX,
    offsetY,
    pixelStep
  );
  if (outFloats === 0) return false;

  traceCanvasRings(
    ctx,
    rt.f32,
    rt.i32,
    handle.ringCount,
    outXYOffset >> 2,
    outLenOffset >> 2,
    closePath
  );
  return true;
}

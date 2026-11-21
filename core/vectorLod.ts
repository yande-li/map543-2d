import { decimatePackedRings, StaticGeometryHandle } from './batch';
import { getWasmRuntime } from '../wasm/bridge';

export type ZoomControlPosition =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Computes the effective decimation step in CSS pixels for the current frame.
 */
export function getPixelStep(
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
export function shouldCullFeature(
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
    (maxLon - minLon) * pxPerDeg < minPx && (maxLat - minLat) * pxPerDeg < minPx
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

export function drawDecimatedRings(
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
): boolean {
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
  if (outFloats === 0) return false;

  traceCanvasRings(ctx, scratchXY, scratchLens, ringCount, 0, 0, closePath);
  return true;
}

/**
 * Decimates and traces static arena rings using an existing WasmRuntime instance.
 */
export function drawStaticWithRuntime(
  ctx: CanvasRenderingContext2D,
  rt: NonNullable<ReturnType<typeof getWasmRuntime>>,
  outXYOffset: number,
  handle: StaticGeometryHandle,
  scale: number,
  offsetX: number,
  offsetY: number,
  pixelStep: number,
  closePath: boolean
): boolean {
  if (handle.ringCount <= 0 || handle.epoch !== rt.arenaEpoch) return false;
  const kernel =
    handle.precision === 16
      ? rt.exports.decimateRingsBatchU16
      : rt.exports.decimateRingsBatch;
  if (!kernel) return false;

  const outLenOffset = outXYOffset + handle.totalInFloats * 4;
  if (!rt.ensureCapacity(outLenOffset + handle.ringCount * 4)) return false;

  const outFloats = kernel(
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

/**
 * Decimates and traces rings (from a StaticGeometryHandle or packed Float32Array) onto a 2D canvas.
 */
export function drawRings(
  ctx: CanvasRenderingContext2D,
  handle: StaticGeometryHandle,
  scale: number,
  offsetX: number,
  offsetY: number,
  pixelStep: number,
  closePath: boolean
): boolean;
export function drawRings(
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
): boolean;
export function drawRings(
  ctx: CanvasRenderingContext2D,
  arg2: StaticGeometryHandle | Float32Array,
  arg3: number | Int32Array,
  arg4: number,
  arg5: number,
  arg6: number,
  arg7: boolean | number,
  arg8?: number,
  arg9?: boolean,
  arg10?: Float32Array,
  arg11?: Int32Array
): boolean {
  if ('xyOffset' in arg2) {
    if (arg2.ringCount <= 0) return false;
    const rt = getWasmRuntime();
    if (rt === null) return false;
    return drawStaticWithRuntime(
      ctx,
      rt,
      rt.getScratchBase(),
      arg2,
      arg3 as number,
      arg4,
      arg5,
      arg6,
      arg7 as boolean
    );
  }
  return drawDecimatedRings(
    ctx,
    arg2,
    arg3 as Int32Array,
    arg4,
    arg5,
    arg6,
    arg7 as number,
    arg8!,
    arg9!,
    arg10!,
    arg11!
  );
}

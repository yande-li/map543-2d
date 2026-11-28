import { type StaticGeometryHandle } from './batch';
import { getWasmRuntime } from '../wasm/bridge';

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

/**
 * Decimates and traces static arena rings using an existing WasmRuntime instance.
 */
export function simplifyRings(
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

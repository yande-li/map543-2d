import { Viewport } from './viewport';
import { quantize16, type StaticPointsHandle } from './batch';
import {
  LUT_OFFSET_BYTES,
  getWasmRuntime,
  stageTypedCoordPair,
  type WasmRuntime,
} from '../wasm/bridge';

export interface PointData {
  count: number;
  lats: ArrayLike<number>;
  lons: ArrayLike<number>;
}

function invokeHitTestKernel(
  rt: WasmRuntime,
  clickX: number,
  clickY: number,
  radiusPx: number,
  count: number,
  latsOffset: number,
  lonsOffset: number,
  viewport: Viewport,
  is16: 0 | 1
): number {
  const p = viewport.getProjectionParams();
  return rt.exports.findNearestPointBatch(
    clickX,
    clickY,
    radiusPx * radiusPx,
    count,
    LUT_OFFSET_BYTES,
    latsOffset,
    lonsOffset,
    p.centerNormX,
    p.centerNormY,
    p.worldSize,
    p.halfW,
    p.halfH,
    is16
  );
}

/**
 * Nearest-point hit-test executed in WASM (supports 32-bit Float32Array, 16-bit Int16Array, or StaticPointsHandle).
 * Returns -1 if no point lies within radiusPx.
 */
export function hitTestPoints(
  clickX: number,
  clickY: number,
  points: PointData | StaticPointsHandle | null,
  viewport: Viewport,
  radiusPx = 14
): number {
  if (!points || points.count <= 0) return -1;
  const rt = getWasmRuntime();
  if (rt === null) return -1;

  if ('latsOffset' in points) {
    if (points.epoch !== rt.arenaEpoch) return -1;
    return invokeHitTestKernel(
      rt,
      clickX,
      clickY,
      radiusPx,
      points.count,
      points.latsOffset,
      points.lonsOffset,
      viewport,
      points.precision === 16 ? 1 : 0
    );
  }

  const { lats, lons, count } = points;
  if (count > lats.length || count > lons.length) return -1;
  const isI16 = lats instanceof Int16Array && lons instanceof Int16Array;
  const isF32 = lats instanceof Float32Array && lons instanceof Float32Array;
  if (!isI16 && !isF32) return -1;

  const elemShift: 1 | 2 = isI16 ? 1 : 2;
  const byteLen = count << elemShift;
  const latsOffset = rt.getScratchBase();
  const lonsOffset = latsOffset + byteLen;
  if (!rt.ensureCapacity(lonsOffset + byteLen)) return -1;

  stageTypedCoordPair(rt, lats, lons, count, latsOffset, lonsOffset, isI16);
  return invokeHitTestKernel(
    rt,
    clickX,
    clickY,
    radiusPx,
    count,
    latsOffset,
    lonsOffset,
    viewport,
    isI16 ? 1 : 0
  );
}

/**
 * Encodes (lat, lon) arrays into 16-bit fixed-point PointData buffers.
 */
export function encodePoints16(
  lats: ArrayLike<number>,
  lons: ArrayLike<number>,
  count = Math.min(lats.length, lons.length)
): { count: number; lats: Int16Array; lons: Int16Array } {
  const n = Math.max(0, Math.min(count, lats.length, lons.length));
  const outLats = new Int16Array(n);
  const outLons = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    outLats[i] = quantize16(lats[i], 90);
    outLons[i] = quantize16(lons[i], 180);
  }
  return { count: n, lats: outLats, lons: outLons };
}

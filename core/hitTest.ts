import { Camera } from './camera';
import { type StaticPointsHandle } from './batch';
import { Point2D } from './projection';
import { LUT_OFFSET_BYTES, getWasmRuntime } from '../wasm/bridge';

export interface SpatialPoints {
  count: number;
  lats: ArrayLike<number>;
  lons: ArrayLike<number>;
}

/**
 * Finds the index of the nearest point within radiusPx of (clickX, clickY), or -1 if none.
 */
export function findNearestPoint(
  clickX: number,
  clickY: number,
  points: SpatialPoints | null,
  projectFn: (lat: number, lon: number, out: Point2D) => Point2D,
  radiusPx = 14
): number {
  if (!points || points.count <= 0) return -1;

  let bestIdx = -1;
  let bestDistSq = radiusPx * radiusPx;
  const tmpPt: Point2D = { x: 0, y: 0 };

  for (let i = 0; i < points.count; i++) {
    const lat = points.lats[i];
    const lon = points.lons[i];
    if (lat === undefined || lon === undefined) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const pt = projectFn(lat, lon, tmpPt);
    const dx = pt.x - clickX;
    const dy = pt.y - clickY;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      bestIdx = i;
    }
  }

  return bestIdx;
}

type HitTestKernelFn = (
  clickX: number,
  clickY: number,
  radiusSq: number,
  count: number,
  lutOffset: number,
  latsOffset: number,
  lonsOffset: number,
  centerNormX: number,
  centerNormY: number,
  worldSize: number,
  halfW: number,
  halfH: number
) => number;

function runHitTestKernel<T extends Float32Array | Int16Array>(
  clickX: number,
  clickY: number,
  lats: T,
  lons: T,
  count: number,
  camera: Camera,
  radiusPx: number,
  elemShift: 1 | 2,
  getView: (rt: NonNullable<ReturnType<typeof getWasmRuntime>>) => T,
  selectKernel: (
    rt: NonNullable<ReturnType<typeof getWasmRuntime>>
  ) => HitTestKernelFn | undefined
): number {
  if (count <= 0 || count > lats.length || count > lons.length) return -1;
  const rt = getWasmRuntime();
  if (rt === null) return -1;
  const kernel = selectKernel(rt);
  if (!kernel) return -1;

  const byteLen = count << elemShift;
  const latsOffset = rt.getScratchBase();
  const lonsOffset = latsOffset + byteLen;
  if (!rt.ensureCapacity(lonsOffset + byteLen)) return -1;

  const view = getView(rt);
  view.set(
    count === lats.length ? lats : lats.subarray(0, count),
    latsOffset >> elemShift
  );
  view.set(
    count === lons.length ? lons : lons.subarray(0, count),
    lonsOffset >> elemShift
  );

  const p = camera.getProjectionParams();
  return kernel(
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
    p.halfH
  );
}

/**
 * High-throughput nearest-point hit-test executed directly in the WebAssembly kernel.
 * Returns -1 if WASM is not initialized or no point lies within radiusPx.
 */
export function hitTestPoints(
  clickX: number,
  clickY: number,
  points: SpatialPoints | null,
  camera: Camera,
  radiusPx = 14
): number {
  if (
    !points ||
    !(points.lats instanceof Float32Array) ||
    !(points.lons instanceof Float32Array)
  ) {
    return -1;
  }
  return runHitTestKernel(
    clickX,
    clickY,
    points.lats,
    points.lons,
    points.count,
    camera,
    radiusPx,
    2,
    (rt) => rt.f32,
    (rt) => rt.exports.findNearestPointBatch
  );
}

/**
 * Encodes (lat, lon) arrays into Int16 fixed-point buffers (50% RAM reduction).
 */
export function encodePointsToI16(
  lats: ArrayLike<number>,
  lons: ArrayLike<number>,
  count = Math.min(lats.length, lons.length)
): { count: number; latsI16: Int16Array; lonsI16: Int16Array } {
  const n = Math.max(0, Math.min(count, lats.length, lons.length));
  const latsI16 = new Int16Array(n);
  const lonsI16 = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const lat = lats[i];
    const lon = lons[i];
    const cLat = Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : 0;
    const cLon = Number.isFinite(lon) ? Math.max(-180, Math.min(180, lon)) : 0;
    latsI16[i] = Math.round((cLat / 90) * 32767);
    lonsI16[i] = Math.round((cLon / 180) * 32767);
  }
  return { count: n, latsI16, lonsI16 };
}

/**
 * Optional Int16 variant of `hitTestPoints` for 50% point buffer RAM reduction.
 */
export function hitTestPointsI16(
  clickX: number,
  clickY: number,
  latsI16: Int16Array,
  lonsI16: Int16Array,
  count: number,
  camera: Camera,
  radiusPx = 14
): number {
  return runHitTestKernel(
    clickX,
    clickY,
    latsI16,
    lonsI16,
    count,
    camera,
    radiusPx,
    1,
    (rt) => rt.i16,
    (rt) => rt.exports.findNearestPointBatchI16
  );
}

/**
 * Zero-copy nearest-point hit-test against points resident in the WASM static arena.
 */
export function hitTestStaticPoints(
  clickX: number,
  clickY: number,
  handle: StaticPointsHandle,
  camera: Camera,
  radiusPx = 14
): number {
  if (handle.count <= 0) return -1;
  const rt = getWasmRuntime();
  if (rt === null || handle.epoch !== rt.arenaEpoch) return -1;
  const kernel = handle.isI16
    ? rt.exports.findNearestPointBatchI16
    : rt.exports.findNearestPointBatch;
  if (!kernel) return -1;

  const p = camera.getProjectionParams();
  return kernel(
    clickX,
    clickY,
    radiusPx * radiusPx,
    handle.count,
    LUT_OFFSET_BYTES,
    handle.latsOffset,
    handle.lonsOffset,
    p.centerNormX,
    p.centerNormY,
    p.worldSize,
    p.halfW,
    p.halfH
  );
}

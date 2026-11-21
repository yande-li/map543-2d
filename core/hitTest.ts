import { Camera } from './camera';
import { type StaticPointsHandle } from './batch';
import { Point2D } from './projection';
import {
  LUT_OFFSET_BYTES,
  getWasmRuntime,
  stageCoordPair,
  type HitTestKernelFn,
} from '../wasm/bridge';

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

  stageCoordPair(
    getView(rt),
    lats,
    lons,
    count,
    latsOffset,
    lonsOffset,
    elemShift
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

function hitTestStaticPointsHandle(
  clickX: number,
  clickY: number,
  handle: StaticPointsHandle,
  camera: Camera,
  radiusPx: number
): number {
  if (handle.count <= 0) return -1;
  const rt = getWasmRuntime();
  if (rt === null || handle.epoch !== rt.arenaEpoch) return -1;
  const kernel =
    handle.precision === 16
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

/**
 * Nearest-point hit-test executed in WASM (supports 32-bit Float32Array, 16-bit Int16Array, or StaticPointsHandle).
 * Returns -1 if no point lies within radiusPx.
 */
export function hitTestPoints(
  clickX: number,
  clickY: number,
  points: SpatialPoints | StaticPointsHandle | null,
  camera: Camera,
  radiusPx = 14
): number {
  if (!points) return -1;
  if ('latsOffset' in points) {
    return hitTestStaticPointsHandle(clickX, clickY, points, camera, radiusPx);
  }
  if (points.lats instanceof Int16Array && points.lons instanceof Int16Array) {
    return runHitTestKernel(
      clickX,
      clickY,
      points.lats,
      points.lons,
      points.count,
      camera,
      radiusPx,
      1,
      (rt) => rt.i16,
      (rt) => rt.exports.findNearestPointBatchI16
    );
  }
  if (
    points.lats instanceof Float32Array &&
    points.lons instanceof Float32Array
  ) {
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
  return -1;
}

/**
 * Encodes (lat, lon) arrays into 16-bit fixed-point SpatialPoints buffers.
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
    const lat = lats[i];
    const lon = lons[i];
    const cLat = Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : 0;
    const cLon = Number.isFinite(lon) ? Math.max(-180, Math.min(180, lon)) : 0;
    outLats[i] = Math.round((cLat / 90) * 32767);
    outLons[i] = Math.round((cLon / 180) * 32767);
  }
  return { count: n, lats: outLats, lons: outLons };
}

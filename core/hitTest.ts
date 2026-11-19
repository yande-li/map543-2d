import { Camera } from './camera';
import { Point2D } from './projection';
import {
  LUT_OFFSET_BYTES,
  getWasmRuntime,
} from '../wasm/wasmBridge';

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

/**
 * High-throughput nearest-point hit-test executed directly in the WebAssembly kernel.
 * Returns -1 if WASM is not initialized or no point lies within radiusPx.
 */
export function findNearestPointFast(
  clickX: number,
  clickY: number,
  points: SpatialPoints | null,
  camera: Camera,
  radiusPx = 14
): number {
  if (!points || points.count <= 0) return -1;

  const rt = getWasmRuntime();
  if (
    rt === null ||
    !(points.lats instanceof Float32Array) ||
    !(points.lons instanceof Float32Array) ||
    points.count > points.lats.length ||
    points.count > points.lons.length
  ) {
    return -1;
  }

  const count = points.count;
  const byteLen = count * 4;
  const latsOffset = rt.getScratchBase();
  const lonsOffset = latsOffset + byteLen;
  if (!rt.ensureCapacity(lonsOffset + byteLen)) return -1;

  rt.f32.set(
    count === points.lats.length
      ? points.lats
      : points.lats.subarray(0, count),
    latsOffset >> 2
  );
  rt.f32.set(
    count === points.lons.length
      ? points.lons
      : points.lons.subarray(0, count),
    lonsOffset >> 2
  );
  const p = camera.getProjectionParams();
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
    p.halfH
  );
}

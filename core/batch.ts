import { Camera } from './camera';
import {
  LUT_OFFSET_BYTES,
  getWasmRuntime,
} from '../wasm/wasmBridge';

/**
 * Batch-projects (lat, lon) arrays into screen coordinates with viewport AABB culling
 * using the WebAssembly kernel. Returns 0 if WASM is not yet initialized.
 */
export function batchProjectPoints(
  lats: Float32Array,
  lons: Float32Array,
  count: number,
  camera: Camera,
  margin: number,
  outXY: Float32Array,
  outIndices: Int32Array
): number {
  if (
    count <= 0 ||
    count > lats.length ||
    count > lons.length ||
    outXY.length < count * 2 ||
    outIndices.length < count
  ) {
    return 0;
  }

  const rt = getWasmRuntime();
  if (rt === null) return 0;

  const f32Bytes = count * 4;
  const latsOffset = rt.getScratchBase();
  const lonsOffset = latsOffset + f32Bytes;
  const outXYOffset = lonsOffset + f32Bytes;
  const outIdxOffset = outXYOffset + f32Bytes * 2;
  const totalBytes = outIdxOffset + f32Bytes;

  if (!rt.ensureCapacity(totalBytes)) return 0;

  rt.f32.set(
    count === lats.length ? lats : lats.subarray(0, count),
    latsOffset >> 2
  );
  rt.f32.set(
    count === lons.length ? lons : lons.subarray(0, count),
    lonsOffset >> 2
  );

  const state = camera.getState();
  const p = camera.getProjectionParams();
  const visible = rt.exports.batchProjectMercator(
    count,
    LUT_OFFSET_BYTES,
    latsOffset,
    lonsOffset,
    outXYOffset,
    outIdxOffset,
    p.centerNormX,
    p.centerNormY,
    p.worldSize,
    p.halfW,
    p.halfH,
    -margin,
    -margin,
    state.width + margin,
    state.height + margin
  );

  if (visible > 0) {
    outXY.set(
      rt.f32.subarray(outXYOffset >> 2, (outXYOffset >> 2) + visible * 2)
    );
    outIndices.set(
      rt.i32.subarray(outIdxOffset >> 2, (outIdxOffset >> 2) + visible)
    );
  }
  return visible;
}

/**
 * Batch-transforms and decimates packed normalized rings [nx, ny, ...] via WASM.
 * Returns 0 if WASM is not yet initialized.
 */
export function decimatePackedRings(
  packedXY: Float32Array,
  ringLengths: Int32Array,
  ringCount: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  pixelStep: number,
  outXY: Float32Array,
  outRingLengths: Int32Array
): number {
  if (
    ringCount <= 0 ||
    ringCount > ringLengths.length ||
    outRingLengths.length < ringCount ||
    outXY.length < packedXY.length
  ) {
    return 0;
  }

  let expectedFloats = 0;
  for (let r = 0; r < ringCount; r++) {
    const len = ringLengths[r];
    if (len < 0 || (len & 1) !== 0) {
      return 0;
    }
    expectedFloats += len;
    if (expectedFloats > packedXY.length) {
      return 0;
    }
  }
  if (expectedFloats === 0) {
    outRingLengths.fill(0, 0, ringCount);
    return 0;
  }

  const rt = getWasmRuntime();
  if (rt === null) return 0;

  const totalInFloats = packedXY.length;
  const xyBytes = totalInFloats * 4;
  const lenBytes = ringCount * 4;
  const inXYOffset = rt.getScratchBase();
  const ringLenOffset = inXYOffset + xyBytes;
  const outXYOffset = ringLenOffset + lenBytes;
  const outLenOffset = outXYOffset + xyBytes;
  const totalBytes = outLenOffset + lenBytes;

  if (!rt.ensureCapacity(totalBytes)) return 0;

  rt.f32.set(packedXY, inXYOffset >> 2);
  rt.i32.set(
    ringCount === ringLengths.length
      ? ringLengths
      : ringLengths.subarray(0, ringCount),
    ringLenOffset >> 2
  );

  const outFloats = rt.exports.decimateRingsBatch(
    ringCount,
    inXYOffset,
    ringLenOffset,
    outXYOffset,
    outLenOffset,
    scale,
    offsetX,
    offsetY,
    pixelStep
  );

  if (outFloats > 0 && outFloats <= outXY.length) {
    outXY.set(
      rt.f32.subarray(outXYOffset >> 2, (outXYOffset >> 2) + outFloats)
    );
  }
  outRingLengths.set(
    rt.i32.subarray(outLenOffset >> 2, (outLenOffset >> 2) + ringCount)
  );
  return outFloats;
}

export interface StaticGeometryHandle {
  epoch: number;
  xyOffset: number;
  lenOffset: number;
  ringCount: number;
  totalInFloats: number;
}

/**
 * Uploads static packed rings into the WASM bump arena once so subsequent frames
 * can decimate without copying packedXY/ringLengths across the JS-WASM boundary.
 */
export function uploadStaticRings(
  packedXY: Float32Array,
  ringLengths: Int32Array,
  ringCount: number
): StaticGeometryHandle | null {
  if (
    ringCount <= 0 ||
    ringCount > ringLengths.length ||
    packedXY.length === 0
  ) {
    return null;
  }
  let expectedFloats = 0;
  for (let r = 0; r < ringCount; r++) {
    const len = ringLengths[r];
    if (len < 0 || (len & 1) !== 0) return null;
    expectedFloats += len;
    if (expectedFloats > packedXY.length) return null;
  }
  if (expectedFloats === 0) return null;

  const rt = getWasmRuntime();
  if (rt === null) return null;

  const totalInFloats = packedXY.length;
  const xyOffset = rt.allocStatic(totalInFloats * 4);
  if (xyOffset === null) return null;
  const lenOffset = rt.allocStatic(ringCount * 4);
  if (lenOffset === null) return null;

  rt.f32.set(packedXY, xyOffset >> 2);
  rt.i32.set(
    ringCount === ringLengths.length
      ? ringLengths
      : ringLengths.subarray(0, ringCount),
    lenOffset >> 2
  );

  return {
    epoch: rt.arenaEpoch,
    xyOffset,
    lenOffset,
    ringCount,
    totalInFloats,
  };
}

/**
 * Decimates rings already resident in the WASM static arena (zero input copy).
 * Returns 0 if WASM is not ready or the handle belongs to an invalidated epoch.
 */
export function decimateStaticRings(
  handle: StaticGeometryHandle,
  scale: number,
  offsetX: number,
  offsetY: number,
  pixelStep: number,
  outXY: Float32Array,
  outRingLengths: Int32Array
): number {
  if (
    handle.ringCount <= 0 ||
    outRingLengths.length < handle.ringCount ||
    outXY.length < handle.totalInFloats
  ) {
    return 0;
  }
  const rt = getWasmRuntime();
  if (rt === null || handle.epoch !== rt.arenaEpoch) return 0;

  const outXYOffset = rt.getScratchBase();
  const outLenOffset = outXYOffset + handle.totalInFloats * 4;
  const totalBytes = outLenOffset + handle.ringCount * 4;
  if (!rt.ensureCapacity(totalBytes)) return 0;

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

  if (outFloats > 0 && outFloats <= outXY.length) {
    outXY.set(
      rt.f32.subarray(outXYOffset >> 2, (outXYOffset >> 2) + outFloats)
    );
  }
  outRingLengths.set(
    rt.i32.subarray(outLenOffset >> 2, (outLenOffset >> 2) + handle.ringCount)
  );
  return outFloats;
}

/**
 * Cleans antimeridian jumps and vertical seams from a flat [lon, lat, ...] ring
 * while computing its [minLon, minLat, maxLon, maxLat] bounding box via WASM.
 */
export function cleanSeamRing(
  inLonLat: Float32Array,
  floatLen: number,
  outLonLat: Float32Array,
  outSegLengths: Int32Array,
  outBbox: Float32Array
): number {
  if (
    floatLen < 4 ||
    (floatLen & 1) !== 0 ||
    floatLen > inLonLat.length ||
    outLonLat.length < floatLen ||
    outBbox.length < 4
  ) {
    if (outBbox.length >= 4) {
      outBbox[0] = Infinity;
      outBbox[1] = Infinity;
      outBbox[2] = -Infinity;
      outBbox[3] = -Infinity;
    }
    return 0;
  }

  const rt = getWasmRuntime();
  const maxSegs = Math.max(1, floatLen >> 1);
  if (rt === null || outSegLengths.length < maxSegs) return 0;

  const inBytes = floatLen * 4;
  const inOffset = rt.getScratchBase();
  const outOffset = inOffset + inBytes;
  const segLenOffset = outOffset + inBytes;
  const bboxOffset = segLenOffset + maxSegs * 4;
  const totalBytes = bboxOffset + 16;

  if (!rt.ensureCapacity(totalBytes)) return 0;

  rt.f32.set(
    floatLen === inLonLat.length ? inLonLat : inLonLat.subarray(0, floatLen),
    inOffset >> 2
  );

  const segCount = rt.exports.cleanSeamRingBatch(
    floatLen,
    inOffset,
    outOffset,
    segLenOffset,
    bboxOffset
  );

  outBbox.set(rt.f32.subarray(bboxOffset >> 2, (bboxOffset >> 2) + 4));
  if (segCount > 0 && segCount <= outSegLengths.length) {
    outSegLengths.set(
      rt.i32.subarray(segLenOffset >> 2, (segLenOffset >> 2) + segCount)
    );
    let totalOutFloats = 0;
    for (let s = 0; s < segCount; s++) {
      totalOutFloats += outSegLengths[s];
    }
    if (totalOutFloats > 0 && totalOutFloats <= outLonLat.length) {
      outLonLat.set(
        rt.f32.subarray(outOffset >> 2, (outOffset >> 2) + totalOutFloats)
      );
    }
  }
  return segCount;
}

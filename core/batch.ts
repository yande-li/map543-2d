import { Camera } from './camera';
import { type SpatialPoints } from './hitTest';
import {
  LUT_OFFSET_BYTES,
  getWasmRuntime,
  stageCoordPair,
  type BatchProjectKernelFn,
  type WasmRuntime,
} from '../wasm/bridge';

export type CoordPrecision = 32 | 16;

export interface StaticPointsHandle {
  epoch: number;
  latsOffset: number;
  lonsOffset: number;
  count: number;
  precision: CoordPrecision;
}

function invokeProjectKernel(
  rt: WasmRuntime,
  kernel: BatchProjectKernelFn,
  count: number,
  latsOffset: number,
  lonsOffset: number,
  outXYOffset: number,
  outIdxOffset: number,
  camera: Camera,
  margin: number,
  outXY: Float32Array,
  outIndices: Int32Array
): number {
  const state = camera.getState();
  const p = camera.getProjectionParams();
  const visible = kernel(
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

function runBatchProjectKernel<T extends Float32Array | Int16Array>(
  lats: T,
  lons: T,
  count: number,
  camera: Camera,
  margin: number,
  outXY: Float32Array,
  outIndices: Int32Array,
  elemShift: 1 | 2,
  getView: (rt: NonNullable<ReturnType<typeof getWasmRuntime>>) => T,
  selectKernel: (
    rt: NonNullable<ReturnType<typeof getWasmRuntime>>
  ) => BatchProjectKernelFn | undefined
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
  const kernel = selectKernel(rt);
  if (!kernel) return 0;

  const inBytes = count << elemShift;
  const latsOffset = rt.getScratchBase();
  const lonsOffset = latsOffset + inBytes;
  const outXYOffset = (lonsOffset + inBytes + 3) & ~3;
  const outIdxOffset = outXYOffset + count * 8;
  const totalBytes = outIdxOffset + count * 4;

  if (!rt.ensureCapacity(totalBytes)) return 0;

  const view = getView(rt);
  stageCoordPair(view, lats, lons, count, latsOffset, lonsOffset, elemShift);

  return invokeProjectKernel(
    rt,
    kernel,
    count,
    latsOffset,
    lonsOffset,
    outXYOffset,
    outIdxOffset,
    camera,
    margin,
    outXY,
    outIndices
  );
}

function projectStaticPointsHandle(
  handle: StaticPointsHandle,
  camera: Camera,
  margin: number,
  outXY: Float32Array,
  outIndices: Int32Array
): number {
  if (
    handle.count <= 0 ||
    outXY.length < handle.count * 2 ||
    outIndices.length < handle.count
  ) {
    return 0;
  }
  const rt = getWasmRuntime();
  if (rt === null || handle.epoch !== rt.arenaEpoch) return 0;

  const kernel =
    handle.precision === 16
      ? rt.exports.batchProjectMercatorI16
      : rt.exports.batchProjectMercator;
  if (!kernel) return 0;

  const outXYOffset = rt.getScratchBase();
  const outIdxOffset = outXYOffset + handle.count * 8;
  if (!rt.ensureCapacity(outIdxOffset + handle.count * 4)) return 0;

  return invokeProjectKernel(
    rt,
    kernel,
    handle.count,
    handle.latsOffset,
    handle.lonsOffset,
    outXYOffset,
    outIdxOffset,
    camera,
    margin,
    outXY,
    outIndices
  );
}

function projectTypedArrays(
  lats: ArrayLike<number>,
  lons: ArrayLike<number>,
  count: number,
  camera: Camera,
  margin: number,
  outXY: Float32Array,
  outIndices: Int32Array
): number {
  if (lats instanceof Int16Array && lons instanceof Int16Array) {
    return runBatchProjectKernel(
      lats,
      lons,
      count,
      camera,
      margin,
      outXY,
      outIndices,
      1,
      (rt) => rt.i16,
      (rt) => rt.exports.batchProjectMercatorI16
    );
  }
  if (lats instanceof Float32Array && lons instanceof Float32Array) {
    return runBatchProjectKernel(
      lats,
      lons,
      count,
      camera,
      margin,
      outXY,
      outIndices,
      2,
      (rt) => rt.f32,
      (rt) => rt.exports.batchProjectMercator
    );
  }
  return 0;
}

export interface WasmProjectedPointsResult {
  rt: WasmRuntime;
  visible: number;
  outXYFloatBase: number;
  outIdxIntBase: number;
}

/**
 * Projects points into WASM scratch memory without copying back to JS TypedArrays.
 * Callers must consume `rt.f32` / `rt.i32` before any subsequent WASM call that may grow memory.
 */
export function projectPointsToScratch(
  pointsOrHandle: StaticPointsHandle | SpatialPoints,
  camera: Camera,
  margin: number
): WasmProjectedPointsResult | null {
  const rt = getWasmRuntime();
  if (rt === null) return null;

  const state = camera.getState();
  const p = camera.getProjectionParams();

  if ('latsOffset' in pointsOrHandle) {
    if (pointsOrHandle.count <= 0 || pointsOrHandle.epoch !== rt.arenaEpoch) {
      return null;
    }
    const kernel =
      pointsOrHandle.precision === 16
        ? rt.exports.batchProjectMercatorI16
        : rt.exports.batchProjectMercator;
    if (!kernel) return null;
    const outXYOffset = rt.getScratchBase();
    const outIdxOffset = outXYOffset + pointsOrHandle.count * 8;
    if (!rt.ensureCapacity(outIdxOffset + pointsOrHandle.count * 4)) {
      return null;
    }
    const visible = kernel(
      pointsOrHandle.count,
      LUT_OFFSET_BYTES,
      pointsOrHandle.latsOffset,
      pointsOrHandle.lonsOffset,
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
    return {
      rt,
      visible,
      outXYFloatBase: outXYOffset >> 2,
      outIdxIntBase: outIdxOffset >> 2,
    };
  }

  const { lats, lons, count } = pointsOrHandle;
  if (count <= 0 || count > lats.length || count > lons.length) return null;

  const isI16 = lats instanceof Int16Array && lons instanceof Int16Array;
  const isF32 = lats instanceof Float32Array && lons instanceof Float32Array;
  if (!isI16 && !isF32) return null;

  const kernel = isI16
    ? rt.exports.batchProjectMercatorI16
    : rt.exports.batchProjectMercator;
  if (!kernel) return null;

  const elemShift: 1 | 2 = isI16 ? 1 : 2;
  const inBytes = count << elemShift;
  const latsOffset = rt.getScratchBase();
  const lonsOffset = latsOffset + inBytes;
  const outXYOffset = (lonsOffset + inBytes + 3) & ~3;
  const outIdxOffset = outXYOffset + count * 8;
  if (!rt.ensureCapacity(outIdxOffset + count * 4)) return null;

  if (isI16) {
    stageCoordPair(rt.i16, lats, lons, count, latsOffset, lonsOffset, 1);
  } else {
    stageCoordPair(rt.f32, lats, lons, count, latsOffset, lonsOffset, 2);
  }

  const visible = kernel(
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
  return {
    rt,
    visible,
    outXYFloatBase: outXYOffset >> 2,
    outIdxIntBase: outIdxOffset >> 2,
  };
}

/**
 * Batch-projects points (from a StaticPointsHandle, SpatialPoints object, or Float32/Int16 arrays)
 * into screen coordinates with viewport AABB culling.
 */
export function batchProjectPoints(
  pointsOrHandle: StaticPointsHandle | SpatialPoints,
  camera: Camera,
  margin: number,
  outXY: Float32Array,
  outIndices: Int32Array
): number;
export function batchProjectPoints(
  lats: Float32Array | Int16Array,
  lons: Float32Array | Int16Array,
  count: number,
  camera: Camera,
  margin: number,
  outXY: Float32Array,
  outIndices: Int32Array
): number;
export function batchProjectPoints(
  arg1: StaticPointsHandle | SpatialPoints | Float32Array | Int16Array,
  arg2: Camera | Float32Array | Int16Array,
  arg3: number,
  arg4: Float32Array | Camera,
  arg5: Int32Array | number,
  arg6?: Float32Array,
  arg7?: Int32Array
): number {
  if ('latsOffset' in arg1) {
    return projectStaticPointsHandle(
      arg1,
      arg2 as Camera,
      arg3,
      arg4 as Float32Array,
      arg5 as Int32Array
    );
  }
  if ('lats' in arg1 && 'lons' in arg1) {
    return projectTypedArrays(
      arg1.lats,
      arg1.lons,
      arg1.count,
      arg2 as Camera,
      arg3,
      arg4 as Float32Array,
      arg5 as Int32Array
    );
  }
  return projectTypedArrays(
    arg1,
    arg2 as Float32Array | Int16Array,
    arg3,
    arg4 as Camera,
    arg5 as number,
    arg6!,
    arg7!
  );
}

function uploadStaticPointsTyped<T extends Float32Array | Int16Array>(
  lats: T,
  lons: T,
  count: number,
  elemShift: 1 | 2,
  precision: CoordPrecision,
  getView: (rt: NonNullable<ReturnType<typeof getWasmRuntime>>) => T
): StaticPointsHandle | null {
  if (count <= 0 || count > lats.length || count > lons.length) return null;
  const rt = getWasmRuntime();
  if (rt === null) return null;

  const byteLen = count << elemShift;
  const latsOffset = rt.allocStatic(byteLen);
  if (latsOffset === null) return null;
  const lonsOffset = rt.allocStatic(byteLen);
  if (lonsOffset === null) return null;

  stageCoordPair(
    getView(rt),
    lats,
    lons,
    count,
    latsOffset,
    lonsOffset,
    elemShift
  );

  return {
    epoch: rt.arenaEpoch,
    latsOffset,
    lonsOffset,
    count,
    precision,
  };
}

/**
 * Uploads static 32-bit (Float32Array) or 16-bit (Int16Array) point arrays into the WASM arena.
 */
export function uploadStaticPoints(
  lats: Float32Array | Int16Array,
  lons: Float32Array | Int16Array,
  count = lats.length
): StaticPointsHandle | null {
  if (lats instanceof Int16Array && lons instanceof Int16Array) {
    return uploadStaticPointsTyped(lats, lons, count, 1, 16, (rt) => rt.i16);
  }
  if (lats instanceof Float32Array && lons instanceof Float32Array) {
    return uploadStaticPointsTyped(lats, lons, count, 2, 32, (rt) => rt.f32);
  }
  return null;
}

/**
 * Batch-transforms and decimates packed normalized rings [nx, ny, ...] via WASM.
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
  precision: CoordPrecision;
}

function uploadStaticRingsTyped<T extends Float32Array | Uint16Array>(
  packed: T,
  ringLengths: Int32Array,
  ringCount: number,
  elemShift: 1 | 2,
  precision: CoordPrecision,
  getView: (rt: NonNullable<ReturnType<typeof getWasmRuntime>>) => T
): StaticGeometryHandle | null {
  if (ringCount <= 0 || ringCount > ringLengths.length || packed.length === 0) {
    return null;
  }
  let expectedUnits = 0;
  for (let r = 0; r < ringCount; r++) {
    const len = ringLengths[r];
    if (len < 0 || (len & 1) !== 0) return null;
    expectedUnits += len;
    if (expectedUnits > packed.length) return null;
  }
  if (expectedUnits === 0) return null;

  const rt = getWasmRuntime();
  if (rt === null) return null;

  const totalInFloats = packed.length;
  const xyOffset = rt.allocStatic(totalInFloats << elemShift);
  if (xyOffset === null) return null;
  const lenOffset = rt.allocStatic(ringCount * 4);
  if (lenOffset === null) return null;

  getView(rt).set(packed, xyOffset >> elemShift);
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
    precision,
  };
}

/**
 * Uploads static 32-bit (Float32Array) or 16-bit (Uint16Array) packed rings into the WASM arena.
 */
export function uploadStaticRings(
  packed: Float32Array | Uint16Array,
  ringLengths: Int32Array,
  ringCount: number
): StaticGeometryHandle | null {
  if (packed instanceof Uint16Array) {
    return uploadStaticRingsTyped(
      packed,
      ringLengths,
      ringCount,
      1,
      16,
      (rt) => rt.u16
    );
  }
  return uploadStaticRingsTyped(
    packed,
    ringLengths,
    ringCount,
    2,
    32,
    (rt) => rt.f32
  );
}

/**
 * Quantizes normalized [0, 1] ring coordinates from 32-bit Float32Array into 16-bit Uint16Array.
 */
export function encodeRings16(packedXY: Float32Array): Uint16Array {
  const out = new Uint16Array(packedXY.length);
  for (let i = 0; i < packedXY.length; i++) {
    const v = packedXY[i];
    const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
    out[i] = (clamped * 65535 + 0.5) | 0;
  }
  return out;
}

/**
 * Batch-decodes 6-byte packed location dictionary entries into Float32 latitude,
 * longitude, and optional Mercator X/Y arrays.
 */
export function decodeLocationDictBatch(
  rawBytes: Uint8Array,
  locCount: number,
  outLats: Float32Array,
  outLons: Float32Array,
  outMxs?: Float32Array,
  outMys?: Float32Array
): number {
  if (
    locCount <= 0 ||
    rawBytes.length < locCount * 6 ||
    outLats.length < locCount ||
    outLons.length < locCount ||
    (outMxs !== undefined && outMxs.length < locCount) ||
    (outMys !== undefined && outMys.length < locCount)
  ) {
    return 0;
  }

  const rt = getWasmRuntime();
  if (rt === null) return 0;

  const inBytes = locCount * 6;
  const f32Bytes = locCount * 4;
  const inOff = rt.getScratchBase();
  const latsOff = inOff + ((inBytes + 15) & ~15);
  const lonsOff = latsOff + f32Bytes;
  const mxsOff = lonsOff + f32Bytes;
  const mysOff = mxsOff + f32Bytes;
  if (!rt.ensureCapacity(mysOff + f32Bytes)) return 0;

  rt.u8.set(
    rawBytes.length === inBytes ? rawBytes : rawBytes.subarray(0, inBytes),
    inOff
  );
  const decoded = rt.exports.decodeLocationDictBatch(
    locCount,
    LUT_OFFSET_BYTES,
    inOff,
    latsOff,
    lonsOff,
    mxsOff,
    mysOff
  );
  if (decoded > 0) {
    outLats.set(rt.f32.subarray(latsOff >> 2, (latsOff >> 2) + decoded));
    outLons.set(rt.f32.subarray(lonsOff >> 2, (lonsOff >> 2) + decoded));
    if (outMxs !== undefined) {
      outMxs.set(rt.f32.subarray(mxsOff >> 2, (mxsOff >> 2) + decoded));
    }
    if (outMys !== undefined) {
      outMys.set(rt.f32.subarray(mysOff >> 2, (mysOff >> 2) + decoded));
    }
  }
  return decoded;
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

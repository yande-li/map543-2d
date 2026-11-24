import { Viewport } from './viewport';
import { type PointData } from './hitTest';
import {
  LUT_OFFSET_BYTES,
  getWasmRuntime,
  stageCoordPair,
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

export function quantize16(val: number, maxAbs: number): number {
  const c = Number.isFinite(val) ? Math.max(-maxAbs, Math.min(maxAbs, val)) : 0;
  return Math.round((c / maxAbs) * 32767);
}

/**
 * Packs [lat, lon] items directly into 32-bit Float32Array or 16-bit Int16Array buffers
 * in a single pass without intermediate allocations.
 */
export function packLatLon<T extends { lat: number; lon: number }>(
  items: readonly T[],
  precision: CoordPrecision = 32,
  onItem?: (index: number, item: T) => void
): { lats: Float32Array | Int16Array; lons: Float32Array | Int16Array } {
  const count = items.length;
  if (precision === 16) {
    const lats = new Int16Array(count);
    const lons = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      const item = items[i];
      lats[i] = quantize16(item.lat, 90);
      lons[i] = quantize16(item.lon, 180);
      onItem?.(i, item);
    }
    return { lats, lons };
  }
  const lats = new Float32Array(count);
  const lons = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const item = items[i];
    lats[i] = item.lat;
    lons[i] = item.lon;
    onItem?.(i, item);
  }
  return { lats, lons };
}

/**
 * Returns the existing StaticPointsHandle if its arena epoch is still current,
 * otherwise re-uploads the coordinate arrays to the WASM static arena.
 */
export function resolveStaticPointsHandle(
  lats: Float32Array | Int16Array,
  lons: Float32Array | Int16Array,
  count: number,
  existing?: StaticPointsHandle | null
): StaticPointsHandle | null {
  const rt = getWasmRuntime();
  if (rt === null || count <= 0) return null;
  if (existing && existing.epoch === rt.arenaEpoch) return existing;
  return uploadStaticPoints(lats, lons, count);
}

export interface WasmProjectedPointsResult {
  rt: WasmRuntime;
  visible: number;
  outXYFloatBase: number;
  outIdxIntBase: number;
}

function projectStaticSliceToScratch(
  rt: WasmRuntime,
  handle: StaticPointsHandle,
  viewport: Viewport,
  margin: number,
  startIndex: number,
  sliceCount?: number
): WasmProjectedPointsResult | null {
  const count =
    sliceCount !== undefined
      ? Math.min(sliceCount, handle.count - startIndex)
      : handle.count - startIndex;
  if (startIndex < 0 || count <= 0 || handle.epoch !== rt.arenaEpoch) {
    return null;
  }
  const elemShift = handle.precision === 16 ? 1 : 2;
  const kernel =
    handle.precision === 16
      ? rt.exports.batchProjectMercatorI16
      : rt.exports.batchProjectMercator;
  if (!kernel) return null;

  const outXYOffset = rt.getScratchBase();
  const outIdxOffset = outXYOffset + count * 8;
  if (!rt.ensureCapacity(outIdxOffset + count * 4)) return null;

  const state = viewport.getState();
  const p = viewport.getProjectionParams();
  const visible = kernel(
    count,
    LUT_OFFSET_BYTES,
    handle.latsOffset + (startIndex << elemShift),
    handle.lonsOffset + (startIndex << elemShift),
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

function projectTypedSliceToScratch(
  rt: WasmRuntime,
  data: PointData,
  viewport: Viewport,
  margin: number,
  startIndex: number,
  sliceCount?: number
): WasmProjectedPointsResult | null {
  const count =
    sliceCount !== undefined
      ? Math.min(sliceCount, data.count - startIndex)
      : data.count - startIndex;
  const { lats, lons } = data;
  if (
    startIndex < 0 ||
    count <= 0 ||
    startIndex + count > lats.length ||
    startIndex + count > lons.length
  ) {
    return null;
  }
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

  const latSlice =
    startIndex === 0 && count === lats.length
      ? lats
      : lats.subarray(startIndex, startIndex + count);
  const lonSlice =
    startIndex === 0 && count === lons.length
      ? lons
      : lons.subarray(startIndex, startIndex + count);

  if (isI16) {
    stageCoordPair(
      rt.i16,
      latSlice as Int16Array,
      lonSlice as Int16Array,
      count,
      latsOffset,
      lonsOffset,
      1
    );
  } else {
    stageCoordPair(
      rt.f32,
      latSlice as Float32Array,
      lonSlice as Float32Array,
      count,
      latsOffset,
      lonsOffset,
      2
    );
  }

  const state = viewport.getState();
  const p = viewport.getProjectionParams();
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
 * Projects points into WASM scratch memory without copying back to JS TypedArrays.
 * Callers must consume `rt.f32` / `rt.i32` before any subsequent WASM call that may grow memory.
 */
export function projectPointsToScratch(
  pointsOrHandle: StaticPointsHandle | PointData,
  viewport: Viewport,
  margin: number,
  startIndex = 0,
  sliceCount?: number
): WasmProjectedPointsResult | null {
  const rt = getWasmRuntime();
  if (rt === null) return null;

  if ('latsOffset' in pointsOrHandle) {
    return projectStaticSliceToScratch(
      rt,
      pointsOrHandle,
      viewport,
      margin,
      startIndex,
      sliceCount
    );
  }
  return projectTypedSliceToScratch(
    rt,
    pointsOrHandle,
    viewport,
    margin,
    startIndex,
    sliceCount
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

import { Viewport } from './viewport';
import { type PointData } from './hitTest';
import {
  LUT_OFFSET_BYTES,
  getWasmRuntime,
  stageTypedCoordPair,
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
 * Allocates parallel 32-bit Float32Array or 16-bit Int16Array coordinate buffers.
 */
export function createCoordPairArrays(
  count: number,
  precision: CoordPrecision = 32
): { lats: Float32Array | Int16Array; lons: Float32Array | Int16Array } {
  const Ctor = precision === 16 ? Int16Array : Float32Array;
  return { lats: new Ctor(count), lons: new Ctor(count) };
}

/**
 * Writes a single (lat, lon) coordinate pair into 32-bit or 16-bit quantized buffers.
 */
export function writeCoordPair(
  lats: Float32Array | Int16Array,
  lons: Float32Array | Int16Array,
  idx: number,
  lat: number,
  lon: number,
  use16: boolean
): void {
  lats[idx] = use16 ? quantize16(lat, 90) : lat;
  lons[idx] = use16 ? quantize16(lon, 180) : lon;
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
  const use16 = precision === 16;
  const { lats, lons } = createCoordPairArrays(count, precision);
  for (let i = 0; i < count; i++) {
    const item = items[i];
    writeCoordPair(lats, lons, i, item.lat, item.lon, use16);
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

function runBatchProjectKernel(
  rt: WasmRuntime,
  count: number,
  is16: 0 | 1,
  latsOffset: number,
  lonsOffset: number,
  outXYOffset: number,
  viewport: Viewport,
  margin: number
): WasmProjectedPointsResult {
  const outIdxOffset = outXYOffset + count * 8;
  const state = viewport.getState();
  const p = viewport.getProjectionParams();
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
    state.height + margin,
    is16
  );
  return {
    rt,
    visible,
    outXYFloatBase: outXYOffset >> 2,
    outIdxIntBase: outIdxOffset >> 2,
  };
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
  const is16: 0 | 1 = handle.precision === 16 ? 1 : 0;
  const elemShift = is16 ? 1 : 2;
  const outXYOffset = rt.getScratchBase();
  if (!rt.ensureCapacity(outXYOffset + count * 12)) return null;

  return runBatchProjectKernel(
    rt,
    count,
    is16,
    handle.latsOffset + (startIndex << elemShift),
    handle.lonsOffset + (startIndex << elemShift),
    outXYOffset,
    viewport,
    margin
  );
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

  const elemShift: 1 | 2 = isI16 ? 1 : 2;
  const inBytes = count << elemShift;
  const latsOffset = rt.getScratchBase();
  const lonsOffset = latsOffset + inBytes;
  const outXYOffset = (lonsOffset + inBytes + 3) & ~3;
  if (!rt.ensureCapacity(outXYOffset + count * 12)) return null;

  const latSlice =
    startIndex === 0 && count === lats.length
      ? lats
      : lats.subarray(startIndex, startIndex + count);
  const lonSlice =
    startIndex === 0 && count === lons.length
      ? lons
      : lons.subarray(startIndex, startIndex + count);

  stageTypedCoordPair(
    rt,
    latSlice,
    lonSlice,
    count,
    latsOffset,
    lonsOffset,
    isI16
  );

  return runBatchProjectKernel(
    rt,
    count,
    isI16 ? 1 : 0,
    latsOffset,
    lonsOffset,
    outXYOffset,
    viewport,
    margin
  );
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

/**
 * Uploads static 32-bit (Float32Array) or 16-bit (Int16Array) point arrays into the WASM arena.
 */
export function uploadStaticPoints(
  lats: Float32Array | Int16Array,
  lons: Float32Array | Int16Array,
  count = lats.length
): StaticPointsHandle | null {
  const isI16 = lats instanceof Int16Array && lons instanceof Int16Array;
  const isF32 = lats instanceof Float32Array && lons instanceof Float32Array;
  if (
    (!isI16 && !isF32) ||
    count <= 0 ||
    count > lats.length ||
    count > lons.length
  ) {
    return null;
  }
  const rt = getWasmRuntime();
  if (rt === null) return null;

  const elemShift: 1 | 2 = isI16 ? 1 : 2;
  const byteLen = count << elemShift;
  const latsOffset = rt.allocStatic(byteLen);
  if (latsOffset === null) return null;
  const lonsOffset = rt.allocStatic(byteLen);
  if (lonsOffset === null) return null;

  stageTypedCoordPair(rt, lats, lons, count, latsOffset, lonsOffset, isI16);

  return {
    epoch: rt.arenaEpoch,
    latsOffset,
    lonsOffset,
    count,
    precision: isI16 ? 16 : 32,
  };
}

export interface StaticGeometryHandle {
  epoch: number;
  xyOffset: number;
  lenOffset: number;
  ringCount: number;
  totalInFloats: number;
  precision: CoordPrecision;
}

/**
 * Uploads static 32-bit (Float32Array) or 16-bit (Uint16Array) packed rings into the WASM arena.
 */
export function uploadStaticRings(
  packed: Float32Array | Uint16Array,
  ringLengths: Int32Array,
  ringCount: number
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

  const isU16 = packed instanceof Uint16Array;
  const elemShift: 1 | 2 = isU16 ? 1 : 2;
  const totalInFloats = packed.length;
  const xyOffset = rt.allocStatic(totalInFloats << elemShift);
  if (xyOffset === null) return null;
  const lenOffset = rt.allocStatic(ringCount * 4);
  if (lenOffset === null) return null;

  if (isU16) {
    rt.u16.set(packed, xyOffset >> 1);
  } else {
    rt.f32.set(packed, xyOffset >> 2);
  }
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
    precision: isU16 ? 16 : 32,
  };
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

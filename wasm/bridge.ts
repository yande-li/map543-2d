import { MERCATOR_Y_LOOKUP } from '../core/projection';

declare const __WASM_BASE64__: string;

const WASM_PAGE_BYTES = 65536;
const MAX_WASM_BYTES = 512 * WASM_PAGE_BYTES; // 32 MiB hard ceiling
export const LUT_OFFSET_BYTES = 0;
const ARENA_BASE_BYTES = 21632; // Aligned past 5401 * 4 = 21604 bytes

function align16(n: number): number {
  return (n + 15) & ~15;
}

export type HitTestKernelFn = (
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

export type BatchProjectKernelFn = (
  count: number,
  lutOffset: number,
  latsOffset: number,
  lonsOffset: number,
  outXYOffset: number,
  outIdxOffset: number,
  centerNormX: number,
  centerNormY: number,
  worldSize: number,
  halfW: number,
  halfH: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
) => number;

/**
 * Copies the first `count` lat/lon elements into two WASM linear-memory regions.
 * `view` must be freshly acquired from the runtime after `ensureCapacity`.
 */
export function stageCoordPair<T extends Float32Array | Int16Array>(
  view: T,
  lats: T,
  lons: T,
  count: number,
  latsOffset: number,
  lonsOffset: number,
  elemShift: 1 | 2
): void {
  view.set(
    count === lats.length ? lats : lats.subarray(0, count),
    latsOffset >> elemShift
  );
  view.set(
    count === lons.length ? lons : lons.subarray(0, count),
    lonsOffset >> elemShift
  );
}

interface WasmKernelExports {
  memory: WebAssembly.Memory;
  findNearestPointBatch: HitTestKernelFn;
  batchProjectMercator: BatchProjectKernelFn;
  decimateRingsBatch: (
    ringCount: number,
    inXYOffset: number,
    ringLengthsOffset: number,
    outXYOffset: number,
    outRingLengthsOffset: number,
    scale: number,
    offsetX: number,
    offsetY: number,
    pixelStep: number
  ) => number;
  cleanSeamRingBatch: (
    floatLen: number,
    inLonLatOffset: number,
    outLonLatOffset: number,
    outSegLengthsOffset: number,
    outBboxOffset: number
  ) => number;
  computeArcsBatch: (
    count: number,
    srcLatsOff: number,
    srcLonsOff: number,
    dstLatsOff: number,
    dstLonsOff: number,
    outOff: number
  ) => number;
  decodeGeobufRingMercator: (
    ptCount: number,
    dims: number,
    lutOff: number,
    inCoordsOff: number,
    outXYOff: number,
    boundsOff: number,
    invScale: number,
    accOff: number
  ) => number;
  decodeLocationDictBatch: (
    locCount: number,
    lutOff: number,
    inRawOff: number,
    latsOff: number,
    lonsOff: number,
    mxsOff: number,
    mysOff: number
  ) => number;
  projectMercator: (
    ptCount: number,
    lutOff: number,
    inLatLonOff: number,
    outXYOff: number,
    centerNormX: number,
    centerNormY: number,
    worldSize: number,
    halfW: number,
    halfH: number
  ) => number;
  decimateRingsBatchU16?: (
    ringCount: number,
    inXYOffset: number,
    ringLengthsOffset: number,
    outXYOffset: number,
    outRingLengthsOffset: number,
    scale: number,
    offsetX: number,
    offsetY: number,
    pixelStep: number
  ) => number;
  batchProjectMercatorI16?: BatchProjectKernelFn;
  findNearestPointBatchI16?: HitTestKernelFn;
}

export interface WasmRuntime {
  exports: WasmKernelExports;
  f32: Float32Array;
  f64: Float64Array;
  i32: Int32Array;
  u16: Uint16Array;
  i16: Int16Array;
  u8: Uint8Array;
  arenaEpoch: number;
  ensureCapacity: (requiredBytes: number) => boolean;
  getScratchBase: () => number;
  allocStatic: (bytes: number) => number | null;
  resetArena: () => void;
}

export interface WasmMemoryStats {
  ready: boolean;
  byteLength: number;
  arenaUsedBytes: number;
  epoch: number;
}

let runtime: WasmRuntime | null = null;
let compiledModule: WebAssembly.Module | null = null;
let globalEpoch = 1;

function isValidWasmExports(
  raw: WebAssembly.Exports
): raw is WebAssembly.Exports & WasmKernelExports {
  return (
    raw.memory instanceof WebAssembly.Memory &&
    typeof raw.findNearestPointBatch === 'function' &&
    typeof raw.batchProjectMercator === 'function' &&
    typeof raw.decimateRingsBatch === 'function' &&
    typeof raw.cleanSeamRingBatch === 'function' &&
    typeof raw.computeArcsBatch === 'function' &&
    typeof raw.decodeGeobufRingMercator === 'function' &&
    typeof raw.decodeLocationDictBatch === 'function'
  );
}

function setupRuntime(instance: WebAssembly.Instance): WasmRuntime | null {
  if (!isValidWasmExports(instance.exports)) {
    return null;
  }
  const exports = instance.exports;
  let cachedBuffer = exports.memory.buffer;
  let f32 = new Float32Array(cachedBuffer);
  let f64 = new Float64Array(cachedBuffer);
  let i32 = new Int32Array(cachedBuffer);
  let u16 = new Uint16Array(cachedBuffer);
  let i16 = new Int16Array(cachedBuffer);
  let u8 = new Uint8Array(cachedBuffer);

  // Copy MERCATOR_Y_LOOKUP into static LUT region once
  f32.set(MERCATOR_Y_LOOKUP, LUT_OFFSET_BYTES >> 2);

  const syncViews = () => {
    if (exports.memory.buffer !== cachedBuffer) {
      cachedBuffer = exports.memory.buffer;
      f32 = new Float32Array(cachedBuffer);
      f64 = new Float64Array(cachedBuffer);
      i32 = new Int32Array(cachedBuffer);
      u16 = new Uint16Array(cachedBuffer);
      i16 = new Int16Array(cachedBuffer);
      u8 = new Uint8Array(cachedBuffer);
      rt.f32 = f32;
      rt.f64 = f64;
      rt.i32 = i32;
      rt.u16 = u16;
      rt.i16 = i16;
      rt.u8 = u8;
    }
  };

  const ensureCapacity = (requiredBytes: number): boolean => {
    if (requiredBytes <= 0 || requiredBytes > MAX_WASM_BYTES) {
      return false;
    }
    const currentBytes = exports.memory.buffer.byteLength;
    if (requiredBytes <= currentBytes) {
      syncViews();
      return true;
    }
    const extraPages = Math.ceil(
      (requiredBytes - currentBytes) / WASM_PAGE_BYTES
    );
    try {
      exports.memory.grow(extraPages);
      syncViews();
      return true;
    } catch {
      return false;
    }
  };

  let arenaEnd = ARENA_BASE_BYTES;

  const rt: WasmRuntime = {
    exports,
    f32,
    f64,
    i32,
    u16,
    i16,
    u8,
    arenaEpoch: globalEpoch,
    ensureCapacity,
    getScratchBase: () => align16(arenaEnd),
    allocStatic: (bytes: number) => {
      if (bytes <= 0) return null;
      const offset = align16(arenaEnd);
      const nextEnd = offset + bytes;
      if (!ensureCapacity(nextEnd)) {
        return null;
      }
      arenaEnd = nextEnd;
      return offset;
    },
    resetArena: () => {
      arenaEnd = ARENA_BASE_BYTES;
      globalEpoch += 1;
      rt.arenaEpoch = globalEpoch;
    },
  };
  return rt;
}

const WASM_IMPORTS: WebAssembly.Imports = {};

function decodeEmbeddedWasm(): Uint8Array<ArrayBuffer> {
  const raw = atob(__WASM_BASE64__);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

/**
 * Returns the singleton WebAssembly runtime, initializing it synchronously on first access.
 */
export function getWasmRuntime(): WasmRuntime | null {
  if (runtime !== null) return runtime;
  if (typeof WebAssembly === 'undefined') return null;
  try {
    compiledModule ??= new WebAssembly.Module(decodeEmbeddedWasm());
    const instance = new WebAssembly.Instance(compiledModule, WASM_IMPORTS);
    runtime = setupRuntime(instance);
    return runtime;
  } catch {
    return null;
  }
}

/**
 * Warms up the singleton WebAssembly runtime and returns whether it is available.
 */
export function initWasm(): boolean {
  return getWasmRuntime() !== null;
}

/**
 * Resets the static geometry arena without destroying the WASM instance.
 */
export function resetWasmArena(): void {
  runtime?.resetArena();
}

/**
 * Releases the singleton WASM instance and its linear memory.
 */
export function disposeWasm(): void {
  runtime = null;
  globalEpoch += 1;
}

/**
 * Returns current WASM linear memory and static arena usage statistics.
 */
export function getWasmMemoryStats(): WasmMemoryStats {
  if (!runtime) {
    return {
      ready: false,
      byteLength: 0,
      arenaUsedBytes: 0,
      epoch: globalEpoch,
    };
  }
  const scratchBase = runtime.getScratchBase();
  return {
    ready: true,
    byteLength: runtime.exports.memory.buffer.byteLength,
    arenaUsedBytes: Math.max(0, scratchBase - ARENA_BASE_BYTES),
    epoch: runtime.arenaEpoch,
  };
}

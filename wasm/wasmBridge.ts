import { MERCATOR_Y_LOOKUP } from '../core/projection';

function getDefaultWasmUrl(): string {
  return new URL('./kernels.wasm', import.meta.url).href;
}

const WASM_PAGE_BYTES = 65536;
const MAX_WASM_BYTES = 512 * WASM_PAGE_BYTES; // 32 MiB hard ceiling
export const LUT_OFFSET_BYTES = 0;
export const SCRATCH_BASE_BYTES = 21632; // Aligned past 5401 * 4 = 21604 bytes
export const ARENA_BASE_BYTES = SCRATCH_BASE_BYTES;

function align16(n: number): number {
  return (n + 15) & ~15;
}

export interface WasmKernelExports {
  memory: WebAssembly.Memory;
  findNearestPointBatch: (
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
  batchProjectMercator: (
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
  computeQuadraticArcsBatch: (
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
  projectInterleavedMercator: (
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
}

export interface WasmRuntime {
  exports: WasmKernelExports;
  f32: Float32Array;
  f64: Float64Array;
  i32: Int32Array;
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
let initPromise: Promise<boolean> | null = null;
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
    typeof raw.computeQuadraticArcsBatch === 'function' &&
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
  let u8 = new Uint8Array(cachedBuffer);

  // Copy MERCATOR_Y_LOOKUP into static LUT region once
  f32.set(MERCATOR_Y_LOOKUP, LUT_OFFSET_BYTES >> 2);

  const syncViews = () => {
    if (exports.memory.buffer !== cachedBuffer) {
      cachedBuffer = exports.memory.buffer;
      f32 = new Float32Array(cachedBuffer);
      f64 = new Float64Array(cachedBuffer);
      i32 = new Int32Array(cachedBuffer);
      u8 = new Uint8Array(cachedBuffer);
      rt.f32 = f32;
      rt.f64 = f64;
      rt.i32 = i32;
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

const WASM_IMPORTS: WebAssembly.Imports = {
  env: {
    abort: () => {
      // No-op abort handler for AssemblyScript stub runtime
    },
  },
};

async function instantiateFromUrl(
  url: string | URL
): Promise<WebAssembly.Instance> {
  if (typeof WebAssembly.instantiateStreaming === 'function') {
    try {
      const { instance } = await WebAssembly.instantiateStreaming(
        fetch(url),
        WASM_IMPORTS
      );
      return instance;
    } catch {
      // Fallback when server/proxy lacks application/wasm MIME type
    }
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch WASM binary: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(buffer, WASM_IMPORTS);
  return instance;
}

/**
 * Asynchronously initializes the singleton map543-2d WebAssembly runtime
 * from the compiled .wasm asset (or a custom URL / preloaded BufferSource).
 */
export async function initWasm(
  source?: string | URL | BufferSource
): Promise<boolean> {
  if (runtime !== null) return true;
  if (initPromise !== null && source === undefined) return initPromise;

  let task: Promise<boolean> | null = null;
  task = (async () => {
    if (typeof WebAssembly === 'undefined') return false;
    try {
      let instance: WebAssembly.Instance;
      if (
        source !== undefined &&
        typeof source !== 'string' &&
        !(source instanceof URL)
      ) {
        const result = await WebAssembly.instantiate(source, WASM_IMPORTS);
        instance = result.instance;
      } else {
        instance = await instantiateFromUrl(source ?? getDefaultWasmUrl());
      }
      if (source === undefined && initPromise !== task) {
        return false;
      }
      runtime = setupRuntime(instance);
      return runtime !== null;
    } catch {
      return false;
    }
  })();

  if (source === undefined) {
    initPromise = task;
  }
  return task;
}

export function isWasmReady(): boolean {
  return runtime !== null;
}

export function getWasmRuntime(): WasmRuntime | null {
  return runtime;
}

/**
 * Resets the static geometry bump arena without destroying the WASM instance.
 */
export function resetWasmArena(): void {
  runtime?.resetArena();
}

/**
 * Releases the singleton WASM instance and its linear memory so the browser GC
 * can reclaim all allocated pages. Subsequent initWasm() calls will re-instantiate.
 */
export function disposeWasm(): void {
  runtime = null;
  initPromise = null;
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

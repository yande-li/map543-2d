import {
  type CoordPrecision,
  type StaticPointsHandle,
  packLatLon,
  projectPointsToScratch,
  resolveStaticPointsHandle,
  uploadStaticPoints,
} from './batch';
import { type Viewport } from './viewport';
import { type WasmRuntime } from '../wasm/bridge';

export interface HeatmapPoint {
  lat: number;
  lon: number;
  weight?: number;
}

export interface HeatmapColorStop {
  offset: number;
  color: string;
}

export interface HeatmapBuffers {
  count: number;
  lats: Float32Array | Int16Array;
  lons: Float32Array | Int16Array;
  weights: Float32Array | Uint16Array | null;
  times: Uint16Array | null;
  precision: CoordPrecision;
  staticHandle?: StaticPointsHandle | null;
}

export interface HeatmapOptions {
  /** Influence radius in CSS pixels (default: 24). */
  radiusPx?: number;
  /** Downsample factor in (0, 1] for pixel matrix grid (default: 0.25). */
  gridScale?: number;
  /** Density value mapped to max palette color (default: 3). */
  maxIntensity?: number;
  /** Precomputed 1024-byte RGBA palette LUT from `buildHeatmapPalette`. */
  palette?: Uint8Array;
  /** Global canvas opacity in [0, 1] (default: 0.85). */
  opacity?: number;
  /** Optional inclusive [startTime, endTime] filter against sorted `buffers.times`. */
  timeRange?: readonly [number, number];
}

export interface HeatmapScratch {
  offscreen?: HTMLCanvasElement;
  offCtx?: CanvasRenderingContext2D | null;
  imageData?: ImageData;
}

const DEFAULT_STOPS: readonly HeatmapColorStop[] = [
  { offset: 0.0, color: '#00000000' },
  { offset: 0.25, color: '#0ea5e988' },
  { offset: 0.55, color: '#22c55ecc' },
  { offset: 0.8, color: '#facc15ee' },
  { offset: 1.0, color: '#ef4444ff' },
];

function parseHexRgba(hex: string): [number, number, number, number] {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const a = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) : 255;
  return [r, g, b, Number.isFinite(a) ? a : 255];
}

/**
 * Builds a 256-entry (1024-byte) RGBA lookup table for WASM heatmap colorization.
 */
export function buildHeatmapPalette(
  stops: readonly HeatmapColorStop[] = DEFAULT_STOPS
): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  if (sorted.length === 0) return lut;

  const parsed = sorted.map((s) => ({
    offset: Math.max(0, Math.min(1, s.offset)),
    rgba: parseHexRgba(s.color),
  }));

  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    while (seg < parsed.length - 2 && t > parsed[seg + 1].offset) {
      seg++;
    }
    const a = parsed[seg];
    const b = parsed[Math.min(seg + 1, parsed.length - 1)];
    const span = b.offset - a.offset;
    const f = span > 1e-6 ? Math.max(0, Math.min(1, (t - a.offset) / span)) : 0;
    const base = i * 4;
    lut[base] = Math.round(a.rgba[0] + (b.rgba[0] - a.rgba[0]) * f);
    lut[base + 1] = Math.round(a.rgba[1] + (b.rgba[1] - a.rgba[1]) * f);
    lut[base + 2] = Math.round(a.rgba[2] + (b.rgba[2] - a.rgba[2]) * f);
    lut[base + 3] = Math.round(a.rgba[3] + (b.rgba[3] - a.rgba[3]) * f);
  }
  return lut;
}

const DEFAULT_PALETTE = buildHeatmapPalette();

/**
 * Packs heatmap points into 32-bit (Float32Array) or 16-bit (Int16Array) buffers
 * in a single pass and uploads coordinates to the WASM static arena.
 */
export function packHeatmapPoints(
  points: readonly HeatmapPoint[],
  precision: CoordPrecision = 32
): HeatmapBuffers {
  const count = points.length;
  let hasCustomWeight = false;
  const { lats, lons } = packLatLon(points, precision, (_i, p) => {
    if (p.weight !== undefined && p.weight !== 1) {
      hasCustomWeight = true;
    }
  });

  let weights: Float32Array | null = null;
  if (hasCustomWeight) {
    weights = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      weights[i] = points[i].weight ?? 1;
    }
  }

  return {
    count,
    lats,
    lons,
    weights,
    times: null,
    precision,
    staticHandle: count > 0 ? uploadStaticPoints(lats, lons, count) : null,
  };
}

/**
 * Wraps pre-packed SoA TypedArrays directly (zero object allocations) for 24h streaming/binary data.
 */
export function packHeatmapArrays(input: {
  lats: Float32Array | Int16Array;
  lons: Float32Array | Int16Array;
  weights?: Float32Array | Uint16Array | null;
  times?: Uint16Array | null;
  count?: number;
}): HeatmapBuffers {
  const count = Math.min(
    input.count ?? input.lats.length,
    input.lats.length,
    input.lons.length
  );
  const precision: CoordPrecision =
    input.lats instanceof Int16Array && input.lons instanceof Int16Array
      ? 16
      : 32;
  return {
    count,
    lats: input.lats,
    lons: input.lons,
    weights: input.weights ?? null,
    times: input.times ?? null,
    precision,
    staticHandle:
      count > 0 ? uploadStaticPoints(input.lats, input.lons, count) : null,
  };
}

/**
 * Binary-searches a time-sorted `Uint16Array` (`times`) to return a zero-copy [startIndex, count] slice.
 */
export function sliceHeatmapByTime(
  buffers: HeatmapBuffers,
  startTime: number,
  endTime: number
): { startIndex: number; count: number } {
  const times = buffers.times;
  const total = buffers.count;
  if (!times || total <= 0 || startTime > endTime) {
    return { startIndex: 0, count: times ? 0 : total };
  }
  const n = Math.min(total, times.length);
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < startTime) lo = mid + 1;
    else hi = mid;
  }
  const startIndex = lo;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= endTime) lo = mid + 1;
    else hi = mid;
  }
  return { startIndex, count: Math.max(0, lo - startIndex) };
}

interface WasmHeatmapRenderResult {
  gridW: number;
  gridH: number;
  cells: number;
  rt: WasmRuntime;
  outRgbaOff: number;
}

function renderHeatmapToWasm(
  buffers: HeatmapBuffers,
  viewport: Viewport,
  options: HeatmapOptions
): WasmHeatmapRenderResult | null {
  const s = viewport.getState();
  if (buffers.count <= 0 || s.width <= 0 || s.height <= 0) return null;

  const radiusPx = Math.max(2, options.radiusPx ?? 24);
  const gridScale = Math.max(0.05, Math.min(1, options.gridScale ?? 0.25));
  const maxIntensity = Math.max(1e-4, options.maxIntensity ?? 3);
  const palette = options.palette ?? DEFAULT_PALETTE;
  if (palette.length < 1024) return null;

  let startIndex = 0;
  let sliceCount = buffers.count;
  if (options.timeRange && buffers.times) {
    const slice = sliceHeatmapByTime(
      buffers,
      options.timeRange[0],
      options.timeRange[1]
    );
    startIndex = slice.startIndex;
    sliceCount = slice.count;
  }
  if (sliceCount <= 0) return null;

  const gridW = Math.max(1, Math.ceil(s.width * gridScale));
  const gridH = Math.max(1, Math.ceil(s.height * gridScale));
  const radiusGrid = Math.max(
    1,
    Math.min(128, Math.ceil(radiusPx * gridScale))
  );

  const handle = resolveStaticPointsHandle(
    buffers.lats,
    buffers.lons,
    buffers.count,
    buffers.staticHandle
  );
  if (handle) {
    buffers.staticHandle = handle;
  }
  const target = handle ?? buffers;

  const projected = projectPointsToScratch(
    target,
    viewport,
    radiusPx,
    startIndex,
    sliceCount
  );
  if (!projected) return null;

  const { rt, visible, outXYFloatBase, outIdxIntBase } = projected;
  const kernel = rt.exports.renderHeatmapGrid;
  if (!kernel) return null;

  const xyOff = outXYFloatBase << 2;
  const cells = gridW * gridH;
  const scratchEnd = (outIdxIntBase << 2) + sliceCount * 4;
  const weightsOff = buffers.weights && visible > 0 ? (scratchEnd + 3) & ~3 : 0;
  const afterWeights = weightsOff > 0 ? weightsOff + visible * 4 : scratchEnd;
  const lutOff = (afterWeights + 3) & ~3;
  const densityOff = lutOff + 1024;
  const outRgbaOff = densityOff + cells * 4;
  const totalBytes = outRgbaOff + cells * 4;

  if (!rt.ensureCapacity(totalBytes)) return null;

  if (weightsOff > 0 && buffers.weights) {
    const wBase = weightsOff >> 2;
    const idxView = rt.i32;
    const f32View = rt.f32;
    for (let i = 0; i < visible; i++) {
      f32View[wBase + i] =
        buffers.weights[startIndex + idxView[outIdxIntBase + i]] ?? 1;
    }
  }

  rt.u8.set(palette.subarray(0, 1024), lutOff);

  const written = kernel(
    visible,
    xyOff,
    weightsOff,
    gridW,
    gridH,
    gridScale,
    radiusGrid,
    1 / maxIntensity,
    densityOff,
    lutOff,
    outRgbaOff
  );
  if (written <= 0) return null;

  return { gridW, gridH, cells, rt, outRgbaOff };
}

/**
 * Renders a zero-allocation WASM downsampled heatmap onto a 2D Canvas context.
 */
export function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  buffers: HeatmapBuffers,
  viewport: Viewport,
  options: HeatmapOptions = {},
  scratch: HeatmapScratch = {}
): boolean {
  const res = renderHeatmapToWasm(buffers, viewport, options);
  if (!res) return false;

  const { gridW, gridH, cells, rt, outRgbaOff } = res;
  if (!scratch.offscreen && typeof document !== 'undefined') {
    scratch.offscreen = document.createElement('canvas');
    scratch.offCtx = scratch.offscreen.getContext('2d');
  }
  const offCanvas = scratch.offscreen;
  const offCtx = scratch.offCtx;
  if (!offCanvas || !offCtx) return false;

  if (offCanvas.width !== gridW || offCanvas.height !== gridH) {
    offCanvas.width = gridW;
    offCanvas.height = gridH;
    scratch.imageData = offCtx.createImageData(gridW, gridH);
  }
  const imgData = scratch.imageData ?? offCtx.createImageData(gridW, gridH);
  scratch.imageData = imgData;
  imgData.data.set(rt.u8.subarray(outRgbaOff, outRgbaOff + cells * 4));
  offCtx.putImageData(imgData, 0, 0);

  const s = viewport.getState();
  ctx.save();
  ctx.globalAlpha = options.opacity ?? 0.85;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offCanvas, 0, 0, s.width, s.height);
  ctx.restore();
  return true;
}

import {
  type CoordPrecision,
  type StaticPointsHandle,
  packLatLon,
  projectPointsToScratch,
  resolveStaticPointsHandle,
  uploadStaticPoints,
} from './batch';
import {
  type Point2D,
  type WrappedSlice,
  getWrappedSlices,
} from './projection';
import { type Viewport } from './viewport';
import { getWasmRuntime, type WasmRuntime } from '../wasm/bridge';

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
  /** Maximum finite positive weight across the dataset (1 when unweighted). */
  maxWeight?: number;
  staticHandle?: StaticPointsHandle | null;
}

export type HeatmapIntensityMode = 'sqrt' | 'linear';
export type HeatmapKernelType = 'gaussian' | 'quartic';
export type HeatmapMaxIntensity = number | 'auto' | 'global' | 'viewport';

export interface HeatmapOptions {
  /** Influence radius in CSS pixels (screen-space KDE; default: 24). */
  radiusPx?: number;
  /** Downsample factor in (0, 1] for pixel matrix grid (default: 0.25). */
  gridScale?: number;
  /**
   * Density value mapped to max palette color (default: 'global').
   * - `'global'` (and `'auto'`): uses `buffers.maxWeight` so colors stay stable while panning.
   * - `'viewport'`: adapts to the current viewport grid peak for maximum local contrast.
   * - `number`: fixed absolute density cap (ideal for cross-frame timeline comparison).
   */
  maxIntensity?: HeatmapMaxIntensity;
  /** Nonlinear intensity curve: 'sqrt' (default) for balanced hotspots, or 'linear'. */
  intensityMode?: HeatmapIntensityMode;
  /** Radial density kernel: 'gaussian' (default) or 'quartic'. */
  kernel?: HeatmapKernelType;
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
  { offset: 0.0, color: '#0ea5e900' },
  { offset: 0.12, color: '#0ea5e966' },
  { offset: 0.38, color: '#22c55ebb' },
  { offset: 0.68, color: '#facc15ee' },
  { offset: 1.0, color: '#ef4444ff' },
];

const KERNEL_LUT_LEN = 128;
const KERNEL_SCRATCH_FLOATS = 129; // accommodates 128-entry 2D LUT or 0..128 1D Gaussian weights

function buildKernelLut(kind: HeatmapKernelType): Float32Array {
  const lut = new Float32Array(KERNEL_LUT_LEN);
  const k = 3.125; // sigma = R / 2.5
  const expNegK = Math.exp(-k);
  const invNorm = 1 / (1 - expNegK);
  for (let i = 0; i < KERNEL_LUT_LEN; i++) {
    const u = i / (KERNEL_LUT_LEN - 1);
    if (kind === 'quartic') {
      const t = 1 - u;
      lut[i] = t * t;
    } else {
      lut[i] = Math.max(0, (Math.exp(-k * u) - expNegK) * invNorm);
    }
  }
  return lut;
}

const GAUSSIAN_KERNEL_LUT = buildKernelLut('gaussian');
const QUARTIC_KERNEL_LUT = buildKernelLut('quartic');
const GAUSSIAN_1D_BUF = new Float32Array(KERNEL_SCRATCH_FLOATS);
let last1DRadius = -1;

function getGaussian1D(radiusGrid: number): Float32Array {
  if (last1DRadius === radiusGrid) return GAUSSIAN_1D_BUF;
  last1DRadius = radiusGrid;
  const rInt = Math.max(1, Math.min(128, Math.ceil(radiusGrid)));
  const invRSq = 1 / (radiusGrid * radiusGrid);
  GAUSSIAN_1D_BUF[0] = 1;
  for (let d = 1; d <= rInt; d++) {
    GAUSSIAN_1D_BUF[d] = Math.exp(-3.125 * d * d * invRSq);
  }
  return GAUSSIAN_1D_BUF;
}

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
    const aRgb = a.rgba[3] === 0 && b.rgba[3] > 0 ? b.rgba : a.rgba;
    const bRgb = b.rgba[3] === 0 && a.rgba[3] > 0 ? a.rgba : b.rgba;
    lut[base] = Math.round(aRgb[0] + (bRgb[0] - aRgb[0]) * f);
    lut[base + 1] = Math.round(aRgb[1] + (bRgb[1] - aRgb[1]) * f);
    lut[base + 2] = Math.round(aRgb[2] + (bRgb[2] - aRgb[2]) * f);
    lut[base + 3] = Math.round(a.rgba[3] + (b.rgba[3] - a.rgba[3]) * f);
  }
  return lut;
}

const DEFAULT_PALETTE = buildHeatmapPalette();

function computeMaxWeight(
  weights: Float32Array | Uint16Array | null,
  count: number
): number {
  if (!weights || count <= 0) return 1;
  const n = Math.min(count, weights.length);
  let maxW = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    if (Number.isFinite(w) && w > maxW) {
      maxW = w;
    }
  }
  return maxW > 0 ? maxW : 1;
}

function buildHeatmapBuffers(
  lats: Float32Array | Int16Array,
  lons: Float32Array | Int16Array,
  weights: Float32Array | Uint16Array | null,
  times: Uint16Array | null,
  count: number,
  precision: CoordPrecision,
  maxWeight: number
): HeatmapBuffers {
  return {
    count,
    lats,
    lons,
    weights,
    times,
    precision,
    maxWeight: maxWeight > 0 ? maxWeight : 1,
    staticHandle: count > 0 ? uploadStaticPoints(lats, lons, count) : null,
  };
}

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
  let allU16Weights = precision === 16;
  let maxWeight = 0;
  const { lats, lons } = packLatLon(points, precision, (_i, p) => {
    const w = p.weight ?? 1;
    if (p.weight !== undefined && p.weight !== 1) {
      hasCustomWeight = true;
    }
    if (allU16Weights && (!Number.isInteger(w) || w < 0 || w > 65535)) {
      allU16Weights = false;
    }
    if (Number.isFinite(w) && w > maxWeight) {
      maxWeight = w;
    }
  });

  let weights: Float32Array | Uint16Array | null = null;
  if (hasCustomWeight) {
    weights = allU16Weights ? new Uint16Array(count) : new Float32Array(count);
    for (let i = 0; i < count; i++) {
      weights[i] = points[i].weight ?? 1;
    }
  }

  return buildHeatmapBuffers(
    lats,
    lons,
    weights,
    null,
    count,
    precision,
    maxWeight
  );
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
  const weights = input.weights ?? null;
  return buildHeatmapBuffers(
    input.lats,
    input.lons,
    weights,
    input.times ?? null,
    count,
    precision,
    computeMaxWeight(weights, count)
  );
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

interface ResolvedHeatmapConfig {
  radiusPx: number;
  gridW: number;
  gridH: number;
  scaleX: number;
  scaleY: number;
  radiusGrid: number;
  invMaxIntensity: number;
  intensityModeFlag: number;
  isGaussian: boolean;
  kernelLut: Float32Array;
  palette: Uint8Array;
}

function resolveInvMaxIntensity(
  maxIntensity: HeatmapMaxIntensity | undefined,
  globalMaxWeight: number
): number {
  if (maxIntensity === 'viewport') return 0;
  if (typeof maxIntensity === 'number') {
    return 1 / Math.max(1e-4, maxIntensity);
  }
  return 1 / Math.max(1e-4, globalMaxWeight);
}

function resolveHeatmapConfig(
  options: HeatmapOptions,
  width: number,
  height: number,
  globalMaxWeight: number
): ResolvedHeatmapConfig | null {
  const palette = options.palette ?? DEFAULT_PALETTE;
  if (palette.length < 1024) return null;

  const radiusPx = Math.max(2, options.radiusPx ?? 24);
  const gridScale = Math.max(0.05, Math.min(1, options.gridScale ?? 0.25));
  const gridW = Math.max(1, Math.ceil(width * gridScale));
  const gridH = Math.max(1, Math.ceil(height * gridScale));
  const scaleX = gridW / width;
  const scaleY = gridH / height;

  return {
    radiusPx,
    gridW,
    gridH,
    scaleX,
    scaleY,
    radiusGrid: Math.max(1, Math.min(128, radiusPx * Math.min(scaleX, scaleY))),
    invMaxIntensity: resolveInvMaxIntensity(
      options.maxIntensity,
      globalMaxWeight
    ),
    intensityModeFlag: (options.intensityMode ?? 'sqrt') === 'linear' ? 0 : 1,
    isGaussian: (options.kernel ?? 'gaussian') !== 'quartic',
    kernelLut:
      (options.kernel ?? 'gaussian') === 'quartic'
        ? QUARTIC_KERNEL_LUT
        : GAUSSIAN_KERNEL_LUT,
    palette,
  };
}

interface StagedHeatmapInput {
  rt: WasmRuntime;
  visible: number;
  xyOff: number;
  weightsOff: number;
  afterWeights: number;
  fromJsStaging: boolean;
  outIdxIntBase: number;
}

const TMP_HEAT_PT: Point2D = { x: 0, y: 0 };
let heatXYBuf = new Float32Array(256);
let heatWBuf = new Float32Array(128);

function growF32(buf: Float32Array, needed: number): Float32Array<ArrayBuffer> {
  let next = buf.length;
  while (next < needed) next *= 2;
  const out = new Float32Array(next);
  out.set(buf);
  return out;
}

function ensureHeatStagingCapacity(neededPoints: number): void {
  if (neededPoints * 2 > heatXYBuf.length) {
    heatXYBuf = growF32(heatXYBuf, neededPoints * 2);
  }
  if (neededPoints > heatWBuf.length) {
    heatWBuf = growF32(heatWBuf, neededPoints);
  }
}

function stageSingleMercatorPoints(
  buffers: HeatmapBuffers,
  viewport: Viewport,
  radiusPx: number,
  startIndex: number,
  sliceCount: number
): StagedHeatmapInput | null {
  const handle = resolveStaticPointsHandle(
    buffers.lats,
    buffers.lons,
    buffers.count,
    buffers.staticHandle
  );
  if (handle) buffers.staticHandle = handle;

  const projected = projectPointsToScratch(
    handle ?? buffers,
    viewport,
    radiusPx,
    startIndex,
    sliceCount
  );
  if (!projected) return null;

  const { rt, visible, outXYFloatBase, outIdxIntBase } = projected;
  const scratchEnd = (outIdxIntBase << 2) + sliceCount * 4;
  const weightsOff = buffers.weights && visible > 0 ? (scratchEnd + 3) & ~3 : 0;
  const afterWeights = weightsOff > 0 ? weightsOff + visible * 4 : scratchEnd;
  return {
    rt,
    visible,
    xyOff: outXYFloatBase << 2,
    weightsOff,
    afterWeights,
    fromJsStaging: false,
    outIdxIntBase,
  };
}

function stageWrappedOrCustomPoints(
  buffers: HeatmapBuffers,
  viewport: Viewport,
  slices: readonly WrappedSlice[],
  radiusPx: number,
  startIndex: number,
  sliceCount: number
): StagedHeatmapInput | null {
  const rt = getWasmRuntime();
  if (!rt) return null;

  const s = viewport.getState();
  const latScale = buffers.precision === 16 ? 90 / 32767 : 1;
  const lonScale = buffers.precision === 16 ? 180 / 32767 : 1;
  const minX = -radiusPx;
  const minY = -radiusPx;
  const maxX = s.width + radiusPx;
  const maxY = s.height + radiusPx;
  const weights = buffers.weights;

  let visible = 0;
  const end = startIndex + sliceCount;
  for (let i = startIndex; i < end; i++) {
    viewport.projectInto(
      buffers.lats[i] * latScale,
      buffers.lons[i] * lonScale,
      TMP_HEAT_PT
    );
    const sy = TMP_HEAT_PT.y;
    if (sy < minY || sy > maxY) continue;
    const w = weights ? (weights[i] ?? 1) : 1;
    for (const slice of slices) {
      const sx = TMP_HEAT_PT.x + slice.wrapShiftPx;
      if (sx < minX || sx > maxX) continue;
      if ((visible + 1) * 2 > heatXYBuf.length) {
        ensureHeatStagingCapacity(visible + 1);
      }
      heatXYBuf[visible * 2] = sx;
      heatXYBuf[visible * 2 + 1] = sy;
      if (weights) heatWBuf[visible] = w;
      visible++;
    }
  }

  const xyOff = rt.getScratchBase();
  const afterXY = xyOff + visible * 8;
  const weightsOff = weights && visible > 0 ? (afterXY + 3) & ~3 : 0;
  const afterWeights = weightsOff > 0 ? weightsOff + visible * 4 : afterXY;
  return {
    rt,
    visible,
    xyOff,
    weightsOff,
    afterWeights,
    fromJsStaging: true,
    outIdxIntBase: 0,
  };
}

function stageProjectedHeatmapPoints(
  buffers: HeatmapBuffers,
  viewport: Viewport,
  slices: readonly WrappedSlice[],
  radiusPx: number,
  startIndex: number,
  sliceCount: number
): StagedHeatmapInput | null {
  if (
    viewport.getProjection().id === 'mercator' &&
    slices.length === 1 &&
    slices[0].wrapShiftPx === 0
  ) {
    return stageSingleMercatorPoints(
      buffers,
      viewport,
      radiusPx,
      startIndex,
      sliceCount
    );
  }
  return stageWrappedOrCustomPoints(
    buffers,
    viewport,
    slices,
    radiusPx,
    startIndex,
    sliceCount
  );
}

function renderHeatmapToWasm(
  buffers: HeatmapBuffers,
  viewport: Viewport,
  options: HeatmapOptions
): WasmHeatmapRenderResult | null {
  const s = viewport.getState();
  if (buffers.count <= 0 || s.width <= 0 || s.height <= 0) return null;

  const cfg = resolveHeatmapConfig(
    options,
    s.width,
    s.height,
    buffers.maxWeight ?? 1
  );
  if (!cfg) return null;

  const slice =
    options.timeRange && buffers.times
      ? sliceHeatmapByTime(buffers, options.timeRange[0], options.timeRange[1])
      : { startIndex: 0, count: buffers.count };
  if (slice.count <= 0) return null;

  const { slices } = getWrappedSlices(s, 2, viewport.getProjection());
  const staged = stageProjectedHeatmapPoints(
    buffers,
    viewport,
    slices,
    cfg.radiusPx,
    slice.startIndex,
    slice.count
  );
  if (!staged) return null;

  const { rt, visible, xyOff, weightsOff, afterWeights } = staged;
  const kernel = rt.exports.renderHeatmapGrid;
  if (!kernel) return null;

  const cells = cfg.gridW * cfg.gridH;
  const kernelLutOff = (afterWeights + 3) & ~3;
  const lutOff = kernelLutOff + KERNEL_SCRATCH_FLOATS * 4;
  const densityOff = lutOff + 1024;
  const outRgbaOff = densityOff + cells * 4;
  if (!rt.ensureCapacity(outRgbaOff + cells * 4)) return null;

  if (!staged.fromJsStaging && weightsOff > 0 && buffers.weights) {
    const wBase = weightsOff >> 2;
    for (let i = 0; i < visible; i++) {
      rt.f32[wBase + i] =
        buffers.weights[slice.startIndex + rt.i32[staged.outIdxIntBase + i]] ??
        1;
    }
  } else if (staged.fromJsStaging && visible > 0) {
    rt.f32.set(heatXYBuf.subarray(0, visible * 2), xyOff >> 2);
    if (weightsOff > 0) {
      rt.f32.set(heatWBuf.subarray(0, visible), weightsOff >> 2);
    }
  }

  const rInt = Math.max(1, Math.ceil(cfg.radiusGrid));
  const useSeparable = cfg.isGaussian && visible * (rInt * 2 + 1) > cells * 2;
  const activeLut = useSeparable
    ? getGaussian1D(cfg.radiusGrid)
    : cfg.kernelLut;
  const modeBits = useSeparable
    ? cfg.intensityModeFlag | 2
    : cfg.intensityModeFlag;

  rt.f32.set(activeLut, kernelLutOff >> 2);
  rt.u8.set(cfg.palette.subarray(0, 1024), lutOff);

  const written = kernel(
    visible,
    xyOff,
    weightsOff,
    cfg.gridW,
    cfg.gridH,
    cfg.scaleX,
    cfg.scaleY,
    cfg.radiusGrid,
    cfg.invMaxIntensity,
    modeBits,
    kernelLutOff,
    densityOff,
    lutOff,
    outRgbaOff
  );
  if (written <= 0) return null;

  return { gridW: cfg.gridW, gridH: cfg.gridH, cells, rt, outRgbaOff };
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

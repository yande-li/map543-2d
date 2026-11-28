import {
  type CoordPrecision,
  type StaticPointsHandle,
  quantize16,
  resolveStaticPointsHandle,
  uploadStaticPoints,
} from './batch';
import { traceArc } from './curves';
import { type Point2D, getWrappedSlices } from './projection';
import { type TrajectoryItem } from './trajectory';
import { type Viewport } from './viewport';
import {
  LUT_OFFSET_BYTES,
  getWasmRuntime,
  stageTypedCoordPair,
  type WasmRuntime,
} from '../wasm/bridge';

/**
 * Creates a small offscreen radial-gradient dot sprite for fast Canvas blitting.
 */
export function createGlowDotSprite(
  color: string,
  size = 10,
  innerColor = '#ffffff'
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const sctx = sprite.getContext('2d');
  if (!sctx) return null;

  const half = size / 2;
  const grad = sctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(0.22, color);
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, 'transparent');

  sctx.fillStyle = grad;
  sctx.beginPath();
  sctx.arc(half, half, half, 0, Math.PI * 2);
  sctx.fill();
  return sprite;
}

interface ParsedTrajectoryArgs {
  dstArray: Float32Array | null;
  singleDstX: number;
  singleDstY: number;
  viewportW: number;
  viewportH: number;
  color: string;
  sprite: HTMLCanvasElement | null;
  margin: number;
  straightLimit: number;
}

function parseTrajectoryArgs(
  dstXOrXY: number | Float32Array,
  dstYOrViewportW: number,
  viewportWOrH: number,
  viewportHOrColor?: number | string,
  colorOrSprite?: string | HTMLCanvasElement | null,
  spriteOrMargin?: HTMLCanvasElement | null | number,
  marginOrStraightThreshold?: number,
  straightThreshold = 100
): ParsedTrajectoryArgs {
  if (typeof dstXOrXY === 'number') {
    return {
      dstArray: null,
      singleDstX: dstXOrXY,
      singleDstY: dstYOrViewportW,
      viewportW: viewportWOrH,
      viewportH: viewportHOrColor as number,
      color: (colorOrSprite as string | undefined) ?? '#0ebf9c',
      sprite: (spriteOrMargin as HTMLCanvasElement | null | undefined) ?? null,
      margin: marginOrStraightThreshold ?? 50,
      straightLimit: straightThreshold,
    };
  }
  return {
    dstArray: dstXOrXY,
    singleDstX: 0,
    singleDstY: 0,
    viewportW: dstYOrViewportW,
    viewportH: viewportWOrH,
    color: (viewportHOrColor as string | undefined) ?? '#0ebf9c',
    sprite: (colorOrSprite as HTMLCanvasElement | null | undefined) ?? null,
    margin: typeof spriteOrMargin === 'number' ? spriteOrMargin : 50,
    straightLimit: marginOrStraightThreshold ?? straightThreshold,
  };
}

function beginArcPass(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
}

function strokeArcPass(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 3.5;
  ctx.globalAlpha = 0.14;
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.72;
  ctx.stroke();
}

function beginDotPass(
  ctx: CanvasRenderingContext2D,
  color: string,
  sprite: HTMLCanvasElement | null
): number {
  if (sprite) {
    ctx.globalAlpha = 0.9;
    return sprite.width / 2;
  }
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  return 2;
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  half: number,
  sprite: HTMLCanvasElement | null
): void {
  if (sprite) {
    ctx.drawImage(sprite, x - half, y - half);
  } else {
    ctx.rect(x - half, y - half, 4, 4);
  }
}

function drawStridedSourceDots(
  ctx: CanvasRenderingContext2D,
  xy: Float32Array,
  count: number,
  stride: number,
  floatBase: number,
  wrapShiftPx: number,
  color: string,
  sprite: HTMLCanvasElement | null,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): void {
  const half = beginDotPass(ctx, color, sprite);
  for (let i = 0; i < count; i++) {
    const base = floatBase + i * stride;
    const srcX = xy[base] + wrapShiftPx;
    const srcY = xy[base + 1];
    if (srcX < minX || srcX > maxX || srcY < minY || srcY > maxY) continue;
    drawDot(ctx, srcX, srcY, half, sprite);
  }
  if (!sprite) ctx.fill();
}

type TrajectoryStyleArgs = [
  color?: string,
  sprite?: HTMLCanvasElement | null,
  margin?: number,
  straightThreshold?: number,
];

/**
 * Draws a batch of screen-space quadratic Bezier trajectories (shared destination point).
 */
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  srcXY: Float32Array,
  count: number,
  dstX: number,
  dstY: number,
  viewportW: number,
  viewportH: number,
  ...style: TrajectoryStyleArgs
): void;
/**
 * Multi-to-multi overload (per-trajectory destination coordinates in `dstXY`).
 */
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  srcXY: Float32Array,
  count: number,
  dstXY: Float32Array,
  viewportW: number,
  viewportH: number,
  ...style: TrajectoryStyleArgs
): void;
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  srcXY: Float32Array,
  count: number,
  dstXOrXY: number | Float32Array,
  dstYOrViewportW: number,
  viewportWOrH: number,
  viewportHOrColor?: number | string,
  colorOrSprite?: string | HTMLCanvasElement | null,
  spriteOrMargin?: HTMLCanvasElement | null | number,
  marginOrStraightThreshold?: number,
  straightThreshold = 100
): void {
  if (count <= 0) return;

  const {
    dstArray,
    singleDstX,
    singleDstY,
    viewportW,
    viewportH,
    color,
    sprite,
    margin,
    straightLimit,
  } = parseTrajectoryArgs(
    dstXOrXY,
    dstYOrViewportW,
    viewportWOrH,
    viewportHOrColor,
    colorOrSprite,
    spriteOrMargin,
    marginOrStraightThreshold,
    straightThreshold
  );

  const minX = -margin;
  const minY = -margin;
  const maxX = viewportW + margin;
  const maxY = viewportH + margin;
  const singleDstIn =
    dstArray === null &&
    singleDstX >= minX &&
    singleDstX <= maxX &&
    singleDstY >= minY &&
    singleDstY <= maxY;

  beginArcPass(ctx, color);

  for (let i = 0; i < count; i++) {
    const srcX = srcXY[i * 2];
    const srcY = srcXY[i * 2 + 1];
    const targetX = dstArray !== null ? dstArray[i * 2] : singleDstX;
    const targetY = dstArray !== null ? dstArray[i * 2 + 1] : singleDstY;

    const srcIn = srcX >= minX && srcX <= maxX && srcY >= minY && srcY <= maxY;
    const dstIn =
      dstArray !== null
        ? targetX >= minX &&
          targetX <= maxX &&
          targetY >= minY &&
          targetY <= maxY
        : singleDstIn;

    if (!srcIn && !dstIn) continue;

    ctx.moveTo(srcX, srcY);
    traceArc(ctx, srcX, srcY, targetX, targetY, straightLimit);
  }

  strokeArcPass(ctx);

  drawStridedSourceDots(
    ctx,
    srcXY,
    count,
    2,
    0,
    0,
    color,
    sprite,
    minX,
    minY,
    maxX,
    maxY
  );
}

export interface TrajectoryBuffers {
  count: number;
  srcLats: Float32Array | Int16Array;
  srcLons: Float32Array | Int16Array;
  dstLats: Float32Array | Int16Array;
  dstLons: Float32Array | Int16Array;
  precision: CoordPrecision;
  staticSrcHandle?: StaticPointsHandle | null;
  staticDstHandle?: StaticPointsHandle | null;
}

export interface DrawBatchTrajectoriesOptions {
  color?: string;
  sprite?: HTMLCanvasElement | null;
  margin?: number;
  straightThreshold?: number;
}

function writeCoordPair(
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
 * Packs trajectory items into 32-bit or 16-bit SoA buffers and uploads endpoints to the WASM static arena.
 */
export function packTrajectories(
  items: readonly TrajectoryItem[],
  precision: CoordPrecision = 32
): TrajectoryBuffers {
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].curve !== 'none') count++;
  }
  const use16 = precision === 16;
  const srcLats = use16 ? new Int16Array(count) : new Float32Array(count);
  const srcLons = use16 ? new Int16Array(count) : new Float32Array(count);
  const dstLats = use16 ? new Int16Array(count) : new Float32Array(count);
  const dstLons = use16 ? new Int16Array(count) : new Float32Array(count);

  let out = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.curve === 'none') continue;
    const sLat = item.src?.[0] ?? item.srcLat ?? 0;
    const sLon = item.src?.[1] ?? item.srcLon ?? 0;
    const dLat = item.dst?.[0] ?? item.dstLat ?? 0;
    const dLon = item.dst?.[1] ?? item.dstLon ?? 0;
    if (item.isReversed) {
      writeCoordPair(srcLats, srcLons, out, dLat, dLon, use16);
      writeCoordPair(dstLats, dstLons, out, sLat, sLon, use16);
    } else {
      writeCoordPair(srcLats, srcLons, out, sLat, sLon, use16);
      writeCoordPair(dstLats, dstLons, out, dLat, dLon, use16);
    }
    out++;
  }

  return packTrajectoryArrays({ srcLats, srcLons, dstLats, dstLons, count });
}

/**
 * Wraps pre-packed SoA trajectory endpoint TypedArrays directly (zero object allocations).
 */
export function packTrajectoryArrays(input: {
  srcLats: Float32Array | Int16Array;
  srcLons: Float32Array | Int16Array;
  dstLats: Float32Array | Int16Array;
  dstLons: Float32Array | Int16Array;
  count?: number;
}): TrajectoryBuffers {
  const count = Math.max(
    0,
    Math.min(
      input.count ?? input.srcLats.length,
      input.srcLats.length,
      input.srcLons.length,
      input.dstLats.length,
      input.dstLons.length
    )
  );
  const precision: CoordPrecision =
    input.srcLats instanceof Int16Array &&
    input.srcLons instanceof Int16Array &&
    input.dstLats instanceof Int16Array &&
    input.dstLons instanceof Int16Array
      ? 16
      : 32;
  return {
    count,
    srcLats: input.srcLats,
    srcLons: input.srcLons,
    dstLats: input.dstLats,
    dstLons: input.dstLons,
    precision,
    staticSrcHandle:
      count > 0
        ? uploadStaticPoints(input.srcLats, input.srcLons, count)
        : null,
    staticDstHandle:
      count > 0
        ? uploadStaticPoints(input.dstLats, input.dstLons, count)
        : null,
  };
}

function stageSegmentsToScratch(
  rt: WasmRuntime,
  buffers: TrajectoryBuffers,
  outBytes: number
): {
  sLatOff: number;
  sLonOff: number;
  dLatOff: number;
  dLonOff: number;
  outSegsOff: number;
} | null {
  const { count, precision } = buffers;
  const elemShift: 1 | 2 = precision === 16 ? 1 : 2;
  const inBytes = count << elemShift;
  const sLatOff = rt.getScratchBase();
  const sLonOff = sLatOff + inBytes;
  const dLatOff = sLonOff + inBytes;
  const dLonOff = dLatOff + inBytes;
  const outSegsOff = (dLonOff + inBytes + 3) & ~3;
  if (!rt.ensureCapacity(outSegsOff + outBytes)) return null;

  const is16 = precision === 16;
  stageTypedCoordPair(
    rt,
    buffers.srcLats,
    buffers.srcLons,
    count,
    sLatOff,
    sLonOff,
    is16
  );
  stageTypedCoordPair(
    rt,
    buffers.dstLats,
    buffers.dstLons,
    count,
    dLatOff,
    dLonOff,
    is16
  );
  return { sLatOff, sLonOff, dLatOff, dLonOff, outSegsOff };
}

function projectSegmentsToScratch(
  rt: WasmRuntime,
  buffers: TrajectoryBuffers,
  viewport: Viewport,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { visible: number; outFloatBase: number } | null {
  const { count, precision } = buffers;
  const kernel = rt.exports.batchProjectSegments;
  if (!kernel || count <= 0) return null;

  const srcH = resolveStaticPointsHandle(
    buffers.srcLats,
    buffers.srcLons,
    count,
    buffers.staticSrcHandle
  );
  const dstH = resolveStaticPointsHandle(
    buffers.dstLats,
    buffers.dstLons,
    count,
    buffers.staticDstHandle
  );
  if (srcH) buffers.staticSrcHandle = srcH;
  if (dstH) buffers.staticDstHandle = dstH;

  const outBytes = count * 16;
  let offs: ReturnType<typeof stageSegmentsToScratch>;
  if (
    srcH &&
    dstH &&
    srcH.epoch === rt.arenaEpoch &&
    dstH.epoch === rt.arenaEpoch
  ) {
    const outSegsOff = rt.getScratchBase();
    if (!rt.ensureCapacity(outSegsOff + outBytes)) return null;
    offs = {
      sLatOff: srcH.latsOffset,
      sLonOff: srcH.lonsOffset,
      dLatOff: dstH.latsOffset,
      dLonOff: dstH.lonsOffset,
      outSegsOff,
    };
  } else {
    offs = stageSegmentsToScratch(rt, buffers, outBytes);
    if (!offs) return null;
  }

  const p = viewport.getProjectionParams();
  const is16: 0 | 1 = precision === 16 ? 1 : 0;
  const visible = kernel(
    count,
    LUT_OFFSET_BYTES,
    offs.sLatOff,
    offs.sLonOff,
    offs.dLatOff,
    offs.dLonOff,
    offs.outSegsOff,
    p.centerNormX,
    p.centerNormY,
    p.worldSize,
    p.halfW,
    p.halfH,
    minX,
    minY,
    maxX,
    maxY,
    is16
  );
  return { visible, outFloatBase: offs.outSegsOff >> 2 };
}

function drawProjectedSegments(
  ctx: CanvasRenderingContext2D,
  f32: Float32Array,
  floatBase: number,
  visible: number,
  wrapShiftPx: number,
  color: string,
  sprite: HTMLCanvasElement | null,
  straightLimit: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): void {
  beginArcPass(ctx, color);
  for (let i = 0; i < visible; i++) {
    const base = floatBase + i * 4;
    const sx = f32[base] + wrapShiftPx;
    const sy = f32[base + 1];
    const dx = f32[base + 2] + wrapShiftPx;
    const dy = f32[base + 3];
    ctx.moveTo(sx, sy);
    traceArc(ctx, sx, sy, dx, dy, straightLimit);
  }
  strokeArcPass(ctx);

  drawStridedSourceDots(
    ctx,
    f32,
    visible,
    4,
    floatBase,
    wrapShiftPx,
    color,
    sprite,
    minX,
    minY,
    maxX,
    maxY
  );
}

const TMP_SRC_PT: Point2D = { x: 0, y: 0 };
const TMP_DST_PT: Point2D = { x: 0, y: 0 };
let nonMercSrcXY = new Float32Array(256);

function ensureNonMercSrcCapacity(neededFloats: number): void {
  if (neededFloats <= nonMercSrcXY.length) return;
  let next = nonMercSrcXY.length;
  while (next < neededFloats) next *= 2;
  const buf = new Float32Array(next);
  buf.set(nonMercSrcXY);
  nonMercSrcXY = buf;
}

function drawNonMercatorTrajectories(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  buffers: TrajectoryBuffers,
  wrapShiftPx: number,
  color: string,
  sprite: HTMLCanvasElement | null,
  straightLimit: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): void {
  const { count, srcLats, srcLons, dstLats, dstLons, precision } = buffers;
  const latScale = precision === 16 ? 90 / 32767 : 1;
  const lonScale = precision === 16 ? 180 / 32767 : 1;

  beginArcPass(ctx, color);
  let visibleDots = 0;
  for (let i = 0; i < count; i++) {
    viewport.projectInto(
      srcLats[i] * latScale,
      srcLons[i] * lonScale,
      TMP_SRC_PT
    );
    viewport.projectInto(
      dstLats[i] * latScale,
      dstLons[i] * lonScale,
      TMP_DST_PT
    );
    const sx = TMP_SRC_PT.x + wrapShiftPx;
    const sy = TMP_SRC_PT.y;
    const dx = TMP_DST_PT.x + wrapShiftPx;
    const dy = TMP_DST_PT.y;
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
      ensureNonMercSrcCapacity((visibleDots + 1) * 2);
      nonMercSrcXY[visibleDots * 2] = sx;
      nonMercSrcXY[visibleDots * 2 + 1] = sy;
      visibleDots++;
    }
    if (
      Math.max(sx, dx) < minX ||
      Math.min(sx, dx) > maxX ||
      Math.max(sy, dy) < minY ||
      Math.min(sy, dy) > maxY
    ) {
      continue;
    }
    ctx.moveTo(sx, sy);
    traceArc(ctx, sx, sy, dx, dy, straightLimit);
  }
  strokeArcPass(ctx);

  drawStridedSourceDots(
    ctx,
    nonMercSrcXY,
    visibleDots,
    2,
    0,
    0,
    color,
    sprite,
    minX,
    minY,
    maxX,
    maxY
  );
}

/**
 * Batch-projects 32/16-bit trajectories (via WASM for Mercator, or active projection
 * for Equirectangular/custom) with viewport culling and antimeridian wrap-around.
 */
export function drawBatchTrajectories(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  buffers: TrajectoryBuffers,
  options: DrawBatchTrajectoriesOptions = {}
): void {
  if (buffers.count <= 0) return;

  const s = viewport.getState();
  const color = options.color ?? '#0ebf9c';
  const sprite = options.sprite ?? null;
  const margin = options.margin ?? 50;
  const straightLimit = options.straightThreshold ?? 100;
  const minX = -margin;
  const minY = -margin;
  const maxX = s.width + margin;
  const maxY = s.height + margin;

  const projection = viewport.getProjection();
  const { slices } = getWrappedSlices(s, 2, projection);

  if (projection.id !== 'mercator') {
    for (const slice of slices) {
      drawNonMercatorTrajectories(
        ctx,
        viewport,
        buffers,
        slice.wrapShiftPx,
        color,
        sprite,
        straightLimit,
        minX,
        minY,
        maxX,
        maxY
      );
    }
    return;
  }

  const rt = getWasmRuntime();
  if (rt === null) return;

  for (const slice of slices) {
    const proj = projectSegmentsToScratch(
      rt,
      buffers,
      viewport,
      minX - slice.wrapShiftPx,
      minY,
      maxX - slice.wrapShiftPx,
      maxY
    );
    if (!proj || proj.visible <= 0) continue;
    drawProjectedSegments(
      ctx,
      rt.f32,
      proj.outFloatBase,
      proj.visible,
      slice.wrapShiftPx,
      color,
      sprite,
      straightLimit,
      minX,
      minY,
      maxX,
      maxY
    );
  }
}

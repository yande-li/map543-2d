import { type Point2D, getWrappedSlices } from './projection';
import { type Viewport } from './viewport';
import {
  type CoordPrecision,
  type StaticPointsHandle,
  packLatLon,
  projectPointsToScratch,
  resolveStaticPointsHandle,
  uploadStaticPoints,
} from './batch';
import { hitTestPoints } from './hitTest';
import { getWasmRuntime } from '../wasm/bridge';

export interface PointItem {
  lat: number;
  lon: number;
  radius: number;
  color: string;
  alpha?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface DrawBatchPointsOptions {
  /** Viewport culling margin in CSS pixels (default: 30). */
  margin?: number;
  /** Default stroke color for symbols without per-point `strokeColor`. */
  strokeColor?: string;
  /** Default stroke width in CSS pixels (default: 1 when strokeColor is set). */
  strokeWidth?: number;
  /** Draw larger circles beneath smaller ones to prevent occlusion (default: true). */
  sortByRadius?: boolean;
}

interface PointBucketStyle {
  color: string;
  alpha: number;
}

export interface PointBuffers {
  count: number;
  lats: Float32Array | Int16Array;
  lons: Float32Array | Int16Array;
  precision: CoordPrecision;
  palette?: PointBucketStyle[];
  bucketIds?: Uint16Array;
  staticHandle?: StaticPointsHandle | null;
}

export interface PointHitResult {
  point: PointItem;
  index: number;
}

export interface PointLayerHandle {
  hitTest: (x: number, y: number, radiusPx?: number) => PointHitResult | null;
  hitTestCenter: (radiusPx?: number) => PointHitResult | null;
}

/**
 * Performs nearest-point hit-testing against packed point buffers (using the WASM static arena when valid).
 */
export function hitTestPointBuffers(
  x: number,
  y: number,
  points: readonly PointItem[],
  spatial: PointBuffers,
  viewport: Viewport,
  radiusPx = 18
): PointHitResult | null {
  if (points.length === 0) return null;
  const rt = getWasmRuntime();
  const sh = spatial.staticHandle;
  const target = rt !== null && sh && sh.epoch === rt.arenaEpoch ? sh : spatial;
  const index = hitTestPoints(x, y, target, viewport, radiusPx);
  if (index < 0 || index >= points.length) return null;
  return { point: points[index], index };
}

export function packPoints(
  points: readonly PointItem[],
  precision: CoordPrecision = 32
): PointBuffers {
  const count = points.length;
  const palette: PointBucketStyle[] = [];
  const paletteIndex = new Map<string, number>();
  const bucketIds = new Uint16Array(count);

  const assignBucket = (i: number) => {
    const p = points[i];
    const alpha = p.alpha ?? 0.7;
    const qAlphaStep = (alpha * 20 + 0.5) | 0;
    const key = `${p.color}|${qAlphaStep}`;
    let bid = paletteIndex.get(key);
    if (bid === undefined) {
      bid = palette.length;
      paletteIndex.set(key, bid);
      palette.push({ color: p.color, alpha: qAlphaStep * 0.05 });
    }
    bucketIds[i] = bid;
  };

  const { lats, lons } = packLatLon(points, precision, assignBucket);

  return {
    count,
    lats,
    lons,
    precision,
    palette,
    bucketIds,
    staticHandle: uploadStaticPoints(lats, lons, count),
  };
}

function getValidStaticHandle(
  spatial: PointBuffers
): StaticPointsHandle | null {
  const next = resolveStaticPointsHandle(
    spatial.lats,
    spatial.lons,
    spatial.count,
    spatial.staticHandle
  );
  spatial.staticHandle = next;
  return next;
}

const TWO_PI = Math.PI * 2;
const reusableOrder: number[] = [];
const reusableXY: number[] = [];
const TMP_PT: Point2D = { x: 0, y: 0 };

function resolveDrawPointOptions(
  marginOrOptions: number | DrawBatchPointsOptions
): {
  margin: number;
  defaultStrokeColor: string | undefined;
  defaultStrokeWidth: number;
  sortByRadius: boolean;
} {
  if (typeof marginOrOptions === 'number') {
    return {
      margin: marginOrOptions,
      defaultStrokeColor: undefined,
      defaultStrokeWidth: 1,
      sortByRadius: true,
    };
  }
  return {
    margin: marginOrOptions.margin ?? 30,
    defaultStrokeColor: marginOrOptions.strokeColor,
    defaultStrokeWidth: marginOrOptions.strokeWidth ?? 1,
    sortByRadius: marginOrOptions.sortByRadius ?? true,
  };
}

function drawSymbolsPass(
  ctx: CanvasRenderingContext2D,
  points: readonly PointItem[],
  order: readonly number[],
  count: number,
  xySource: Float32Array | readonly number[],
  xyBase: number,
  wrapShiftPx: number,
  defaultStrokeColor: string | undefined,
  defaultStrokeWidth: number
): void {
  let lastFill = '';
  let lastAlpha = -1;
  let lastStroke = '';
  let lastLineWidth = -1;

  for (let i = 0; i < count; i++) {
    const k = order[i];
    const p = points[k >= 0 ? k : 0];
    if (!p || !(p.radius > 0)) continue;
    const xyIdx = xyBase + i * 2;
    const cx = xySource[xyIdx] + wrapShiftPx;
    const cy = xySource[xyIdx + 1];
    const r = p.radius;
    const alpha = p.alpha ?? 0.7;

    if (p.color !== lastFill) {
      ctx.fillStyle = p.color;
      lastFill = p.color;
    }
    if (alpha !== lastAlpha) {
      ctx.globalAlpha = alpha;
      lastAlpha = alpha;
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.fill();

    const stroke = p.strokeColor ?? defaultStrokeColor;
    if (stroke) {
      const lw = p.strokeWidth ?? defaultStrokeWidth;
      if (lw > 0) {
        if (stroke !== lastStroke) {
          ctx.strokeStyle = stroke;
          lastStroke = stroke;
        }
        if (lw !== lastLineWidth) {
          ctx.lineWidth = lw;
          lastLineWidth = lw;
        }
        ctx.stroke();
      }
    }
  }
}

/**
 * Batch-projects points via WASM (Mercator) or active projection and renders
 * individual symbols with optional strokes, antimeridian wrap-around, and
 * large-to-small Z-order to prevent occlusion.
 */
export function drawBatchPoints(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  points: readonly PointItem[],
  spatial: PointBuffers,
  marginOrOptions: number | DrawBatchPointsOptions = 30
): void {
  if (spatial.count === 0) return;

  const opts = resolveDrawPointOptions(marginOrOptions);
  const s = viewport.getState();
  const projection = viewport.getProjection();
  const { slices } = getWrappedSlices(s, 2, projection);

  if (projection.id !== 'mercator') {
    const latScale = spatial.precision === 16 ? 90 / 32767 : 1;
    const lonScale = spatial.precision === 16 ? 180 / 32767 : 1;
    const minX = -opts.margin;
    const minY = -opts.margin;
    const maxX = s.width + opts.margin;
    const maxY = s.height + opts.margin;

    reusableOrder.length = 0;
    reusableXY.length = 0;
    for (let i = 0; i < spatial.count; i++) {
      viewport.projectInto(
        spatial.lats[i] * latScale,
        spatial.lons[i] * lonScale,
        TMP_PT
      );
      if (
        TMP_PT.x < minX ||
        TMP_PT.x > maxX ||
        TMP_PT.y < minY ||
        TMP_PT.y > maxY
      ) {
        continue;
      }
      reusableOrder.push(i);
    }
    const vis = reusableOrder.length;
    if (vis === 0) return;
    if (opts.sortByRadius && vis > 1) {
      reusableOrder.sort((a, b) => points[b].radius - points[a].radius);
    }
    for (let i = 0; i < vis; i++) {
      const idx = reusableOrder[i];
      viewport.projectInto(
        spatial.lats[idx] * latScale,
        spatial.lons[idx] * lonScale,
        TMP_PT
      );
      reusableXY.push(TMP_PT.x, TMP_PT.y);
    }

    ctx.save();
    for (const slice of slices) {
      drawSymbolsPass(
        ctx,
        points,
        reusableOrder,
        vis,
        reusableXY,
        0,
        slice.wrapShiftPx,
        opts.defaultStrokeColor,
        opts.defaultStrokeWidth
      );
    }
    ctx.restore();
    return;
  }

  const staticHandle = getValidStaticHandle(spatial);
  const projected = projectPointsToScratch(
    staticHandle ?? spatial,
    viewport,
    opts.margin
  );
  if (!projected || projected.visible === 0) return;

  const { rt, visible, outXYFloatBase, outIdxIntBase } = projected;
  const f32 = rt.f32;
  const i32 = rt.i32;

  reusableOrder.length = visible;
  for (let k = 0; k < visible; k++) {
    reusableOrder[k] = k;
  }
  if (opts.sortByRadius && visible > 1) {
    reusableOrder.sort(
      (a, b) =>
        points[i32[outIdxIntBase + b]].radius -
        points[i32[outIdxIntBase + a]].radius
    );
  }

  reusableXY.length = visible * 2;
  for (let i = 0; i < visible; i++) {
    const k = reusableOrder[i];
    const xyIdx = outXYFloatBase + k * 2;
    reusableXY[i * 2] = f32[xyIdx];
    reusableXY[i * 2 + 1] = f32[xyIdx + 1];
    reusableOrder[i] = i32[outIdxIntBase + k];
  }

  ctx.save();
  for (const slice of slices) {
    drawSymbolsPass(
      ctx,
      points,
      reusableOrder,
      visible,
      reusableXY,
      0,
      slice.wrapShiftPx,
      opts.defaultStrokeColor,
      opts.defaultStrokeWidth
    );
  }
  ctx.restore();
}

/**
 * Attaches rAF-throttled hover cursor feedback and nearest-point hit-testing
 * to a map container.
 */
export function attachPointHover(
  container: HTMLElement | null,
  viewport: Viewport,
  spatial: PointBuffers,
  hitRadiusPx = 18,
  onHover?: (index: number) => void,
  hoverCursor = 'pointer'
): () => void {
  if (!container || spatial.count === 0) return () => {};

  let rafId = 0;
  let lastX = 0;
  let lastY = 0;
  let rectLeft = 0;
  let rectTop = 0;
  let lastHoverIdx = -1;

  const syncRect = () => {
    const rect = container.getBoundingClientRect();
    rectLeft = rect.left;
    rectTop = rect.top;
  };
  syncRect();

  const resizeObserver =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncRect) : null;
  resizeObserver?.observe(container);
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', syncRect, {
      passive: true,
      capture: true,
    });
  }

  let savedCursor: string | null = null;

  const restoreCursor = () => {
    if (savedCursor !== null) {
      container.style.cursor = savedCursor;
      savedCursor = null;
    }
  };

  const checkHover = () => {
    rafId = 0;
    const x = lastX - rectLeft;
    const y = lastY - rectTop;
    const staticHandle = getValidStaticHandle(spatial);
    const idx = hitTestPoints(
      x,
      y,
      staticHandle ?? spatial,
      viewport,
      hitRadiusPx
    );
    if (idx >= 0) {
      savedCursor ??= container.style.cursor;
      container.style.cursor = hoverCursor;
    } else {
      restoreCursor();
    }
    if (idx !== lastHoverIdx) {
      lastHoverIdx = idx;
      onHover?.(idx);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons !== 0) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (rafId === 0) {
      rafId = requestAnimationFrame(checkHover);
    }
  };

  const onPointerLeave = () => {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    restoreCursor();
    if (lastHoverIdx !== -1) {
      lastHoverIdx = -1;
      onHover?.(-1);
    }
  };

  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerleave', onPointerLeave);
  return () => {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', syncRect, { capture: true });
    }
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerleave', onPointerLeave);
    restoreCursor();
  };
}

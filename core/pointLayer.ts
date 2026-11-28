import { observeElementRect } from './controls';
import { type Point2D, getWrappedSlices } from './projection';
import { type Viewport } from './viewport';
import {
  type CoordPrecision,
  type StaticPointsHandle,
  createCoordPairArrays,
  packLatLon,
  projectPointsToScratch,
  resolveStaticPointsHandle,
  uploadStaticPoints,
  writeCoordPair,
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
}

export interface PointBuffers {
  count: number;
  lats: Float32Array | Int16Array;
  lons: Float32Array | Int16Array;
  precision: CoordPrecision;
  /** Maps pre-sorted buffer index back to original `points` index (null if already sorted). */
  origIndices?: Uint16Array | Uint32Array | null;
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

function mapPackedIndex(spatial: PointBuffers, packedIdx: number): number {
  if (packedIdx < 0) return -1;
  return spatial.origIndices
    ? (spatial.origIndices[packedIdx] ?? -1)
    : packedIdx;
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
  const index = mapPackedIndex(
    spatial,
    hitTestPoints(x, y, target, viewport, radiusPx)
  );
  if (index < 0 || index >= points.length) return null;
  return { point: points[index], index };
}

export function createPointLayerHandle(
  points: readonly PointItem[],
  spatial: PointBuffers,
  viewport: Viewport,
  defaultRadiusPx: number
): PointLayerHandle {
  return {
    hitTest: (x, y, radiusPx = defaultRadiusPx) =>
      hitTestPointBuffers(x, y, points, spatial, viewport, radiusPx),
    hitTestCenter: (radiusPx = defaultRadiusPx) => {
      const s = viewport.getState();
      return hitTestPointBuffers(
        s.width * 0.5,
        s.height * 0.5,
        points,
        spatial,
        viewport,
        radiusPx
      );
    },
  };
}

export function packPoints(
  points: readonly PointItem[],
  precision: CoordPrecision = 32
): PointBuffers {
  const count = points.length;

  let needsSort = false;
  for (let i = 1; i < count; i++) {
    if (points[i].radius > points[i - 1].radius) {
      needsSort = true;
      break;
    }
  }

  let origIndices: Uint16Array | Uint32Array | null = null;
  if (needsSort) {
    origIndices =
      count <= 65535 ? new Uint16Array(count) : new Uint32Array(count);
    for (let i = 0; i < count; i++) origIndices[i] = i;
    origIndices.sort((a, b) => points[b].radius - points[a].radius);
  }

  let lats: Float32Array | Int16Array;
  let lons: Float32Array | Int16Array;
  if (!origIndices) {
    const packed = packLatLon(points, precision);
    lats = packed.lats;
    lons = packed.lons;
  } else {
    const use16 = precision === 16;
    const arrays = createCoordPairArrays(count, precision);
    lats = arrays.lats;
    lons = arrays.lons;
    for (let i = 0; i < count; i++) {
      const p = points[origIndices[i]];
      writeCoordPair(lats, lons, i, p.lat, p.lon, use16);
    }
  }

  return {
    count,
    lats,
    lons,
    precision,
    origIndices,
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
const STAMP_CACHE_LIMIT = 256;
const STAMP_THRESHOLD = 128;
const stampCache = new Map<
  string,
  { canvas: HTMLCanvasElement; half: number }
>();
const TMP_PT: Point2D = { x: 0, y: 0 };

function getSymbolStamp(
  color: string,
  alpha: number,
  radius: number,
  stroke: string | undefined,
  lw: number
): { canvas: HTMLCanvasElement; half: number } | null {
  const qR = Math.round(radius * 2) * 0.5;
  const qA = Math.round(alpha * 20) * 0.05;
  const key = `${color}|${qA}|${qR}|${stroke ?? ''}|${lw}`;
  const cached = stampCache.get(key);
  if (cached) return cached;

  const pad = stroke && lw > 0 ? Math.ceil(lw) + 1 : 1;
  const half = Math.ceil(qR) + pad;
  const size = half * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const sctx = canvas.getContext('2d');
  if (!sctx) return null;

  sctx.globalAlpha = qA;
  sctx.fillStyle = color;
  sctx.beginPath();
  sctx.arc(half, half, qR, 0, TWO_PI);
  sctx.fill();
  if (stroke && lw > 0) {
    sctx.strokeStyle = stroke;
    sctx.lineWidth = lw;
    sctx.stroke();
  }

  if (stampCache.size >= STAMP_CACHE_LIMIT) {
    const oldest = stampCache.keys().next().value;
    if (oldest !== undefined) stampCache.delete(oldest);
  }
  const entry = { canvas, half };
  stampCache.set(key, entry);
  return entry;
}

interface SymbolDrawState {
  fill: string;
  alpha: number;
  stroke: string;
  lw: number;
}

function drawSymbol(
  ctx: CanvasRenderingContext2D,
  st: SymbolDrawState,
  p: PointItem,
  cx: number,
  cy: number,
  defStroke: string | undefined,
  defLw: number,
  useStamps: boolean
): void {
  const r = p.radius;
  if (!(r > 0)) return;
  const alpha = p.alpha ?? 0.7;
  const stroke = p.strokeColor ?? defStroke;
  const lw = stroke ? (p.strokeWidth ?? defLw) : 0;

  if (useStamps) {
    const stamp = getSymbolStamp(p.color, alpha, r, stroke, lw);
    if (stamp) {
      if (st.alpha !== 1) {
        ctx.globalAlpha = 1;
        st.alpha = 1;
      }
      ctx.drawImage(stamp.canvas, cx - stamp.half, cy - stamp.half);
      return;
    }
  }

  if (p.color !== st.fill) {
    ctx.fillStyle = p.color;
    st.fill = p.color;
  }
  if (alpha !== st.alpha) {
    ctx.globalAlpha = alpha;
    st.alpha = alpha;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TWO_PI);
  ctx.fill();
  if (stroke && lw > 0) {
    if (stroke !== st.stroke) {
      ctx.strokeStyle = stroke;
      st.stroke = stroke;
    }
    if (lw !== st.lw) {
      ctx.lineWidth = lw;
      st.lw = lw;
    }
    ctx.stroke();
  }
}

function drawMercatorSymbols(
  ctx: CanvasRenderingContext2D,
  points: readonly PointItem[],
  origIndices: Uint16Array | Uint32Array | null | undefined,
  visible: number,
  f32: Float32Array,
  i32: Int32Array,
  outXYFloatBase: number,
  outIdxIntBase: number,
  wrapShiftPx: number,
  defStroke: string | undefined,
  defLw: number
): void {
  const useStamps =
    visible >= STAMP_THRESHOLD &&
    typeof document !== 'undefined' &&
    typeof ctx.drawImage === 'function';
  const st: SymbolDrawState = { fill: '', alpha: -1, stroke: '', lw: -1 };

  for (let k = 0; k < visible; k++) {
    const packedIdx = i32[outIdxIntBase + k];
    const p = points[origIndices ? origIndices[packedIdx] : packedIdx];
    if (!p) continue;
    const xyIdx = outXYFloatBase + k * 2;
    drawSymbol(
      ctx,
      st,
      p,
      f32[xyIdx] + wrapShiftPx,
      f32[xyIdx + 1],
      defStroke,
      defLw,
      useStamps
    );
  }
}

function drawNonMercatorPoints(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  points: readonly PointItem[],
  spatial: PointBuffers,
  slices: readonly { wrapShiftPx: number }[],
  margin: number,
  defStroke: string | undefined,
  defLw: number
): void {
  const s = viewport.getState();
  const latScale = spatial.precision === 16 ? 90 / 32767 : 1;
  const lonScale = spatial.precision === 16 ? 180 / 32767 : 1;
  const maxX = s.width + margin;
  const maxY = s.height + margin;
  const origIndices = spatial.origIndices;

  ctx.save();
  for (const slice of slices) {
    const st: SymbolDrawState = { fill: '', alpha: -1, stroke: '', lw: -1 };
    for (let i = 0; i < spatial.count; i++) {
      const p = points[origIndices ? origIndices[i] : i];
      if (!p) continue;
      viewport.projectInto(
        spatial.lats[i] * latScale,
        spatial.lons[i] * lonScale,
        TMP_PT
      );
      const cx = TMP_PT.x + slice.wrapShiftPx;
      const cy = TMP_PT.y;
      if (cx < -margin || cx > maxX || cy < -margin || cy > maxY) continue;
      drawSymbol(ctx, st, p, cx, cy, defStroke, defLw, false);
    }
  }
  ctx.restore();
}

function resolveDrawPointOptions(
  marginOrOptions: number | DrawBatchPointsOptions
): {
  margin: number;
  defaultStrokeColor: string | undefined;
  defaultStrokeWidth: number;
} {
  if (typeof marginOrOptions === 'number') {
    return {
      margin: marginOrOptions,
      defaultStrokeColor: undefined,
      defaultStrokeWidth: 1,
    };
  }
  return {
    margin: marginOrOptions.margin ?? 30,
    defaultStrokeColor: marginOrOptions.strokeColor,
    defaultStrokeWidth: marginOrOptions.strokeWidth ?? 1,
  };
}

/**
 * Batch-projects points via WASM (Mercator) or active projection and renders
 * pre-sorted individual symbols with optional strokes, stamp caching, and
 * antimeridian wrap-around (zero per-frame sorting).
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
    drawNonMercatorPoints(
      ctx,
      viewport,
      points,
      spatial,
      slices,
      opts.margin,
      opts.defaultStrokeColor,
      opts.defaultStrokeWidth
    );
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
  ctx.save();
  for (const slice of slices) {
    drawMercatorSymbols(
      ctx,
      points,
      spatial.origIndices,
      visible,
      rt.f32,
      rt.i32,
      outXYFloatBase,
      outIdxIntBase,
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

  const stopRect = observeElementRect(container, (rect) => {
    rectLeft = rect.left;
    rectTop = rect.top;
  });

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
    const idx = mapPackedIndex(
      spatial,
      hitTestPoints(x, y, staticHandle ?? spatial, viewport, hitRadiusPx)
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
    stopRect();
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerleave', onPointerLeave);
    restoreCursor();
  };
}

/**
 * Binds both click hit-testing and hover cursor/hit-testing for a point layer.
 */
export function attachPointInteractions(opts: {
  container: HTMLElement | null;
  viewport: Viewport;
  points: readonly PointItem[];
  spatial: PointBuffers;
  hitRadiusPx: number;
  subscribeClick: (
    listener: (pos: { x: number; y: number }) => void
  ) => () => void;
  onPointClick?: (point: PointItem, index: number) => void;
  onPointHover?: (point: PointItem | null, index: number) => void;
}): () => void {
  const {
    container,
    viewport,
    points,
    spatial,
    hitRadiusPx,
    subscribeClick,
    onPointClick,
    onPointHover,
  } = opts;
  const unsubClick =
    onPointClick && points.length > 0
      ? subscribeClick(({ x, y }) => {
          const hit = hitTestPointBuffers(
            x,
            y,
            points,
            spatial,
            viewport,
            hitRadiusPx
          );
          if (hit) {
            onPointClick(hit.point, hit.index);
          }
        })
      : null;
  const unsubHover =
    onPointClick || onPointHover
      ? attachPointHover(container, viewport, spatial, hitRadiusPx, (idx) => {
          onPointHover?.(idx >= 0 ? points[idx] : null, idx);
        })
      : null;
  return () => {
    unsubClick?.();
    unsubHover?.();
  };
}

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

const reusableBucketCoords: number[][] = [];

function fillCircles(
  ctx: CanvasRenderingContext2D,
  coords: readonly number[],
  color: string,
  alpha: number
): void {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < coords.length; i += 3) {
    const cx = coords[i];
    const cy = coords[i + 1];
    const r = coords[i + 2];
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * Batch-projects points via WASM and renders them into a 2D canvas grouped by
 * color and quantized alpha buckets.
 */
export function drawBatchPoints(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  points: readonly PointItem[],
  spatial: PointBuffers,
  margin = 30
): void {
  if (spatial.count === 0) return;

  const staticHandle = getValidStaticHandle(spatial);
  const projected = projectPointsToScratch(
    staticHandle ?? spatial,
    viewport,
    margin
  );
  if (!projected || projected.visible === 0) return;

  const { rt, visible, outXYFloatBase, outIdxIntBase } = projected;
  const f32 = rt.f32;
  const i32 = rt.i32;

  const { palette, bucketIds } = spatial;
  if (!palette || !bucketIds) return;

  const numBuckets = palette.length;
  while (reusableBucketCoords.length < numBuckets) {
    reusableBucketCoords.push([]);
  }
  for (let b = 0; b < numBuckets; b++) {
    reusableBucketCoords[b].length = 0;
  }
  for (let k = 0; k < visible; k++) {
    const idx = i32[outIdxIntBase + k];
    const bid = bucketIds[idx];
    const xyIdx = outXYFloatBase + k * 2;
    reusableBucketCoords[bid].push(
      f32[xyIdx],
      f32[xyIdx + 1],
      points[idx].radius
    );
  }
  for (let b = 0; b < numBuckets; b++) {
    const coords = reusableBucketCoords[b];
    if (coords.length === 0) continue;
    const style = palette[b];
    fillCircles(ctx, coords, style.color, style.alpha);
  }
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
  onHover?: (index: number) => void
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
    container.style.cursor = idx >= 0 ? 'pointer' : '';
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
    container.style.cursor = '';
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
    container.style.cursor = '';
  };
}

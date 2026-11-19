import { type Camera } from './camera';
import { batchProjectPoints } from './batch';
import { findNearestPointFast } from './hitTest';

export interface PointItem {
  lat: number;
  lon: number;
  radius: number;
  color: string;
  alpha?: number;
}

export interface PointSpatialBuffers {
  count: number;
  lats: Float32Array;
  lons: Float32Array;
}

export function buildPointSpatialBuffers(
  points: readonly PointItem[]
): PointSpatialBuffers {
  const count = points.length;
  const lats = new Float32Array(count);
  const lons = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    lats[i] = points[i].lat;
    lons[i] = points[i].lon;
  }
  return { count, lats, lons };
}

/**
 * Batch-projects points via WASM and renders them into a 2D canvas grouped by
 * color and quantized alpha buckets.
 */
export function drawBatchPoints(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  points: readonly PointItem[],
  spatial: PointSpatialBuffers,
  outXY: Float32Array,
  outIdx: Int32Array,
  margin = 30
): void {
  if (spatial.count === 0) return;

  const visible = batchProjectPoints(
    spatial.lats,
    spatial.lons,
    spatial.count,
    camera,
    margin,
    outXY,
    outIdx
  );
  if (visible === 0) return;

  const buckets = new Map<
    string,
    { color: string; alpha: number; coords: number[] }
  >();

  for (let k = 0; k < visible; k++) {
    const p = points[outIdx[k]];
    const alpha = p.alpha ?? 0.7;
    // Quantize alpha to 0.05 steps to maximize Canvas fill batching
    const qAlpha = Math.round(alpha * 20) / 20;
    const key = `${p.color}|${qAlpha}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { color: p.color, alpha: qAlpha, coords: [] };
      buckets.set(key, bucket);
    }
    bucket.coords.push(outXY[k * 2], outXY[k * 2 + 1], p.radius);
  }

  buckets.forEach((bucket) => {
    const { color, alpha, coords } = bucket;
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
  });
}

/**
 * Attaches rAF-throttled hover cursor feedback and nearest-point hit-testing
 * to a map container.
 */
export function attachPointHoverCursor(
  container: HTMLElement | null,
  camera: Camera,
  spatial: PointSpatialBuffers,
  hitRadiusPx = 18
): () => void {
  if (!container || spatial.count === 0) return () => {};

  let rafId = 0;
  let lastX = 0;
  let lastY = 0;

  const checkHover = () => {
    rafId = 0;
    const rect = container.getBoundingClientRect();
    const x = lastX - rect.left;
    const y = lastY - rect.top;
    const idx = findNearestPointFast(x, y, spatial, camera, hitRadiusPx);
    container.style.cursor = idx >= 0 ? 'pointer' : '';
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
    container.style.cursor = '';
  };

  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerleave', onPointerLeave);
  return () => {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerleave', onPointerLeave);
    container.style.cursor = '';
  };
}

import { type Camera } from './camera';
import { batchProjectPoints } from './batch';
import { hitTestPoints } from './hitTest';

export interface PointItem {
  lat: number;
  lon: number;
  radius: number;
  color: string;
  alpha?: number;
}

export interface PointBuffers {
  count: number;
  lats: Float32Array;
  lons: Float32Array;
}

export function packPoints(points: readonly PointItem[]): PointBuffers {
  const count = points.length;
  const lats = new Float32Array(count);
  const lons = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    lats[i] = points[i].lat;
    lons[i] = points[i].lon;
  }
  return { count, lats, lons };
}

interface PointBucket {
  color: string;
  alphaStep: number;
  coords: number[];
}

const reusableBuckets = new Map<string, PointBucket>();

/**
 * Batch-projects points via WASM and renders them into a 2D canvas grouped by
 * color and quantized alpha buckets.
 */
export function drawBatchPoints(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  points: readonly PointItem[],
  spatial: PointBuffers,
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

  for (const bucket of reusableBuckets.values()) {
    bucket.coords.length = 0;
  }

  for (let k = 0; k < visible; k++) {
    const p = points[outIdx[k]];
    const alpha = p.alpha ?? 0.7;
    // Quantize alpha to 8-bit integer 0.05 steps (0..20) to maximize Canvas fill batching
    const qAlphaStep = (alpha * 20 + 0.5) | 0;
    const key = `${p.color}|${qAlphaStep}`;
    let bucket = reusableBuckets.get(key);
    if (!bucket) {
      bucket = { color: p.color, alphaStep: qAlphaStep, coords: [] };
      reusableBuckets.set(key, bucket);
    }
    bucket.coords.push(outXY[k * 2], outXY[k * 2 + 1], p.radius);
  }

  reusableBuckets.forEach((bucket, key) => {
    const { color, alphaStep, coords } = bucket;
    if (coords.length === 0) {
      if (reusableBuckets.size > 256) {
        reusableBuckets.delete(key);
      }
      return;
    }
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.globalAlpha = alphaStep * 0.05;
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
export function attachPointHover(
  container: HTMLElement | null,
  camera: Camera,
  spatial: PointBuffers,
  hitRadiusPx = 18
): () => void {
  if (!container || spatial.count === 0) return () => {};

  let rafId = 0;
  let lastX = 0;
  let lastY = 0;
  let rectLeft = 0;
  let rectTop = 0;

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
    const idx = hitTestPoints(x, y, spatial, camera, hitRadiusPx);
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
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    container.style.cursor = '';
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

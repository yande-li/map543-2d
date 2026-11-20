import { type Camera } from './camera';
import {
  type StaticPointsHandle,
  batchProjectPoints,
  batchProjectPointsI16,
  batchProjectStaticPoints,
  uploadStaticPoints,
  uploadStaticPointsI16,
} from './batch';
import {
  encodePointsToI16,
  hitTestPoints,
  hitTestPointsI16,
  hitTestStaticPoints,
} from './hitTest';
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
  lats: Float32Array;
  lons: Float32Array;
  latsI16?: Int16Array;
  lonsI16?: Int16Array;
  palette?: PointBucketStyle[];
  bucketIds?: Uint16Array;
  staticHandle?: StaticPointsHandle | null;
}

export function packPoints(
  points: readonly PointItem[],
  precision: 'f32' | 'i16' = 'f32'
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

  if (precision === 'i16') {
    const tmpLats = new Float32Array(count);
    const tmpLons = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      tmpLats[i] = points[i].lat;
      tmpLons[i] = points[i].lon;
      assignBucket(i);
    }
    const { latsI16, lonsI16 } = encodePointsToI16(tmpLats, tmpLons, count);
    return {
      count,
      lats: new Float32Array(0),
      lons: new Float32Array(0),
      latsI16,
      lonsI16,
      palette,
      bucketIds,
      staticHandle: uploadStaticPointsI16(latsI16, lonsI16, count),
    };
  }

  const lats = new Float32Array(count);
  const lons = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    lats[i] = points[i].lat;
    lons[i] = points[i].lon;
    assignBucket(i);
  }
  return {
    count,
    lats,
    lons,
    palette,
    bucketIds,
    staticHandle: uploadStaticPoints(lats, lons, count),
  };
}

function getValidStaticHandle(
  spatial: PointBuffers
): StaticPointsHandle | null {
  const rt = getWasmRuntime();
  if (rt === null || spatial.count <= 0) return null;
  const h = spatial.staticHandle;
  if (h && h.epoch === rt.arenaEpoch) return h;
  const next =
    spatial.latsI16 && spatial.lonsI16
      ? uploadStaticPointsI16(spatial.latsI16, spatial.lonsI16, spatial.count)
      : uploadStaticPoints(spatial.lats, spatial.lons, spatial.count);
  spatial.staticHandle = next;
  return next;
}

interface PointBucket {
  color: string;
  alphaStep: number;
  coords: number[];
}

const reusableBuckets = new Map<string, PointBucket>();
const reusableBucketCoords: number[][] = [];

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

  const staticHandle = getValidStaticHandle(spatial);
  const visible = staticHandle
    ? batchProjectStaticPoints(staticHandle, camera, margin, outXY, outIdx)
    : spatial.latsI16 && spatial.lonsI16
      ? batchProjectPointsI16(
          spatial.latsI16,
          spatial.lonsI16,
          spatial.count,
          camera,
          margin,
          outXY,
          outIdx
        )
      : batchProjectPoints(
          spatial.lats,
          spatial.lons,
          spatial.count,
          camera,
          margin,
          outXY,
          outIdx
        );
  if (visible === 0) return;

  const { palette, bucketIds } = spatial;
  if (palette && bucketIds) {
    const numBuckets = palette.length;
    while (reusableBucketCoords.length < numBuckets) {
      reusableBucketCoords.push([]);
    }
    for (let b = 0; b < numBuckets; b++) {
      reusableBucketCoords[b].length = 0;
    }
    for (let k = 0; k < visible; k++) {
      const idx = outIdx[k];
      const bid = bucketIds[idx];
      reusableBucketCoords[bid].push(
        outXY[k * 2],
        outXY[k * 2 + 1],
        points[idx].radius
      );
    }
    for (let b = 0; b < numBuckets; b++) {
      const coords = reusableBucketCoords[b];
      if (coords.length === 0) continue;
      const style = palette[b];
      ctx.beginPath();
      ctx.fillStyle = style.color;
      ctx.globalAlpha = style.alpha;
      for (let i = 0; i < coords.length; i += 3) {
        const cx = coords[i];
        const cy = coords[i + 1];
        const r = coords[i + 2];
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    return;
  }

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
      if (reusableBuckets.size > 64) {
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
    const staticHandle = getValidStaticHandle(spatial);
    const idx = staticHandle
      ? hitTestStaticPoints(x, y, staticHandle, camera, hitRadiusPx)
      : spatial.latsI16 && spatial.lonsI16
        ? hitTestPointsI16(
            x,
            y,
            spatial.latsI16,
            spatial.lonsI16,
            spatial.count,
            camera,
            hitRadiusPx
          )
        : hitTestPoints(x, y, spatial, camera, hitRadiusPx);
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

import { type Camera } from './camera';
import { LatLng } from './projection';
import { LUT_OFFSET_BYTES, getWasmRuntime } from '../wasm/wasmBridge';

const BEZIER_STEPS = 18;
const BEZIER_LOOKUP = new Float32Array((BEZIER_STEPS + 1) * 3);

for (let i = 0; i <= BEZIER_STEPS; i++) {
  const t = i / BEZIER_STEPS;
  const invT = 1 - t;
  const idx = i * 3;
  BEZIER_LOOKUP[idx] = invT * invT;
  BEZIER_LOOKUP[idx + 1] = 2 * invT * t;
  BEZIER_LOOKUP[idx + 2] = t * t;
}

/**
 * Generates a 19-point quadratic Bezier arc between two [lat, lon] points,
 * wrapping output longitudes into [-180, 180].
 */
export function computeQuadraticArc(
  src: LatLng,
  dst: LatLng,
  isShort = false
): LatLng[] {
  if (isShort) return [src, dst];

  const dLon = dst[1] - src[1];
  const dLat = src[0] - dst[0];
  const midLat = (src[0] + dst[0]) * 0.5;
  const dist = (dLat < 0 ? -dLat : dLat) + (dLon < 0 ? -dLon : dLon);
  const controlLat = midLat + dist * 0.2;
  const controlLon = src[1] + dLon * 0.5;

  const s0 = src[0];
  const s1 = src[1];
  const d0 = dst[0];
  const d1 = src[1] + dLon;
  const points: LatLng[] = new Array<LatLng>(BEZIER_STEPS + 1);

  for (let i = 0; i <= BEZIER_STEPS; i++) {
    const idx = i * 3;
    const invT2 = BEZIER_LOOKUP[idx];
    const twoInvTT = BEZIER_LOOKUP[idx + 1];
    const t2 = BEZIER_LOOKUP[idx + 2];

    const lat = invT2 * s0 + twoInvTT * controlLat + t2 * d0;
    const lon = invT2 * s1 + twoInvTT * controlLon + t2 * d1;
    let wrappedLon = lon;
    if (wrappedLon > 180) wrappedLon -= 360;
    else if (wrappedLon < -180) wrappedLon += 360;

    points[i] = [lat, wrappedLon];
  }
  return points;
}

export const QUADRATIC_ARC_POINTS = BEZIER_STEPS + 1;

/**
 * Zero-allocation batch variant of computeQuadraticArc that writes
 * `count * 19` [lat, wrappedLon] pairs directly into `outLatLon`.
 * Returns the number of float32 values written (`count * 38`).
 */
export function computeQuadraticArcsBatch(
  srcLats: ArrayLike<number>,
  srcLons: ArrayLike<number>,
  dstLats: ArrayLike<number>,
  dstLons: ArrayLike<number>,
  count: number,
  outLatLon: Float32Array
): number {
  const neededFloats = count * QUADRATIC_ARC_POINTS * 2;
  if (count <= 0 || outLatLon.length < neededFloats) {
    return 0;
  }

  const rt = getWasmRuntime();
  if (rt === null) {
    throw new Error('WASM runtime is not initialized');
  }

  const inBytes = count * 4;
  const outBytes = neededFloats * 4;
  const sLatOff = rt.getScratchBase();
  const sLonOff = sLatOff + inBytes;
  const dLatOff = sLonOff + inBytes;
  const dLonOff = dLatOff + inBytes;
  const outOff = dLonOff + inBytes;
  if (!rt.ensureCapacity(outOff + outBytes)) {
    return 0;
  }

  for (let i = 0; i < count; i++) {
    rt.f32[(sLatOff >> 2) + i] = srcLats[i];
    rt.f32[(sLonOff >> 2) + i] = srcLons[i];
    rt.f32[(dLatOff >> 2) + i] = dstLats[i];
    rt.f32[(dLonOff >> 2) + i] = dstLons[i];
  }

  const written = rt.exports.computeQuadraticArcsBatch(
    count,
    sLatOff,
    sLonOff,
    dLatOff,
    dLonOff,
    outOff
  );
  if (written > 0) {
    outLatLon.set(rt.f32.subarray(outOff >> 2, (outOff >> 2) + written));
  }
  return written;
}

const SCREEN_CURVE_LOOKUP = new Float32Array(512);
for (let i = 0; i < 512; i++) {
  SCREEN_CURVE_LOOKUP[i] = i * 0.2;
}

/**
 * Returns the Manhattan distance in degrees between two [lat, lon] coordinates.
 */
export function manhattanDegDistance(src: LatLng, dst: LatLng): number {
  const dLat = src[0] - dst[0];
  const dLon = src[1] - dst[1];
  return (dLat < 0 ? -dLat : dLat) + (dLon < 0 ? -dLon : dLon);
}

export type TrajectoryTimingFn = (distDeg: number) => {
  dashRatio: number;
  duration: number;
};

/**
 * Default timing heuristic computing dash ratio and flight duration (ms) from a degree distance.
 */
export function computeTrajectoryTiming(dist: number): {
  dashRatio: number;
  duration: number;
} {
  const estimatedLength = dist * 25;
  const maxVisualLength = 120;
  const maxRatio = maxVisualLength / Math.max(1, estimatedLength);
  const dashRatio = Math.min(0.1, 0.05 + dist * 0.02, maxRatio);
  const duration = Math.max(800, Math.min(1400, estimatedLength * 5));
  return { dashRatio, duration };
}

/**
 * Projects an array of [lat, lon] points into an SVG `M...L...` path string.
 */
export function buildProjectedSvgPath(
  points: readonly LatLng[],
  projectInto: (lat: number, lon: number, out: { x: number; y: number }) => void,
  outPoint: { x: number; y: number } = { x: 0, y: 0 }
): string {
  if (points.length === 0) return '';
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [lat, lon] = points[i];
    projectInto(lat, lon, outPoint);
    d += `${i === 0 ? 'M' : 'L'}${outPoint.x.toFixed(1)},${outPoint.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Traces a screen-space upward quadratic Bezier arc (or straight line below `straightThreshold`)
 * onto a 2D canvas context. Caller must call `ctx.moveTo(srcX, srcY)` before invoking.
 */
export function traceScreenQuadraticArc(
  ctx: CanvasRenderingContext2D,
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
  straightThreshold = 100
): void {
  const dX = srcX - dstX;
  const dY = srcY - dstY;
  const dist = (dX < 0 ? -dX : dX) + (dY < 0 ? -dY : dY);

  if (dist < straightThreshold) {
    ctx.lineTo(dstX, dstY);
    return;
  }

  const midX = (srcX + dstX) * 0.5;
  const midY = (srcY + dstY) * 0.5;
  const lookupIdx = (dist | 0) & 511;
  const offset = SCREEN_CURVE_LOOKUP[lookupIdx];
  ctx.quadraticCurveTo(midX, midY - offset, dstX, dstY);
}

/**
 * Projects interleaved [lat, lon, ...] coordinates into screen [x, y, ...]
 * coordinates via the WASM `projectInterleavedMercator` kernel (zero culling).
 */
export function projectInterleavedMercator(
  inLatLon: Float32Array,
  ptCount: number,
  camera: Camera,
  outXY: Float32Array
): number {
  const needed = ptCount * 2;
  if (ptCount <= 0 || inLatLon.length < needed || outXY.length < needed) {
    return 0;
  }
  const rt = getWasmRuntime();
  if (rt === null) {
    throw new Error('WASM runtime is not initialized');
  }
  const bytes = needed * 4;
  const inOff = rt.getScratchBase();
  const outOff = inOff + bytes;
  if (!rt.ensureCapacity(outOff + bytes)) {
    return 0;
  }
  rt.f32.set(
    inLatLon.length === needed ? inLatLon : inLatLon.subarray(0, needed),
    inOff >> 2
  );
  const p = camera.getProjectionParams();
  const written = rt.exports.projectInterleavedMercator(
    ptCount,
    LUT_OFFSET_BYTES,
    inOff,
    outOff,
    p.centerNormX,
    p.centerNormY,
    p.worldSize,
    p.halfW,
    p.halfH
  );
  if (written > 0) {
    outXY.set(rt.f32.subarray(outOff >> 2, (outOff >> 2) + written * 2));
  }
  return written;
}

/**
 * Formats an SVG path string from a flat [x, y, ...] screen buffer.
 * When `smooth` is true and `ptCount >= 3`, emits C1-continuous quadratic Bezier
 * segments (`Q`) instead of a segmented polyline (`L`).
 */
export function buildSvgPathFromFlatXY(
  xy: Float32Array,
  startFloatIdx: number,
  ptCount: number,
  smooth = false
): string {
  if (ptCount <= 0) return '';
  if (!smooth || ptCount < 3) {
    let d = '';
    for (let i = 0; i < ptCount; i++) {
      const idx = startFloatIdx + i * 2;
      d += `${i === 0 ? 'M' : 'L'}${xy[idx].toFixed(1)},${xy[idx + 1].toFixed(1)}`;
    }
    return d;
  }

  const x0 = xy[startFloatIdx];
  const y0 = xy[startFloatIdx + 1];
  const x1 = xy[startFloatIdx + 2];
  const y1 = xy[startFloatIdx + 3];
  let d = `M${x0.toFixed(1)},${y0.toFixed(1)}L${((x0 + x1) * 0.5).toFixed(1)},${((y0 + y1) * 0.5).toFixed(1)}`;

  for (let i = 1; i < ptCount - 2; i++) {
    const idx = startFloatIdx + i * 2;
    const cx = xy[idx];
    const cy = xy[idx + 1];
    const mx = (cx + xy[idx + 2]) * 0.5;
    const my = (cy + xy[idx + 3]) * 0.5;
    d += `Q${cx.toFixed(1)},${cy.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }

  const lastIdx = startFloatIdx + (ptCount - 1) * 2;
  const prevIdx = lastIdx - 2;
  d += `Q${xy[prevIdx].toFixed(1)},${xy[prevIdx + 1].toFixed(1)} ${xy[lastIdx].toFixed(1)},${xy[lastIdx + 1].toFixed(1)}`;
  return d;
}

import { resolveAnimationEasing } from './animation';
import { type Viewport } from './viewport';
import {
  QUADRATIC_ARC_POINTS,
  latLonsToSvgPath,
  xyToSvgPath,
  computeArcsBatch,
  getArcTiming,
  manhattanDeg,
  projectMercator,
  type TrajectoryTimingFn,
} from './curves';
import { type LatLon, MERCATOR_PROJECTION } from './projection';

export type TrajectoryCurveMode = 'arc' | 'straight' | 'none';

export interface TrajectoryItem {
  key?: string;
  src?: LatLon;
  dst?: LatLon;
  srcLat?: number;
  srcLon?: number;
  dstLat?: number;
  dstLon?: number;
  color?: string;
  curve?: TrajectoryCurveMode;
  isReversed?: boolean;
  dashRatio?: number;
  duration?: number;
  className?: string;
}

export interface PreparedArc {
  key: string;
  src: LatLon;
  dst: LatLon;
  isStraight: boolean;
  batchIndex: number;
  color: string;
  dashRatio: number;
  duration: number;
  className: string | undefined;
}

interface PreparedArcs {
  items: PreparedArc[];
  arcCount: number;
  arcBuffer: Float32Array | null;
}

const pendingAnimations = new Set<() => void>();
let sharedRafId: number | null = null;

export function scheduleAnimation(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'undefined') {
    fn();
    return () => {};
  }
  pendingAnimations.add(fn);
  sharedRafId ??= requestAnimationFrame(() => {
    sharedRafId = null;
    const tasks = Array.from(pendingAnimations);
    pendingAnimations.clear();
    for (const task of tasks) {
      task();
    }
  });
  return () => {
    pendingAnimations.delete(fn);
    if (
      pendingAnimations.size === 0 &&
      sharedRafId !== null &&
      typeof cancelAnimationFrame !== 'undefined'
    ) {
      cancelAnimationFrame(sharedRafId);
      sharedRafId = null;
    }
  };
}

/**
 * Starts a Web Animations API dash-flight animation along an SVG path with `pathLength="1"`.
 */
export function animateStroke(
  el: SVGPathElement,
  dashRatio: number,
  duration: number,
  fps?: number
): Animation {
  el.setAttribute('pathLength', '1');
  el.style.strokeDasharray = `${dashRatio.toFixed(3)} 1.2`;
  const easing = resolveAnimationEasing(
    duration,
    fps,
    'cubic-bezier(0.15, 0.45, 0.35, 1)',
    0,
    8
  );
  return el.animate(
    [
      { strokeDashoffset: '0', strokeOpacity: '0.9' },
      { strokeDashoffset: '-1.2', strokeOpacity: '0.9', offset: 0.7 },
      { strokeDashoffset: '-1.2', strokeOpacity: '0', offset: 1.0 },
    ],
    {
      duration,
      easing,
      fill: 'forwards',
    }
  );
}

/**
 * Resolves [srcLat, srcLon, dstLat, dstLon] from either tuple or flat fields,
 * applying `isReversed` when set.
 */
export function resolveTrajectoryEndpoints(
  item: TrajectoryItem
): [number, number, number, number] {
  const sLat = item.src?.[0] ?? item.srcLat ?? 0;
  const sLon = item.src?.[1] ?? item.srcLon ?? 0;
  const dLat = item.dst?.[0] ?? item.dstLat ?? 0;
  const dLon = item.dst?.[1] ?? item.dstLon ?? 0;
  return item.isReversed ? [dLat, dLon, sLat, sLon] : [sLat, sLon, dLat, dLon];
}

/**
 * Prepares trajectory timings and computes all curved arcs in one WASM batch.
 */
export function prepareArcs(
  items: readonly TrajectoryItem[],
  timingFn: TrajectoryTimingFn = getArcTiming
): PreparedArcs {
  const result: PreparedArc[] = [];
  const arcIndices: number[] = [];

  for (const item of items) {
    if (item.curve === 'none') continue;
    const [sLat, sLon, dLat, dLon] = resolveTrajectoryEndpoints(item);
    const resolvedSrc: LatLon = [sLat, sLon];
    const resolvedDst: LatLon = [dLat, dLon];
    const isStraight = item.curve === 'straight';
    const dist = manhattanDeg(resolvedSrc, resolvedDst);
    const timing = timingFn(dist);

    const idx = result.length;
    if (!isStraight) {
      arcIndices.push(idx);
    }
    const key = item.key ?? `${idx}:${sLat},${sLon}->${dLat},${dLon}`;
    result.push({
      key,
      src: resolvedSrc,
      dst: resolvedDst,
      isStraight,
      batchIndex: -1,
      color: item.color ?? '#0ebf9c',
      dashRatio: item.dashRatio ?? timing.dashRatio,
      duration: item.duration ?? timing.duration,
      className: item.className,
    });
  }

  let arcBuffer: Float32Array | null = null;
  const arcCount = arcIndices.length;
  if (arcCount > 0) {
    const sLats = new Float32Array(arcCount);
    const sLons = new Float32Array(arcCount);
    const dLats = new Float32Array(arcCount);
    const dLons = new Float32Array(arcCount);
    for (let i = 0; i < arcCount; i++) {
      const entry = result[arcIndices[i]];
      entry.batchIndex = i;
      sLats[i] = entry.src[0];
      sLons[i] = entry.src[1];
      dLats[i] = entry.dst[0];
      dLons[i] = entry.dst[1];
    }
    arcBuffer = new Float32Array(arcCount * QUADRATIC_ARC_POINTS * 2);
    computeArcsBatch(sLats, sLons, dLats, dLons, arcCount, arcBuffer);
  }

  return { items: result, arcCount, arcBuffer };
}

/**
 * Attaches a viewport subscription to an SVG container: translates via `translate3d` on pan
 * and batch-projects via WASM on zoom/init.
 */
export function attachSvgSync(
  svg: SVGSVGElement | null,
  viewport: Viewport,
  batch: PreparedArcs,
  getPathEl: (key: string) => SVGPathElement | undefined,
  getBasePathEl: (key: string) => SVGPathElement | undefined,
  curveSmooth = false
): () => void {
  if (batch.items.length === 0) return () => {};

  let builtZoom = NaN;
  let originNormX = 0;
  let originNormY = 0;
  const tmpPt = { x: 0, y: 0 };
  const stride = QUADRATIC_ARC_POINTS * 2;
  let nonMercatorTmpXY: Float32Array | null = null;
  const projectedXY =
    batch.arcBuffer && batch.arcCount > 0
      ? new Float32Array(batch.arcCount * stride)
      : null;

  const rebuildPaths = () => {
    const state = viewport.getState();
    const params = viewport.getProjectionParams();
    builtZoom = state.zoom;
    originNormX = params.centerNormX;
    originNormY = params.centerNormY;

    const isMercator =
      viewport.getProjection() === MERCATOR_PROJECTION &&
      batch.arcBuffer &&
      projectedXY &&
      projectMercator(
        batch.arcBuffer,
        batch.arcCount * QUADRATIC_ARC_POINTS,
        viewport,
        projectedXY
      ) > 0;

    for (const item of batch.items) {
      let d: string;
      if (item.batchIndex >= 0 && projectedXY && isMercator) {
        d = xyToSvgPath(
          projectedXY,
          item.batchIndex * stride,
          QUADRATIC_ARC_POINTS,
          curveSmooth
        );
      } else if (item.batchIndex >= 0 && batch.arcBuffer) {
        nonMercatorTmpXY ??= new Float32Array(stride);
        const base = item.batchIndex * stride;
        for (let i = 0; i < QUADRATIC_ARC_POINTS; i++) {
          const lat = batch.arcBuffer[base + i * 2];
          const lon = batch.arcBuffer[base + i * 2 + 1];
          viewport.projectInto(lat, lon, tmpPt);
          nonMercatorTmpXY[i * 2] = tmpPt.x;
          nonMercatorTmpXY[i * 2 + 1] = tmpPt.y;
        }
        d = xyToSvgPath(nonMercatorTmpXY, 0, QUADRATIC_ARC_POINTS, curveSmooth);
      } else {
        d = latLonsToSvgPath(
          [item.src, item.dst],
          (lat, lon, out) => viewport.projectInto(lat, lon, out),
          tmpPt
        );
      }

      const el = getPathEl(item.key);
      if (el) {
        el.setAttribute('d', d);
        el.setAttribute('pathLength', '1');
      }
      const baseEl = getBasePathEl(item.key);
      if (baseEl) {
        baseEl.setAttribute('d', d);
      }
    }

    if (svg) {
      svg.style.transform = '';
    }
  };

  const syncViewport = () => {
    const state = viewport.getState();
    if (state.zoom !== builtZoom || !svg) {
      rebuildPaths();
      return;
    }
    const params = viewport.getProjectionParams();
    const dx = (originNormX - params.centerNormX) * params.worldSize;
    const dy = (originNormY - params.centerNormY) * params.worldSize;
    svg.style.transform = `translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;
  };

  rebuildPaths();
  return viewport.subscribe(syncViewport);
}

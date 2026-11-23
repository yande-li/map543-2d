/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface BenchStats {
  name: string;
  iterations: number;
  meanMs: number;
  p99Ms: number;
  opsPerSec: number;
}

const benchResults: BenchStats[] = [];

function bench(name: string, fn: () => void, minTimeMs = 250): void {
  it(name, () => {
    // Warmup
    const warmupEnd = performance.now() + 40;
    while (performance.now() < warmupEnd) {
      fn();
    }

    const samples: number[] = [];
    const startTotal = performance.now();
    let elapsed = 0;
    while (elapsed < minTimeMs || samples.length < 15) {
      const t0 = performance.now();
      fn();
      const dt = performance.now() - t0;
      samples.push(dt);
      elapsed = performance.now() - startTotal;
      if (samples.length >= 20000) break;
    }

    samples.sort((a, b) => a - b);
    const sum = samples.reduce((acc, v) => acc + v, 0);
    const meanMs = sum / samples.length;
    const p99Ms =
      samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.99))];
    const opsPerSec = meanMs > 0 ? 1000 / meanMs : Infinity;

    const stats: BenchStats = {
      name,
      iterations: samples.length,
      meanMs,
      p99Ms,
      opsPerSec,
    };
    benchResults.push(stats);
    console.log(
      `[BENCH] ${stats.name}: ${stats.opsPerSec.toFixed(1)} ops/s | mean=${stats.meanMs.toFixed(3)}ms | p99=${stats.p99Ms.toFixed(3)}ms | n=${stats.iterations}`
    );
    expect(stats.iterations).toBeGreaterThan(0);
  });
}
import {
  Viewport,
  initWasm,
  resetWasmArena,
  uploadStaticRings,
  encodeRings16,
  hitTestPoints,
  encodePoints16,
  uploadStaticPoints,
  latLonToNormInto,
  getWrappedSlices,
  prepareArcs,
  drawTrajectories,
  packPoints,
  drawBatchPoints,
  drawVectorLayers,
  getWasmMemoryStats,
  parseGeobuf,
  boundsIntersects,
  packHeatmapPoints,
  drawHeatmap,
  buildHeatmapPalette,
  type HeatmapScratch,
  type StaticGeometryHandle,
  type StaticPointsHandle,
  type PreparedFeature,
  type Point2D,
  type TrajectoryItem,
  type PointItem,
  type PreparedLayer,
} from 'map543-2d';
import {
  QUADRATIC_ARC_POINTS,
  computeArcsBatch,
  projectMercator,
  xyToSvgPath,
} from '../core/curves';
import { projectPointsToScratch } from '../core/batch';

const defaultGzPath = resolve(
  import.meta.dirname,
  '../../../../../backend/internal/assets/maps/WorldMap-all.geobuf.gz'
);
const localGeobufPath = resolve(
  import.meta.dirname,
  '../data/WorldMap-all.geobuf'
);
const worldGeobufPath =
  process.env.WORLD_GEOBUF_PATH ??
  (existsSync(defaultGzPath) ? defaultGzPath : localGeobufPath);

const noopCtx = {
  moveTo: () => {},
  lineTo: () => {},
  closePath: () => {},
  save: () => {},
  restore: () => {},
  beginPath: () => {},
  fill: () => {},
  stroke: () => {},
  arc: () => {},
  rect: () => {},
  quadraticCurveTo: () => {},
  drawImage: () => {},
  setLineDash: () => {},
} as unknown as CanvasRenderingContext2D;

function createPointDataset(count: number): {
  count: number;
  lats: Float32Array;
  lons: Float32Array;
} {
  const lats = new Float32Array(count);
  const lons = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    lats[i] = ((i * 37) % 140) - 70;
    lons[i] = ((i * 73) % 360) - 180;
  }
  return { count, lats, lons };
}

function createSyntheticFeatures(count: number): PreparedFeature[] {
  const features: PreparedFeature[] = [];
  const ringPts = 24;
  for (let i = 0; i < count; i++) {
    const cx = ((i * 37) % 320) / 360 + 0.05;
    const cy = ((i * 53) % 140) / 180 + 0.1;
    const r = 0.015;
    const packedXY = new Float32Array(ringPts * 2);
    for (let p = 0; p < ringPts; p++) {
      const a = (p / (ringPts - 1)) * Math.PI * 2;
      packedXY[p * 2] = cx + Math.cos(a) * r;
      packedXY[p * 2 + 1] = cy + Math.sin(a) * r;
    }
    const minLon = (cx - r) * 360 - 180;
    const maxLon = (cx + r) * 360 - 180;
    const minLat = 90 - (cy + r) * 180;
    const maxLat = 90 - (cy - r) * 180;
    features.push({
      packedXY,
      ringLengths: new Int32Array([ringPts * 2]),
      ringCount: 1,
      isPolygon: true,
      minLon,
      minLat,
      maxLon,
      maxLat,
    });
  }
  return features;
}

let worldGeobufBuffer: ArrayBuffer | null = null;
let landFeatures: PreparedFeature[] = [];
const landHandles: Array<{
  feature: PreparedFeature;
  handle: StaticGeometryHandle;
}> = [];
const landHandlesU16: Array<{
  feature: PreparedFeature;
  handle: StaticGeometryHandle;
}> = [];
let staticPts10k: StaticPointsHandle | null = null;
let staticPts50k: StaticPointsHandle | null = null;

const viewportZoom1 = new Viewport({
  center: [20, 10],
  zoom: 1.5,
  width: 1920,
  height: 1080,
});
const viewportZoom4 = new Viewport({
  center: [25.033, 121.5654],
  zoom: 4,
  width: 1920,
  height: 1080,
});

const pts100 = createPointDataset(100);
const pts1000 = createPointDataset(1000);
const pts10000 = createPointDataset(10000);
const pts50000 = createPointDataset(50000);
const pts10000I16 = encodePoints16(pts10000.lats, pts10000.lons);
const pts50000I16 = encodePoints16(pts50000.lats, pts50000.lons);

const RUN_BENCH = process.env.RUN_BENCH === '1';

beforeAll(() => {
  if (!RUN_BENCH) return;
  initWasm();
  resetWasmArena();

  if (existsSync(worldGeobufPath)) {
    const fileBytes = readFileSync(worldGeobufPath);
    const raw =
      fileBytes[0] === 0x1f && fileBytes[1] === 0x8b
        ? gunzipSync(fileBytes)
        : fileBytes;
    worldGeobufBuffer = raw.buffer.slice(
      raw.byteOffset,
      raw.byteOffset + raw.byteLength
    );

    const { fillLayers } = parseGeobuf(worldGeobufBuffer, 'land');
    const land = fillLayers.find((l) => l.name === 'land');
    landFeatures = land ? land.features : [];
  } else {
    // Deterministic fallback for CI environments without WorldMap-all.geobuf
    landFeatures = createSyntheticFeatures(500);
  }

  for (const f of landFeatures) {
    const h = uploadStaticRings(f.packedXY, f.ringLengths, f.ringCount);
    if (h) {
      landHandles.push({ feature: f, handle: h });
    }
    const hu16 = uploadStaticRings(
      encodeRings16(f.packedXY),
      f.ringLengths,
      f.ringCount
    );
    if (hu16) {
      landHandlesU16.push({ feature: f, handle: hu16 });
    }
  }
  staticPts10k = uploadStaticPoints(pts10000.lats, pts10000.lons);
  staticPts50k = uploadStaticPoints(pts50000.lats, pts50000.lons);
});

describe.runIf(RUN_BENCH)('1. Geobuf parsing (WorldMap-all)', () => {
  bench('parseGeobuf (4,876 features)', () => {
    if (!worldGeobufBuffer) return;
    parseGeobuf(worldGeobufBuffer, 'land');
  });
});

describe.runIf(RUN_BENCH)('3. Hit-Test (WASM)', () => {
  bench('hitTestPoints (WASM) - 100 pts', () => {
    hitTestPoints(960, 540, pts100, viewportZoom4, 16);
  });

  bench('hitTestPoints (WASM) - 1,000 pts', () => {
    hitTestPoints(960, 540, pts1000, viewportZoom4, 16);
  });

  bench('hitTestPoints (WASM) - 10,000 pts', () => {
    hitTestPoints(960, 540, pts10000, viewportZoom4, 16);
  });
  bench('hitTestStaticPoints (WASM Arena zero-copy) - 10,000 pts', () => {
    if (staticPts10k) {
      hitTestPoints(960, 540, staticPts10k, viewportZoom4, 16);
    }
  });
  bench('hitTestPointsI16 (WASM i16) - 10,000 pts', () => {
    hitTestPoints(960, 540, pts10000I16, viewportZoom4, 16);
  });

  bench('Viewport.projectInto loop (JS) - 50,000 pts', () => {
    const out: Point2D = { x: 0, y: 0 };
    for (let i = 0; i < pts50000.count; i++) {
      viewportZoom4.projectInto(pts50000.lats[i], pts50000.lons[i], out);
    }
  });
  bench('projectPointsToScratch (WASM f32) - 50,000 pts', () => {
    projectPointsToScratch(pts50000, viewportZoom4, 32);
  });
  bench('projectPointsToScratch (WASM static arena) - 50,000 pts', () => {
    if (staticPts50k) {
      projectPointsToScratch(staticPts50k, viewportZoom4, 32);
    }
  });
  bench('projectPointsToScratch (WASM i16) - 50,000 pts', () => {
    projectPointsToScratch(pts50000I16, viewportZoom4, 32);
  });
});

describe.runIf(RUN_BENCH)('4. Projection & Bezier Curves', () => {
  const normOut: Point2D = { x: 0, y: 0 };

  bench('latLonToNormInto x 1,000', () => {
    for (let i = 0; i < 1000; i++) {
      latLonToNormInto(pts1000.lats[i], pts1000.lons[i], normOut);
    }
  });

  bench('getWrappedSlices', () => {
    getWrappedSlices(viewportZoom1.getState(), 2);
  });

  const arcCount = 500;
  const arcSrcLats = new Float32Array(arcCount).fill(25.033);
  const arcSrcLons = new Float32Array(arcCount).fill(121.5654);
  const arcDstLats = new Float32Array(arcCount).fill(37.7749);
  const arcDstLons = new Float32Array(arcCount).fill(-122.4194);
  const arcOut = new Float32Array(arcCount * QUADRATIC_ARC_POINTS * 2);

  bench('computeArcsBatch x 500 (zero-alloc Float32Array)', () => {
    computeArcsBatch(
      arcSrcLats,
      arcSrcLons,
      arcDstLats,
      arcDstLons,
      arcCount,
      arcOut
    );
  });
});

describe.runIf(RUN_BENCH)('5. Trajectory, PointLayer & VectorLayer', () => {
  const arcCount500 = 500;
  const ptCount6500 = arcCount500 * QUADRATIC_ARC_POINTS;
  const srcLats500 = new Float32Array(arcCount500).fill(25.033);
  const srcLons500 = new Float32Array(arcCount500).fill(121.5654);
  const dstLats500 = new Float32Array(arcCount500).fill(37.7749);
  const dstLons500 = new Float32Array(arcCount500).fill(-122.4194);
  const arcLatLon500 = new Float32Array(ptCount6500 * 2);
  const projectedXY6500 = new Float32Array(ptCount6500 * 2);
  const tmpPt = { x: 0, y: 0 };

  bench('JS viewport.projectInto x 6,500 (500 arcs)', () => {
    computeArcsBatch(
      srcLats500,
      srcLons500,
      dstLats500,
      dstLons500,
      arcCount500,
      arcLatLon500
    );
    for (let i = 0; i < ptCount6500; i++) {
      viewportZoom1.projectInto(
        arcLatLon500[i * 2],
        arcLatLon500[i * 2 + 1],
        tmpPt
      );
    }
  });

  bench('WASM projectMercator x 6,500 (500 arcs)', () => {
    computeArcsBatch(
      srcLats500,
      srcLons500,
      dstLats500,
      dstLons500,
      arcCount500,
      arcLatLon500
    );
    projectMercator(arcLatLon500, ptCount6500, viewportZoom1, projectedXY6500);
  });

  const makeSpecs = (n: number): TrajectoryItem[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `t-${i}`,
      srcLat: ((i * 37) % 140) - 70,
      srcLon: ((i * 73) % 360) - 180,
      dstLat: 25.033,
      dstLon: 121.5654,
      color: i % 2 === 0 ? '#52c41a' : '#d45d5d',
    }));

  const specs500 = makeSpecs(500);
  const specs1000 = makeSpecs(1000);
  const svgOutXY1000 = new Float32Array(1000 * QUADRATIC_ARC_POINTS * 2);

  bench('prepareArcs + SVG paths x 500', () => {
    const batch = prepareArcs(specs500);
    if (batch.arcBuffer) {
      projectMercator(
        batch.arcBuffer,
        batch.arcCount * QUADRATIC_ARC_POINTS,
        viewportZoom1,
        svgOutXY1000
      );
      const stride = QUADRATIC_ARC_POINTS * 2;
      for (let i = 0; i < batch.arcCount; i++) {
        xyToSvgPath(svgOutXY1000, i * stride, QUADRATIC_ARC_POINTS);
      }
    }
  });

  bench('WASM (prepareArcs + projectMercator + SVG paths) x 1,000', () => {
    const batch = prepareArcs(specs1000);
    if (batch.arcBuffer) {
      projectMercator(
        batch.arcBuffer,
        batch.arcCount * QUADRATIC_ARC_POINTS,
        viewportZoom1,
        svgOutXY1000
      );
      const stride = QUADRATIC_ARC_POINTS * 2;
      for (let i = 0; i < batch.arcCount; i++) {
        xyToSvgPath(svgOutXY1000, i * stride, QUADRATIC_ARC_POINTS);
      }
    }
  });

  const screenSrcXY1000 = new Float32Array(1000 * 2);
  for (let i = 0; i < 1000; i++) {
    screenSrcXY1000[i * 2] = (i * 53) % 1920;
    screenSrcXY1000[i * 2 + 1] = (i * 29) % 1080;
  }

  bench('drawTrajectories x 1,000 (Canvas)', () => {
    drawTrajectories(
      noopCtx,
      screenSrcXY1000,
      1000,
      960,
      540,
      1920,
      1080,
      '#d45d5d',
      null
    );
  });

  const pointItems5000: PointItem[] = Array.from({ length: 5000 }, (_, i) => ({
    lat: ((i * 37) % 140) - 70,
    lon: ((i * 73) % 360) - 180,
    radius: 4 + (i % 5) * 3,
    color: i % 2 === 0 ? '#d45d5d' : '#ebb14d',
    alpha: 0.35 + (i % 4) * 0.15,
  }));
  const pointSpatial5000 = packPoints(pointItems5000);

  bench('drawBatchPoints x 5,000 (PointLayer)', () => {
    drawBatchPoints(noopCtx, viewportZoom1, pointItems5000, pointSpatial5000);
  });

  bench('drawVectorLayers (WorldMap idle, WASM static rings)', () => {
    const fillLayers: PreparedLayer[] = [
      {
        name: 'land',
        style: { fillColor: '#2a2a2a', fillOpacity: 1 },
        features: landFeatures,
      },
    ];
    const handles = new WeakMap<PreparedFeature, StaticGeometryHandle>();
    for (const item of landHandles) {
      handles.set(item.feature, item.handle);
    }
    drawVectorLayers(
      noopCtx,
      viewportZoom1.getState(),
      fillLayers,
      [],
      handles,
      { isInteracting: false }
    );
  });
});

describe.runIf(RUN_BENCH)('6. Legacy vs New, Geometry & Viewport', () => {
  const legacyPoints5000: PointItem[] = Array.from(
    { length: 5000 },
    (_, i) => ({
      lat: ((i * 37) % 140) - 70,
      lon: ((i * 73) % 360) - 180,
      radius: 4 + (i % 5) * 3,
      color: i % 2 === 0 ? '#d45d5d' : '#ebb14d',
      alpha: 0.35 + (i % 4) * 0.15,
    })
  );
  const legacyPt = { x: 0, y: 0 };

  bench(
    'Legacy JS PointLayer x 5,000 (per-point projectInto + arc + fill)',
    () => {
      for (let i = 0; i < legacyPoints5000.length; i++) {
        const p = legacyPoints5000[i];
        viewportZoom1.projectInto(p.lat, p.lon, legacyPt);
        noopCtx.beginPath();
        noopCtx.fillStyle = p.color;
        noopCtx.globalAlpha = p.alpha ?? 0.7;
        noopCtx.arc(legacyPt.x, legacyPt.y, p.radius, 0, Math.PI * 2);
        noopCtx.fill();
      }
    }
  );

  bench('drawVectorLayers (WorldMap interacting, LOD + culling)', () => {
    const fillLayers: PreparedLayer[] = [
      {
        name: 'land',
        style: { fillColor: '#2a2a2a', fillOpacity: 1 },
        features: landFeatures,
      },
    ];
    const handles = new WeakMap<PreparedFeature, StaticGeometryHandle>();
    for (const item of landHandles) {
      handles.set(item.feature, item.handle);
    }
    drawVectorLayers(
      noopCtx,
      viewportZoom1.getState(),
      fillLayers,
      [],
      handles,
      { isInteracting: true }
    );
  });

  const benchCam = new Viewport({
    center: [20, 10],
    zoom: 2,
    width: 1920,
    height: 1080,
  });

  bench('Viewport panBy + zoomAt + getBounds x 1,000', () => {
    for (let i = 0; i < 1000; i++) {
      benchCam.panBy(1, -1);
      benchCam.zoomAt(960, 540, 0.01);
      benchCam.getBounds();
    }
  });
});

describe.runIf(RUN_BENCH)(
  '7. Memory & Arena Footprint (f32 vs u16 / i16)',
  () => {
    it('verifies ~50% WASM arena reduction for u16 static rings', () => {
      resetWasmArena();
      for (const f of landFeatures) {
        uploadStaticRings(f.packedXY, f.ringLengths, f.ringCount);
      }
      const f32Stats = getWasmMemoryStats();

      resetWasmArena();
      for (const f of landFeatures) {
        uploadStaticRings(
          encodeRings16(f.packedXY),
          f.ringLengths,
          f.ringCount
        );
      }
      const u16Stats = getWasmMemoryStats();

      console.log(
        `[MEM] Static Arena: f32=${(f32Stats.arenaUsedBytes / 1024).toFixed(1)} KiB | u16=${(u16Stats.arenaUsedBytes / 1024).toFixed(1)} KiB | ratio=${(u16Stats.arenaUsedBytes / Math.max(1, f32Stats.arenaUsedBytes)).toFixed(2)}`
      );
      expect(u16Stats.arenaUsedBytes).toBeLessThan(f32Stats.arenaUsedBytes);
    });

    it('verifies 50% JS TypedArray reduction for 16-bit points', () => {
      const items50k: PointItem[] = Array.from({ length: 50000 }, (_, i) => ({
        lat: ((i * 37) % 140) - 70,
        lon: ((i * 73) % 360) - 180,
        radius: 4,
        color: '#0ebf9c',
      }));
      const f32Buf = packPoints(items50k, 32);
      const i16Buf = packPoints(items50k, 16);
      const f32Bytes = f32Buf.lats.byteLength + f32Buf.lons.byteLength;
      const i16Bytes = i16Buf.lats.byteLength + i16Buf.lons.byteLength;

      const mem = process.memoryUsage();
      console.log(
        `[MEM] 50k Points: f32=${(f32Bytes / 1024).toFixed(1)} KiB | i16=${(i16Bytes / 1024).toFixed(1)} KiB | heapUsed=${(mem.heapUsed / 1048576).toFixed(1)} MiB`
      );
      expect(i16Bytes).toBe(f32Bytes / 2);
    });
  }
);

describe.skipIf(!RUN_BENCH)(
  '8. Trajectory Bounds Culling (100 vs 1,000 Arcs)',
  () => {
    const zoomedView = new Viewport({
      center: [30, 125],
      zoom: 5,
      width: 1280,
      height: 720,
    });
    const viewBounds = zoomedView.getBounds();

    const makeGlobalArcs = (n: number) => {
      const srcXY = new Float32Array(n * 2);
      const dstXY = new Float32Array(n * 2);
      const items: TrajectoryItem[] = [];
      const arcBounds: Array<[[number, number], [number, number]]> = [];
      for (let i = 0; i < n; i++) {
        const inRegion = i % 5 === 0; // ~20% intersect East Asia viewport
        const sLat = inRegion ? 22 + (i % 12) : -35 + ((i * 17) % 70);
        const sLon = inRegion ? 115 + (i % 15) : -100 + ((i * 29) % 120);
        const dLat = inRegion ? 25 + (i % 10) : -30 + ((i * 13) % 60);
        const dLon = inRegion ? 120 + (i % 12) : -90 + ((i * 23) % 110);
        items.push({ src: [sLat, sLon], dst: [dLat, dLon] });
        arcBounds.push([
          [Math.min(sLat, dLat), Math.min(sLon, dLon)],
          [Math.max(sLat, dLat), Math.max(sLon, dLon)],
        ]);
        const sp = zoomedView.project(sLat, sLon);
        const dp = zoomedView.project(dLat, dLon);
        srcXY[i * 2] = sp.x;
        srcXY[i * 2 + 1] = sp.y;
        dstXY[i * 2] = dp.x;
        dstXY[i * 2 + 1] = dp.y;
      }
      return { srcXY, dstXY, items, arcBounds };
    };

    const g100 = makeGlobalArcs(100);
    const g1000 = makeGlobalArcs(1000);
    const culledSrc100 = new Float32Array(100 * 2);
    const culledDst100 = new Float32Array(100 * 2);
    const culledSrc1000 = new Float32Array(1000 * 2);
    const culledDst1000 = new Float32Array(1000 * 2);

    bench('100 arcs: drawTrajectories (no bounds culling)', () => {
      drawTrajectories(noopCtx, g100.srcXY, 100, g100.dstXY, 1280, 720);
    });

    bench(
      '100 arcs: boundsIntersects + drawTrajectories (~20% visible)',
      () => {
        let k = 0;
        for (let i = 0; i < 100; i++) {
          if (!boundsIntersects(g100.arcBounds[i], viewBounds)) continue;
          culledSrc100[k * 2] = g100.srcXY[i * 2];
          culledSrc100[k * 2 + 1] = g100.srcXY[i * 2 + 1];
          culledDst100[k * 2] = g100.dstXY[i * 2];
          culledDst100[k * 2 + 1] = g100.dstXY[i * 2 + 1];
          k++;
        }
        drawTrajectories(noopCtx, culledSrc100, k, culledDst100, 1280, 720);
      }
    );

    bench('1,000 arcs: drawTrajectories (no bounds culling)', () => {
      drawTrajectories(noopCtx, g1000.srcXY, 1000, g1000.dstXY, 1280, 720);
    });

    bench(
      '1,000 arcs: boundsIntersects + drawTrajectories (~20% visible)',
      () => {
        let k = 0;
        for (let i = 0; i < 1000; i++) {
          if (!boundsIntersects(g1000.arcBounds[i], viewBounds)) continue;
          culledSrc1000[k * 2] = g1000.srcXY[i * 2];
          culledSrc1000[k * 2 + 1] = g1000.srcXY[i * 2 + 1];
          culledDst1000[k * 2] = g1000.dstXY[i * 2];
          culledDst1000[k * 2 + 1] = g1000.dstXY[i * 2 + 1];
          k++;
        }
        drawTrajectories(noopCtx, culledSrc1000, k, culledDst1000, 1280, 720);
      }
    );

    bench('1,000 arcs: prepareArcs (no bounds culling)', () => {
      prepareArcs(g1000.items);
    });

    bench('1,000 arcs: boundsIntersects + prepareArcs (~20% visible)', () => {
      const visible = g1000.items.filter((_, i) =>
        boundsIntersects(g1000.arcBounds[i], viewBounds)
      );
      prepareArcs(visible);
    });
  }
);

describe.skipIf(!RUN_BENCH)(
  '9. WASM Heatmap (f32 vs i16 vs Canvas 2D) & Memory Footprint',
  () => {
    const heatView = new Viewport({
      center: [25, 121],
      zoom: 4,
      width: 1280,
      height: 720,
    });
    const pts10k = Array.from({ length: 10000 }, (_, i) => ({
      lat: 10 + ((i * 37) % 35),
      lon: 100 + ((i * 73) % 45),
      weight: 1 + (i % 3) * 0.5,
    }));
    const palette = buildHeatmapPalette();
    resetWasmArena();
    const hm32 = packHeatmapPoints(pts10k, 32);
    const hm16 = packHeatmapPoints(pts10k, 16);
    const pt2d = { x: 0, y: 0 };

    const heatCtx = {
      ...noopCtx,
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    const makeHeatScratch = (): HeatmapScratch => ({
      offscreen: { width: 0, height: 0 } as unknown as HTMLCanvasElement,
      offCtx: {
        createImageData: (w: number, h: number) =>
          ({
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4),
          }) as unknown as ImageData,
        putImageData: () => {},
      } as unknown as CanvasRenderingContext2D,
    });
    const scratch32 = makeHeatScratch();
    const scratch16 = makeHeatScratch();

    bench('10k pts Heatmap: drawHeatmap WASM f32 (1280x720 @ 0.25x)', () => {
      drawHeatmap(
        noopCtx,
        hm32,
        heatView,
        { gridScale: 0.25, radiusPx: 24, palette },
        scratch32
      );
    });

    bench('10k pts Heatmap: drawHeatmap WASM i16 (1280x720 @ 0.25x)', () => {
      drawHeatmap(
        noopCtx,
        hm16,
        heatView,
        { gridScale: 0.25, radiusPx: 24, palette },
        scratch16
      );
    });

    bench('10k pts Heatmap: Legacy JS projectInto + Canvas arc loop', () => {
      for (let i = 0; i < pts10k.length; i++) {
        heatView.projectInto(pts10k[i].lat, pts10k[i].lon, pt2d);
        if (pt2d.x < -24 || pt2d.x > 1304 || pt2d.y < -24 || pt2d.y > 744) {
          continue;
        }
        heatCtx.beginPath();
        heatCtx.arc(pt2d.x, pt2d.y, 24, 0, Math.PI * 2);
        heatCtx.fill();
      }
    });

    it('reports memory footprint: f32 vs i16 buffers and 0.25x vs 1x grid', () => {
      const f32Bytes =
        hm32.lats.byteLength +
        hm32.lons.byteLength +
        (hm32.weights?.byteLength ?? 0);
      const i16Bytes =
        hm16.lats.byteLength +
        hm16.lons.byteLength +
        (hm16.weights?.byteLength ?? 0);
      const gridQuarterBytes = 320 * 180 * 4;
      const gridFullBytes = 1280 * 720 * 4;

      console.log(
        `[MEM] 10k Heatmap Points: f32=${(f32Bytes / 1024).toFixed(1)} KiB | i16=${(i16Bytes / 1024).toFixed(1)} KiB | RGBA grid: 0.25x=${(gridQuarterBytes / 1024).toFixed(1)} KiB vs 1x=${(gridFullBytes / 1024).toFixed(1)} KiB`
      );
      expect(i16Bytes).toBeLessThan(f32Bytes);
      expect(gridQuarterBytes).toBe(gridFullBytes / 16);
    });
  }
);

afterAll(() => {
  if (RUN_BENCH && process.env.BENCH_JSON === '1') {
    console.log(
      `[BENCH_JSON] ${JSON.stringify({
        timestamp: new Date().toISOString(),
        wasm: getWasmMemoryStats(),
        results: benchResults,
      })}`
    );
  }
});

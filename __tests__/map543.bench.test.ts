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
  drawRings,
  hitTestPoints,
  encodePoints16,
  batchProjectPoints,
  uploadStaticPoints,
  latLonToNormInto,
  getWrappedSlices,
  computeArcsBatch,
  projectMercator,
  xyToSvgPath,
  prepareArcs,
  drawTrajectories,
  packPoints,
  drawBatchPoints,
  drawVectorLayers,
  splitAntimeridianRing,
  decodeLocDict,
  getWasmMemoryStats,
  parseGeobuf,
  type StaticGeometryHandle,
  type StaticPointsHandle,
  type PreparedFeature,
  type Point2D,
  type TrajectoryItem,
  type PointItem,
  type PreparedLayer,
} from 'map543-2d';
import { QUADRATIC_ARC_POINTS } from '../core/curves';

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

const batchOutXY = new Float32Array(50000 * 2);
const batchOutIdx = new Int32Array(50000);

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

describe.runIf(RUN_BENCH)(
  '2. Vector LOD & Static Arena (WorldMap-all land layer)',
  () => {
    bench('drawStaticDirect (WASM Arena zero-copy, zoom 1.5)', () => {
      const state = viewportZoom1.getState();
      const { scale, offsetY, viewLatMin, viewLatMax, slices } =
        getWrappedSlices(state, 2);
      for (const { drawOffsetX, adjLonMin, adjLonMax } of slices) {
        for (const { feature: f, handle } of landHandles) {
          if (
            f.maxLon < adjLonMin ||
            f.minLon > adjLonMax ||
            f.maxLat < viewLatMin ||
            f.minLat > viewLatMax
          ) {
            continue;
          }
          drawRings(noopCtx, handle, scale, drawOffsetX, offsetY, 1.0, true);
        }
      }
    });

    bench('drawStaticDirect (WASM Arena zero-copy, zoom 4)', () => {
      const state = viewportZoom4.getState();
      const { scale, offsetY, viewLatMin, viewLatMax, slices } =
        getWrappedSlices(state, 2);
      for (const { drawOffsetX, adjLonMin, adjLonMax } of slices) {
        for (const { feature: f, handle } of landHandles) {
          if (
            f.maxLon < adjLonMin ||
            f.minLon > adjLonMax ||
            f.maxLat < viewLatMin ||
            f.minLat > viewLatMax
          ) {
            continue;
          }
          drawRings(noopCtx, handle, scale, drawOffsetX, offsetY, 1.0, true);
        }
      }
    });

    bench('drawStaticU16Direct (WASM u16 Arena, zoom 1.5)', () => {
      const state = viewportZoom1.getState();
      const { scale, offsetY, viewLatMin, viewLatMax, slices } =
        getWrappedSlices(state, 2);
      for (const { drawOffsetX, adjLonMin, adjLonMax } of slices) {
        for (const { feature: f, handle } of landHandlesU16) {
          if (
            f.maxLon < adjLonMin ||
            f.minLon > adjLonMax ||
            f.maxLat < viewLatMin ||
            f.minLat > viewLatMax
          ) {
            continue;
          }
          drawRings(noopCtx, handle, scale, drawOffsetX, offsetY, 1.0, true);
        }
      }
    });

    bench('drawStaticU16Direct (WASM u16 Arena, zoom 4)', () => {
      const state = viewportZoom4.getState();
      const { scale, offsetY, viewLatMin, viewLatMax, slices } =
        getWrappedSlices(state, 2);
      for (const { drawOffsetX, adjLonMin, adjLonMax } of slices) {
        for (const { feature: f, handle } of landHandlesU16) {
          if (
            f.maxLon < adjLonMin ||
            f.minLon > adjLonMax ||
            f.maxLat < viewLatMin ||
            f.minLat > viewLatMax
          ) {
            continue;
          }
          drawRings(noopCtx, handle, scale, drawOffsetX, offsetY, 1.0, true);
        }
      }
    });
  }
);

describe.runIf(RUN_BENCH)('3. Hit-Test & Batch Projection (WASM)', () => {
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
  bench('batchProjectPoints (WASM) - 50,000 pts', () => {
    batchProjectPoints(
      pts50000.lats,
      pts50000.lons,
      pts50000.count,
      viewportZoom4,
      32,
      batchOutXY,
      batchOutIdx
    );
  });
  bench('batchProjectStaticPoints (WASM Arena zero-copy) - 50,000 pts', () => {
    if (staticPts50k) {
      batchProjectPoints(
        staticPts50k,
        viewportZoom4,
        32,
        batchOutXY,
        batchOutIdx
      );
    }
  });
  bench('batchProjectPointsI16 (WASM i16) - 50,000 pts', () => {
    batchProjectPoints(pts50000I16, viewportZoom4, 32, batchOutXY, batchOutIdx);
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
  const ptOutXY5000 = new Float32Array(5000 * 2);
  const ptOutIdx5000 = new Int32Array(5000);

  bench('drawBatchPoints x 5,000 (PointLayer)', () => {
    drawBatchPoints(
      noopCtx,
      viewportZoom1,
      pointItems5000,
      pointSpatial5000,
      ptOutXY5000,
      ptOutIdx5000
    );
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

  const seamFloatLen = 2000 * 2;
  const seamInLonLat = new Float32Array(seamFloatLen);
  for (let i = 0; i < 2000; i++) {
    seamInLonLat[i * 2] = i % 2 === 0 ? 179.5 : -179.5;
    seamInLonLat[i * 2 + 1] = ((i * 19) % 140) - 70;
  }
  const seamOutLonLat = new Float32Array(seamFloatLen);
  const seamOutSegLens = new Int32Array(2000);
  const seamOutBbox = new Float32Array(4);

  bench(
    'splitAntimeridianRing (WASM antimeridian split, 2,000 vertices)',
    () => {
      splitAntimeridianRing(
        seamInLonLat,
        seamFloatLen,
        seamOutLonLat,
        seamOutSegLens,
        seamOutBbox
      );
    }
  );

  const locCount = 5000;
  const locRawBytes = new Uint8Array(locCount * 6);
  const locLatsOut = new Float32Array(locCount);
  const locLonsOut = new Float32Array(locCount);
  const locMxsOut = new Float32Array(locCount);
  const locMysOut = new Float32Array(locCount);

  bench('WASM decodeLocDict x 5,000', () => {
    decodeLocDict(
      locRawBytes,
      locCount,
      locLatsOut,
      locLonsOut,
      locMxsOut,
      locMysOut
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

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  Viewport,
  buildHeatmapPalette,
  packHeatmapPoints,
  packHeatmapArrays,
  sliceHeatmapByTime,
  drawHeatmap,
  packPoints,
  drawBatchPoints,
  hitTestPointBuffers,
  type HeatmapScratch,
  type PointItem,
  resetWasmArena,
} from '../core';
import { MapView, HeatmapLayer } from '../index';

function createMockHeatmapCtx(): CanvasRenderingContext2D {
  return {
    save: () => {},
    restore: () => {},
    drawImage: () => {},
    globalAlpha: 1,
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
}

function createMockHeatmapScratch(): HeatmapScratch {
  return {
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
  };
}

describe('WASM Heatmap / Pixel-Matrix', () => {
  it('builds a 1024-byte RGBA palette LUT with transparent 0 and peak 255', () => {
    const lut = buildHeatmapPalette();
    expect(lut.byteLength).toBe(1024);
    expect(lut[3]).toBe(0); // transparent at zero density
    expect(lut[255 * 4]).toBe(239); // #ef4444ff -> R=239
    expect(lut[255 * 4 + 3]).toBe(255);
  });

  it('packs 16-bit points with 50% TypedArray memory reduction vs 32-bit', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({
      lat: ((i * 17) % 140) - 70,
      lon: ((i * 31) % 360) - 180,
      weight: 1,
    }));
    const b32 = packHeatmapPoints(pts, 32);
    const b16 = packHeatmapPoints(pts, 16);
    const bytes32 = b32.lats.byteLength + b32.lons.byteLength;
    const bytes16 = b16.lats.byteLength + b16.lons.byteLength;
    expect(bytes16).toBe(bytes32 / 2);
  });

  it('computes downsampled RGBA grid in WASM for both f32 and i16 inputs', () => {
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 400,
      height: 300,
    });
    const pts = [
      { lat: 25, lon: 121, weight: 2 },
      { lat: 25.01, lon: 121.01, weight: 2 },
      { lat: Number.NaN, lon: 121, weight: 1 }, // safely ignored
    ];

    const ctx = createMockHeatmapCtx();
    const scratch32 = createMockHeatmapScratch();
    const scratch16 = createMockHeatmapScratch();

    const ok32 = drawHeatmap(
      ctx,
      packHeatmapPoints(pts, 32),
      vp,
      { gridScale: 0.25, radiusPx: 20, maxIntensity: 2 },
      scratch32
    );
    const ok16 = drawHeatmap(
      ctx,
      packHeatmapPoints(pts, 16),
      vp,
      { gridScale: 0.25, radiusPx: 20, maxIntensity: 2 },
      scratch16
    );

    expect(ok32).toBe(true);
    expect(ok16).toBe(true);
    expect(scratch32.offscreen?.width).toBe(100);
    expect(scratch32.offscreen?.height).toBe(75);

    const cx = 50;
    const cy = 37;
    const centerAlpha32 =
      scratch32.imageData?.data[(cy * 100 + cx) * 4 + 3] ?? 0;
    const centerAlpha16 =
      scratch16.imageData?.data[(cy * 100 + cx) * 4 + 3] ?? 0;
    const cornerAlpha = scratch32.imageData?.data[3] ?? 255;

    expect(centerAlpha32).toBeGreaterThan(200);
    expect(centerAlpha16).toBeGreaterThan(200);
    expect(cornerAlpha).toBe(0);
  });

  it('renders <HeatmapLayer /> inside <MapView /> without errors', () => {
    const pts = [{ lat: 25, lon: 121, weight: 1.5 }];
    const { container } = render(
      React.createElement(
        MapView,
        { center: [25, 121], zoom: 5 },
        React.createElement(HeatmapLayer, { points: pts, precision: 16 })
      )
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('supports SoA packHeatmapArrays, O(log N) Uint16 time slicing, and arena epoch auto-recovery', () => {
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 400,
      height: 300,
    });
    const lats = new Int16Array([
      Math.round((25 / 90) * 32767),
      Math.round((25 / 90) * 32767),
      Math.round((25 / 90) * 32767),
    ]);
    const lons = new Int16Array([
      Math.round((121 / 180) * 32767),
      Math.round((121 / 180) * 32767),
      Math.round((121 / 180) * 32767),
    ]);
    const times = new Uint16Array([10, 600, 1200]); // minutes in 24h
    const buffers = packHeatmapArrays({ lats, lons, times });

    const slice = sliceHeatmapByTime(buffers, 500, 1000);
    expect(slice).toEqual({ startIndex: 1, count: 1 });

    // Force arena epoch bump and verify auto-recovery
    resetWasmArena();
    const scratch = createMockHeatmapScratch();
    const ok = drawHeatmap(
      createMockHeatmapCtx(),
      buffers,
      vp,
      {
        gridScale: 0.25,
        radiusPx: 20,
        maxIntensity: 1,
        timeRange: [500, 1000],
      },
      scratch
    );
    expect(ok).toBe(true);
    expect(scratch.imageData?.data[(37 * 100 + 50) * 4 + 3]).toBeGreaterThan(
      200
    );
  });

  it('avoids dark RGB halo at transparent stop edges and preserves gradient for dense clusters', () => {
    const lut = buildHeatmapPalette([
      { offset: 0, color: '#00000000' },
      { offset: 0.25, color: '#0ea5e988' },
      { offset: 1, color: '#ef4444ff' },
    ]);
    // At offset ~0.125 (index 32), RGB should stay sky-blue (#0ea5e9) instead of darkening toward black
    expect(lut[32 * 4]).toBe(14);
    expect(lut[32 * 4 + 1]).toBe(165);
    expect(lut[32 * 4 + 2]).toBe(233);
    expect(lut[32 * 4 + 3]).toBeGreaterThan(40);

    // 50 overlapping points with maxIntensity='viewport' should peak red at center and fade outward
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 400,
      height: 300,
    });
    const densePts = Array.from({ length: 50 }, () => ({
      lat: 25,
      lon: 121,
      weight: 1,
    }));
    const scratch = createMockHeatmapScratch();
    const ok = drawHeatmap(
      createMockHeatmapCtx(),
      packHeatmapPoints(densePts, 32),
      vp,
      { gridScale: 0.25, radiusPx: 24, maxIntensity: 'viewport' },
      scratch
    );
    expect(ok).toBe(true);
    const data = scratch.imageData?.data;
    expect(data).toBeDefined();
    if (!data) return;
    // Center cell (50, 37) should hit peak red (#ef4444)
    const centerIdx = (37 * 100 + 50) * 4;
    expect(data[centerIdx]).toBeGreaterThan(220);
    // Outer ring cell (50 + 5, 37) should NOT be saturated solid red
    const outerIdx = (37 * 100 + 55) * 4;
    expect(data[outerIdx]).toBeLessThan(200);
    expect(data[outerIdx + 3]).toBeGreaterThan(0);
  });

  it('keeps low-weight hotspot RGBA stable when panning a high-weight hotspot out of viewport in default global mode', () => {
    const pts = [
      { lat: 25, lon: 121, weight: 10 },
      { lat: 25, lon: 118, weight: 100 },
    ];
    const buffers = packHeatmapPoints(pts, 32);
    expect(buffers.maxWeight).toBe(100);

    const soaBuffers = packHeatmapArrays({
      lats: new Float32Array([25, 25]),
      lons: new Float32Array([121, 118]),
      weights: new Float32Array([10, 100]),
    });
    expect(soaBuffers.maxWeight).toBe(100);

    const vp = new Viewport({
      center: [25, 121],
      zoom: 6,
      width: 400,
      height: 300,
    });
    const ctx = createMockHeatmapCtx();
    const scratchBefore = createMockHeatmapScratch();
    const scratchAfter = createMockHeatmapScratch();

    // Both points visible; low-weight point is at (200, 150) -> grid (50, 37)
    expect(
      drawHeatmap(
        ctx,
        buffers,
        vp,
        { gridScale: 0.25, radiusPx: 24 },
        scratchBefore
      )
    ).toBe(true);
    const beforeData = scratchBefore.imageData?.data;
    expect(beforeData).toBeDefined();
    if (!beforeData) return;
    const beforeOff = (37 * 100 + 50) * 4;
    const rgbaBefore = Array.from(beforeData.slice(beforeOff, beforeOff + 4));

    // Pan left by 120 CSS px (30 grid cells): high-weight point leaves viewport, low-weight moves to grid (20, 37)
    vp.panBy(-120, 0);
    expect(
      drawHeatmap(
        ctx,
        buffers,
        vp,
        { gridScale: 0.25, radiusPx: 24 },
        scratchAfter
      )
    ).toBe(true);
    const afterData = scratchAfter.imageData?.data;
    expect(afterData).toBeDefined();
    if (!afterData) return;
    const afterOff = (37 * 100 + 20) * 4;
    const rgbaAfter = Array.from(afterData.slice(afterOff, afterOff + 4));

    expect(rgbaAfter).toEqual(rgbaBefore);
    expect(rgbaAfter[3]).toBeGreaterThan(0);
  });

  it('supports world wrap-around and Equirectangular projection in drawHeatmap', () => {
    const ctx = createMockHeatmapCtx();

    // Antimeridian wrap-around: center at lon 175, point at lon -175 (10 deg east across ±180°)
    const wrapBuffers = packHeatmapPoints(
      [{ lat: 0, lon: -175, weight: 1 }],
      32
    );
    const vpWrap = new Viewport({
      center: [0, 175],
      zoom: 2,
      width: 400,
      height: 300,
      maxBounds: [
        [-85, -540],
        [85, 540],
      ],
    });
    const scratchWrap = createMockHeatmapScratch();
    expect(
      drawHeatmap(
        ctx,
        wrapBuffers,
        vpWrap,
        { gridScale: 0.25, radiusPx: 20 },
        scratchWrap
      )
    ).toBe(true);
    const wrapData = scratchWrap.imageData?.data;
    expect(wrapData).toBeDefined();
    if (!wrapData) return;
    // Wrapped copy lands at x = 200 + (10 / 360) * 1024 ≈ 228.44 -> gx ≈ 57
    expect(wrapData[(37 * 100 + 57) * 4 + 3]).toBeGreaterThan(100);

    // Equirectangular projection
    const eqBuffers = packHeatmapPoints([{ lat: 0, lon: 0, weight: 1 }], 32);
    const vpEq = new Viewport({
      center: [0, 0],
      zoom: 2,
      width: 400,
      height: 300,
      projection: 'equirectangular',
    });
    const scratchEq = createMockHeatmapScratch();
    expect(
      drawHeatmap(
        ctx,
        eqBuffers,
        vpEq,
        { gridScale: 0.25, radiusPx: 20 },
        scratchEq
      )
    ).toBe(true);
    const eqData = scratchEq.imageData?.data;
    expect(eqData).toBeDefined();
    if (!eqData) return;
    expect(eqData[(37 * 100 + 50) * 4 + 3]).toBeGreaterThan(100);
  });

  it('uses Uint16Array weights for 16-bit integer weights and separable 1D Gaussian blur for large point counts', () => {
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 400,
      height: 300,
    });
    const pts = Array.from({ length: 2000 }, () => ({
      lat: 25,
      lon: 121,
      weight: 2,
    }));
    const buf16 = packHeatmapPoints(pts, 16);
    expect(buf16.weights).toBeInstanceOf(Uint16Array);
    expect(buf16.maxWeight).toBe(2);

    const scratch = createMockHeatmapScratch();
    const ok = drawHeatmap(
      createMockHeatmapCtx(),
      buf16,
      vp,
      { gridScale: 0.25, radiusPx: 24, maxIntensity: 'viewport' },
      scratch
    );
    expect(ok).toBe(true);
    const data = scratch.imageData?.data;
    expect(data).toBeDefined();
    if (!data) return;
    // Separable 1D Gaussian peak at center (50, 37) and smooth decay outward
    expect(data[(37 * 100 + 50) * 4]).toBeGreaterThan(220);
    expect(data[(37 * 100 + 55) * 4]).toBeLessThan(200);
    expect(data[(37 * 100 + 55) * 4 + 3]).toBeGreaterThan(0);
  });
});

describe('Symbol Map (drawBatchPoints)', () => {
  it('draws circles individually in large-to-small order with optional strokes and restores canvas state', () => {
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 400,
      height: 300,
    });
    const points: PointItem[] = [
      { lat: 25, lon: 121, radius: 4, color: '#38bdf8', alpha: 0.6 },
      { lat: 25, lon: 121, radius: 16, color: '#38bdf8', alpha: 0.6 },
      { lat: 25, lon: 121, radius: 10, color: '#38bdf8', alpha: 0.6 },
    ];
    const drawnRadii: number[] = [];
    let fillCount = 0;
    let strokeCount = 0;
    let saved = 0;
    let restored = 0;

    const ctx = {
      save: () => {
        saved++;
      },
      restore: () => {
        restored++;
      },
      beginPath: () => {},
      arc: (_x: number, _y: number, r: number) => {
        drawnRadii.push(r);
      },
      fill: () => {
        fillCount++;
      },
      stroke: () => {
        strokeCount++;
      },
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    const spatial = packPoints(points, 32);
    drawBatchPoints(ctx, vp, points, spatial, {
      strokeColor: '#ffffff',
      strokeWidth: 1.5,
    });

    expect(saved).toBe(1);
    expect(restored).toBe(1);
    // Large-to-small Z-order (first 3 arcs in primary wrap slice)
    expect(drawnRadii.slice(0, 3)).toEqual([16, 10, 4]);
    expect(fillCount).toBe(drawnRadii.length);
    expect(strokeCount).toBe(drawnRadii.length);

    // Pre-sorted buffers use Uint16Array origIndices and preserve original index in hitTestPointBuffers
    expect(spatial.origIndices).toBeInstanceOf(Uint16Array);
    const hit = hitTestPointBuffers(200, 150, points, spatial, vp, 20);
    expect(hit).not.toBeNull();
    if (hit) {
      expect(points[hit.index]).toBe(hit.point);
    }

    // Already-sorted input skips origIndices allocation entirely
    const sortedPts: PointItem[] = [
      { lat: 25, lon: 121, radius: 16, color: '#38bdf8' },
      { lat: 25, lon: 121, radius: 8, color: '#38bdf8' },
    ];
    expect(packPoints(sortedPts, 16).origIndices).toBeNull();
  });
});

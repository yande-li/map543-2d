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
  type HeatmapScratch,
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
});

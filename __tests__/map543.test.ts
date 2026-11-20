/// <reference types="node" />
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Camera,
  MapView,
  Popup,
  Marker,
  BlanketCanvasLayer,
  attachInteractions,
  attachGamepad,
  findNearestPoint,
  hitTestPoints,
  encodePointsToI16,
  hitTestPointsI16,
  batchProjectPoints,
  batchProjectPointsI16,
  decimatePackedRings,
  uploadStaticRings,
  encodeNormU16,
  uploadStaticRingsU16,
  decimateStaticRings,
  drawStaticRings,
  drawStaticDirect,
  drawStaticU16Direct,
  cleanSeamRing,
  initWasm,
  isWasmReady,
  resetWasmArena,
  disposeWasm,
  getWasmMemoryStats,
  latToMercatorY,
  latLngToNorm,
  normToLatLng,
  createEquirectangular,
  computeArc,
  computeArcsBatch,
  QUADRATIC_ARC_POINTS,
  getWrappedSlices,
  type LatLng,
} from 'map543-2d';

const wasmBytes = readFileSync(
  resolve(import.meta.dirname, '../wasm/kernels.wasm')
);

describe('map543-2d projection', () => {
  it('round-trips normalized Mercator coordinates', () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [25.033, 121.5654],
      [-33.8688, 151.2093],
      [51.5074, -0.1278],
    ];

    for (const [lat, lon] of samples) {
      const norm = latLngToNorm(lat, lon);
      const [outLat, outLon] = normToLatLng(norm.x, norm.y);
      expect(outLat).toBeCloseTo(lat, 4);
      expect(outLon).toBeCloseTo(lon, 4);
    }
  });

  it('computes symmetric Mercator Y lookup values', () => {
    expect(latToMercatorY(0)).toBe(0);
    expect(latToMercatorY(45)).toBeCloseTo(-latToMercatorY(-45), 6);
    expect(latToMercatorY(85.05)).toBeGreaterThan(3);
  });
});

describe('Camera', () => {
  it('projects center to container midpoint and unprojects back', () => {
    const camera = new Camera({
      center: [25.033, 121.5654],
      zoom: 5,
      width: 1000,
      height: 600,
    });

    const centerPt = camera.project(25.033, 121.5654);
    expect(centerPt.x).toBeCloseTo(500, 3);
    expect(centerPt.y).toBeCloseTo(300, 3);

    const [lat, lon] = camera.unproject(500, 300);
    expect(lat).toBeCloseTo(25.033, 3);
    expect(lon).toBeCloseTo(121.5654, 3);
  });

  it('clamps zoom and center to constraints and notifies subscribers', () => {
    const camera = new Camera({
      center: [0, 0],
      zoom: 2,
      width: 800,
      height: 600,
      minZoom: 1,
      maxZoom: 8,
    });
    const listener = vi.fn();
    const unsubscribe = camera.subscribe(listener);

    camera.setConstraints({
      minZoom: 2,
      maxZoom: 6,
      maxBounds: [
        [-60, -120],
        [60, 120],
      ],
    });

    camera.setView([80, 170], 10);
    const state = camera.getState();
    expect(state.zoom).toBe(6);
    expect(state.center[0]).toBeLessThanOrEqual(60);
    expect(state.center[1]).toBeLessThanOrEqual(120);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it('pans and zooms around an anchor point', () => {
    const camera = new Camera({
      center: [0, 0],
      zoom: 3,
      width: 1000,
      height: 800,
      minZoom: 1,
      maxZoom: 10,
    });

    const anchorLatLon = camera.unproject(250, 200);
    camera.zoomAt(5, 250, 200);
    const afterPt = camera.project(anchorLatLon[0], anchorLatLon[1]);
    expect(afterPt.x).toBeCloseTo(250, 1);
    expect(afterPt.y).toBeCloseTo(200, 1);

    const beforeCenter = camera.getState().center;
    camera.panBy(100, -50);
    const afterCenter = camera.getState().center;
    expect(afterCenter[1]).toBeLessThan(beforeCenter[1]);
    expect(afterCenter[0]).toBeLessThan(beforeCenter[0]);
  });

  it('animates flyTo to target view', () => {
    vi.useFakeTimers();
    const camera = new Camera({
      center: [0, 0],
      zoom: 2,
      width: 800,
      height: 600,
    });

    camera.flyTo([35.6762, 139.6503], 5, 100);
    vi.advanceTimersByTime(150);

    const state = camera.getState();
    expect(state.center[0]).toBeCloseTo(35.6762, 2);
    expect(state.center[1]).toBeCloseTo(139.6503, 2);
    expect(state.zoom).toBeCloseTo(5, 2);
    vi.useRealTimers();
  });
});

describe('findNearestPoint', () => {
  it('returns the closest point index within radius or -1 when out of range', () => {
    const points = {
      count: 2,
      lats: new Float32Array([10, 20]),
      lons: new Float32Array([10, 20]),
    };
    const projectFn = (lat: number, lon: number) => ({
      x: lon * 10,
      y: lat * 10,
    });

    expect(findNearestPoint(103, 102, points, projectFn, 14)).toBe(0);
    expect(findNearestPoint(198, 204, points, projectFn, 14)).toBe(1);
    expect(findNearestPoint(500, 500, points, projectFn, 14)).toBe(-1);
  });
});

describe('Popup & MapView', () => {
  it('renders Popup with a downward pointer tip and supports double-click zoom', () => {
    const onMove = vi.fn();
    const { container } = render(
      React.createElement(
        MapView,
        {
          center: [25.033, 121.5654],
          zoom: 4,
          zoomDelta: 0.5,
          interactive: true,
          onMove,
        },
        React.createElement(
          Popup,
          { lat: 25.033, lon: 121.5654 },
          React.createElement('span', null, 'Taipei')
        )
      )
    );

    const tip = container.querySelector('.geo-popup-tip');
    expect(tip).not.toBeNull();
    expect(container.textContent).toContain('Taipei');

    const mapEl = container.querySelector('.geo-map-container')!;
    onMove.mockClear();
    fireEvent.doubleClick(mapEl, { clientX: 100, clientY: 100 });
    expect(onMove).toHaveBeenCalled();
  });
});

describe('WebAssembly batch kernels', () => {
  it('initializes WASM and matches Pure-TS hitTestPoints', async () => {
    expect(await initWasm(wasmBytes)).toBe(true);
    expect(isWasmReady()).toBe(true);

    const camera = new Camera({
      center: [25.033, 121.5654],
      zoom: 4,
      width: 1200,
      height: 800,
    });

    const count = 2500;
    const lats = new Float32Array(count);
    const lons = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      lats[i] = ((i * 37) % 140) - 70;
      lons[i] = ((i * 73) % 340) - 170;
    }
    const targetIdx = 1234;
    lats[targetIdx] = 25.033;
    lons[targetIdx] = 121.5654;

    const pt = camera.project(25.033, 121.5654);
    const points = { count, lats, lons };

    const fastIdx = hitTestPoints(pt.x + 2, pt.y - 2, points, camera, 18);
    const tsIdx = findNearestPoint(
      pt.x + 2,
      pt.y - 2,
      points,
      (lat, lon, out) => camera.projectInto(lat, lon, out),
      18
    );

    expect(fastIdx).toBe(targetIdx);
    expect(fastIdx).toBe(tsIdx);
    expect(hitTestPoints(-9999, -9999, points, camera, 18)).toBe(-1);
  });

  it('batchProjectPoints matches Camera.project within sub-pixel precision', async () => {
    expect(await initWasm(wasmBytes)).toBe(true);
    const camera = new Camera({
      center: [0, 0],
      zoom: 2,
      width: 1000,
      height: 600,
    });

    const count = 2200;
    const lats = new Float32Array(count);
    const lons = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      lats[i] = ((i * 19) % 120) - 60;
      lons[i] = ((i * 41) % 320) - 160;
    }

    const outXY = new Float32Array(count * 2);
    const outIdx = new Int32Array(count);
    const visible = batchProjectPoints(
      lats,
      lons,
      count,
      camera,
      20,
      outXY,
      outIdx
    );

    expect(visible).toBeGreaterThan(0);
    for (let k = 0; k < Math.min(visible, 50); k++) {
      const idx = outIdx[k];
      const expected = camera.project(lats[idx], lons[idx]);
      expect(Math.abs(outXY[k * 2] - expected.x)).toBeLessThan(1e-2);
      expect(Math.abs(outXY[k * 2 + 1] - expected.y)).toBeLessThan(1e-2);
    }
  });

  it('decimatePackedRings compacts dense rings accurately in WASM', async () => {
    expect(await initWasm(wasmBytes)).toBe(true);
    const totalVertices = 1200; // 2400 floats >= 2048 threshold
    const packedXY = new Float32Array(totalVertices * 2);
    for (let i = 0; i < totalVertices; i++) {
      packedXY[i * 2] = 0.5 + i * 0.0001;
      packedXY[i * 2 + 1] = 0.5 + (i % 5) * 0.0001;
    }
    const ringLengths = new Int32Array([totalVertices * 2]);
    const outXY = new Float32Array(totalVertices * 2);
    const outLens = new Int32Array(1);

    const outFloats = decimatePackedRings(
      packedXY,
      ringLengths,
      1,
      1024,
      0,
      0,
      2.0,
      outXY,
      outLens
    );

    expect(outFloats).toBe(outLens[0]);
    expect(outFloats).toBeGreaterThanOrEqual(4);
    expect(outFloats).toBeLessThan(totalVertices * 2);
  });

  it('cleanSeamRing splits antimeridian jumps and computes bbox in WASM', async () => {
    expect(await initWasm(wasmBytes)).toBe(true);
    const vertexCount = 140; // 280 floats >= 256 threshold
    const inLonLat = new Float32Array(vertexCount * 2);
    for (let i = 0; i < vertexCount; i++) {
      inLonLat[i * 2] = i < 70 ? 10 + i * 2 : -175 + (i - 70);
      inLonLat[i * 2 + 1] = -20 + (i % 40);
    }
    inLonLat[69 * 2] = 179;
    inLonLat[70 * 2] = -179; // Antimeridian jump (> 180 deg)

    const outLonLat = new Float32Array(vertexCount * 2);
    const outSegLens = new Int32Array(vertexCount);
    const outBbox = new Float32Array(4);

    const segCount = cleanSeamRing(
      inLonLat,
      vertexCount * 2,
      outLonLat,
      outSegLens,
      outBbox
    );

    expect(segCount).toBe(2);
    expect(outBbox[0]).toBe(-179);
    expect(outBbox[2]).toBe(179);
  });

  it('rejects out-of-bounds or odd-aligned inputs in decimatePackedRings and cleanSeamRing', async () => {
    expect(await initWasm(wasmBytes)).toBe(true);

    const packedXY = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const outXY = new Float32Array(4);
    const outLens = new Int32Array(2);

    // Sum of ringLengths exceeds packedXY.length
    expect(
      decimatePackedRings(
        packedXY,
        new Int32Array([4, 4]),
        2,
        1024,
        0,
        0,
        1,
        outXY,
        outLens
      )
    ).toBe(0);

    // Odd or negative ring length
    expect(
      decimatePackedRings(
        packedXY,
        new Int32Array([3]),
        1,
        1024,
        0,
        0,
        1,
        outXY,
        outLens
      )
    ).toBe(0);
    expect(
      decimatePackedRings(
        packedXY,
        new Int32Array([-2]),
        1,
        1024,
        0,
        0,
        1,
        outXY,
        outLens
      )
    ).toBe(0);

    // Odd floatLen in cleanSeamRing
    const oddIn = new Float32Array([10, 20, 30, 40, 50]);
    const outLonLat = new Float32Array(6);
    const outSegLens = new Int32Array(3);
    const outBbox = new Float32Array(4);
    expect(cleanSeamRing(oddIn, 5, outLonLat, outSegLens, outBbox)).toBe(0);
    expect(outBbox[0]).toBe(Infinity);
  });

  it('uploads static rings to WASM arena, invalidates on resetWasmArena, and supports disposeWasm/re-init', async () => {
    expect(await initWasm(wasmBytes)).toBe(true);
    resetWasmArena();

    const packedXY = new Float32Array([
      0.1, 0.1, 0.1001, 0.1001, 0.2, 0.2, 0.3, 0.3, 0.1, 0.1,
    ]);
    const ringLengths = new Int32Array([10]);
    const handle = uploadStaticRings(packedXY, ringLengths, 1);
    expect(handle).not.toBeNull();
    expect(getWasmMemoryStats().arenaUsedBytes).toBeGreaterThan(0);

    const staticOutXY = new Float32Array(10);
    const staticOutLens = new Int32Array(1);
    const directOutXY = new Float32Array(10);
    const directOutLens = new Int32Array(1);

    const staticCount = decimateStaticRings(
      handle!,
      1024,
      0,
      0,
      2.0,
      staticOutXY,
      staticOutLens
    );
    const directCount = decimatePackedRings(
      packedXY,
      ringLengths,
      1,
      1024,
      0,
      0,
      2.0,
      directOutXY,
      directOutLens
    );

    expect(staticCount).toBe(directCount);
    expect(staticOutLens[0]).toBe(directOutLens[0]);
    expect(staticOutXY.subarray(0, staticCount)).toEqual(
      directOutXY.subarray(0, directCount)
    );

    // Epoch invalidation on resetWasmArena
    resetWasmArena();
    expect(getWasmMemoryStats().arenaUsedBytes).toBe(0);
    expect(
      decimateStaticRings(handle!, 1024, 0, 0, 2.0, staticOutXY, staticOutLens)
    ).toBe(0);

    // Full WASM disposal and re-initialization
    disposeWasm();
    expect(isWasmReady()).toBe(false);
    expect(getWasmMemoryStats().ready).toBe(false);
    expect(await initWasm(wasmBytes)).toBe(true);
    expect(isWasmReady()).toBe(true);
  });

  it('attaches framework-free DOM interactions for Vue / Vanilla JS', () => {
    const el = document.createElement('div');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const camera = new Camera({ center: [0, 0], zoom: 3 });
    const dispose = attachInteractions(el, camera, {
      zoomDelta: 0.5,
      observeResize: true,
    });

    expect(camera.getState().width).toBe(800);
    el.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 400, clientY: 300, bubbles: true })
    );
    expect(camera.getState().zoom).toBeCloseTo(4, 3);

    dispose();
    el.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 400, clientY: 300, bubbles: true })
    );
    expect(camera.getState().zoom).toBeCloseTo(4, 3);
  });

  it('traces static rings directly from WASM linear memory matching drawStaticRings', async () => {
    expect(await initWasm(wasmBytes)).toBe(true);
    resetWasmArena();

    const packedXY = new Float32Array([
      0.1, 0.1, 0.1001, 0.1001, 0.2, 0.2, 0.3, 0.3, 0.1, 0.1,
    ]);
    const ringLengths = new Int32Array([10]);
    const handle = uploadStaticRings(packedXY, ringLengths, 1);
    expect(handle).not.toBeNull();

    const recordCalls = () => {
      const ops: Array<[string, ...number[]]> = [];
      const ctx = {
        moveTo: (x: number, y: number) => ops.push(['M', x, y]),
        lineTo: (x: number, y: number) => ops.push(['L', x, y]),
        closePath: () => ops.push(['Z']),
      } as unknown as CanvasRenderingContext2D;
      return { ctx, ops };
    };

    const a = recordCalls();
    const b = recordCalls();
    const scratchXY = new Float32Array(10);
    const scratchLens = new Int32Array(1);

    expect(
      drawStaticRings(
        a.ctx,
        handle!,
        1024,
        0,
        0,
        2.0,
        true,
        scratchXY,
        scratchLens
      )
    ).toBe(true);
    expect(drawStaticDirect(b.ctx, handle!, 1024, 0, 0, 2.0, true)).toBe(true);
    expect(b.ops).toEqual(a.ops);
  });

  it('supports equirectangular projection round-trips and 2:1 image bounds fitting', () => {
    const eq = createEquirectangular();
    for (const [lat, lon] of [
      [0, 0],
      [90, -180],
      [-90, 180],
      [25.03, 121.56],
    ] as Array<[number, number]>) {
      const n = eq.latLngToNorm(lat, lon);
      const back = eq.normToLatLng(n.x, n.y);
      expect(back[0]).toBeCloseTo(lat, 5);
      expect(back[1]).toBeCloseTo(lon, 5);
    }

    const camera = new Camera({
      projection: 'equirectangular',
      center: [0, 0],
      zoom: 0,
      width: 400,
      height: 200,
      maxBounds: [
        [-90, -180],
        [90, 180],
      ],
    });
    camera.fitBounds([
      [-90, -180],
      [90, 180],
    ]);

    const nw = camera.project(90, -180);
    const se = camera.project(-90, 180);
    const mid = camera.project(0, 0);
    expect(nw.x).toBeCloseTo(0, 2);
    expect(nw.y).toBeCloseTo(0, 2);
    expect(se.x).toBeCloseTo(400, 2);
    expect(se.y).toBeCloseTo(200, 2);
    expect(mid.x).toBeCloseTo(200, 2);
    expect(mid.y).toBeCloseTo(100, 2);
  });

  it('computes batch quadratic Bezier arcs in WASM matching computeArc', async () => {
    expect(await initWasm(wasmBytes)).toBe(true);
    const count = 12;
    const srcLats = new Float32Array(count).fill(25.033);
    const srcLons = new Float32Array(count).fill(121.5654);
    const dstLats = new Float32Array(count).fill(37.7749);
    const dstLons = new Float32Array(count).fill(-122.4194);
    const out = new Float32Array(count * QUADRATIC_ARC_POINTS * 2);

    const written = computeArcsBatch(
      srcLats,
      srcLons,
      dstLats,
      dstLons,
      count,
      out
    );
    expect(written).toBe(count * QUADRATIC_ARC_POINTS * 2);

    const expected = computeArc([25.033, 121.5654], [37.7749, -122.4194]);
    for (let i = 0; i < QUADRATIC_ARC_POINTS; i++) {
      expect(out[i * 2]).toBeCloseTo(expected[i][0], 2);
      expect(out[i * 2 + 1]).toBeCloseTo(expected[i][1], 2);
    }
  });

  it('sets touchAction none, caches rect on wheel, and supports keyboard navigation', () => {
    const el = document.createElement('div');
    el.style.touchAction = 'auto';
    const rectSpy = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 800,
      height: 600,
      right: 810,
      bottom: 620,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });

    const cam = new Camera({
      center: [0, 0],
      zoom: 3,
      width: 800,
      height: 600,
    });
    const cleanup = attachInteractions(el, cam, {
      observeResize: false,
      coalesceFrame: false,
    });

    expect(el.style.touchAction).toBe('none');
    expect(rectSpy).toHaveBeenCalledTimes(1);

    // Wheel should reuse cached rect without calling getBoundingClientRect again
    el.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 410,
        clientY: 320,
        cancelable: true,
      })
    );
    expect(rectSpy).toHaveBeenCalledTimes(1);
    expect(cam.getState().zoom).toBeGreaterThan(3);

    // Keyboard arrow pan & +/- zoom
    const beforeCenter = cam.getState().center;
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    expect(cam.getState().center[1]).toBeGreaterThan(beforeCenter[1]);

    const zoomBeforeKey = cam.getState().zoom;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    expect(cam.getState().zoom).toBeGreaterThan(zoomBeforeKey);

    cleanup();
    expect(el.style.touchAction).toBe('auto');
    rectSpy.mockRestore();
  });

  it('manages BlanketCanvasLayer lifecycle cleanly without React', () => {
    const cam = new Camera({
      center: [0, 0],
      zoom: 2,
      width: 400,
      height: 300,
    });
    const onDraw = vi.fn();
    const layer = new BlanketCanvasLayer({ onDraw, zIndex: 123 });
    const host = document.createElement('div');

    const detach = layer.mount(host, cam);
    const canvas = host.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.style.zIndex).toBe('123');

    detach();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('attaches and cleans up attachGamepad with zero idle rAF when no gamepad is connected', () => {
    const cam = new Camera({
      center: [0, 0],
      zoom: 2,
      width: 400,
      height: 300,
    });
    const origGetGamepads = navigator.getGamepads;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [],
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

    const cleanup = attachGamepad(cam);
    expect(rafSpy).not.toHaveBeenCalled();

    cleanup();
    rafSpy.mockRestore();
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: origGetGamepads,
    });
  });

  it('renders half-DOM Marker using CSS pseudo-element pulse classes and optional smooth mode', () => {
    const cam = new Camera({
      center: [0, 0],
      zoom: 2,
      width: 800,
      height: 600,
    });
    const { container } = render(
      React.createElement(
        MapView,
        { center: [0, 0], zoom: 2, unlockFps: true },
        React.createElement(Marker, {
          lat: cam.getState().center[0],
          lon: 0,
          variant: 'dot',
          pulse: 'ripple',
          smooth: true,
        })
      )
    );
    const pulseEl = container.querySelector('.ll-marker-pulse--ripple');
    expect(pulseEl).not.toBeNull();
    expect(pulseEl?.classList.contains('ll-marker-pulse--smooth')).toBe(true);
    expect(pulseEl?.children.length).toBe(0);
  });

  it('never renders 3 world copies at 1280x600 minimum zoom with [-180, 180] bounds', () => {
    const maxBounds: [LatLng, LatLng] = [
      [-85, -180],
      [85, 180],
    ];
    const cam = new Camera({
      center: [0, 0],
      zoom: 0,
      width: 1280,
      height: 600,
      maxBounds,
    });
    const state = cam.getState();
    const wrapped = getWrappedSlices(state, 2);
    expect(wrapped.scale).toBeCloseTo(1280, 6);
    expect(wrapped.slices.length).toBe(1);
  });

  it('supports optional u16 static rings and i16 point projection/hit-test APIs', async () => {
    const wasmBytes = readFileSync(
      resolve(import.meta.dirname, '../wasm/kernels.wasm')
    );
    await initWasm(wasmBytes);
    resetWasmArena();

    // 1. Uint16 quantized rings: 50% arena footprint and accurate tracing
    const packedF32 = new Float32Array([
      0.2, 0.3, 0.25, 0.3, 0.25, 0.35, 0.2, 0.35, 0.2, 0.3,
    ]);
    const packedU16 = encodeNormU16(packedF32);
    expect(packedU16.byteLength).toBe(packedF32.byteLength / 2);

    const ringLens = new Int32Array([10]);
    const handle = uploadStaticRingsU16(packedU16, ringLens, 1);
    expect(handle).not.toBeNull();

    const moves: Array<[number, number]> = [];
    const lines: Array<[number, number]> = [];
    let closed = false;
    const mockCtx = {
      moveTo: (x: number, y: number) => moves.push([x, y]),
      lineTo: (x: number, y: number) => lines.push([x, y]),
      closePath: () => {
        closed = true;
      },
    } as unknown as CanvasRenderingContext2D;

    const ok = drawStaticU16Direct(mockCtx, handle!, 1024, 0, 0, 1.0, true);
    expect(ok).toBe(true);
    expect(closed).toBe(true);
    expect(moves.length).toBe(1);
    expect(moves[0][0]).toBeCloseTo(0.2 * 1024, 0);
    expect(moves[0][1]).toBeCloseTo(0.3 * 1024, 0);
    expect(lines.length).toBeGreaterThan(0);

    // 2. Int16 points: projection & hit-testing + defensive edge cases
    const cam = new Camera({
      center: [25.033, 121.5654],
      zoom: 4,
      width: 800,
      height: 600,
    });
    const lats = [25.033, 0, NaN, 95];
    const lons = [121.5654, 0, Infinity, -185];
    const encoded = encodePointsToI16(lats, lons);
    expect(encoded.count).toBe(4);
    expect(encoded.latsI16[2]).toBe(0);
    expect(encoded.lonsI16[2]).toBe(0);
    expect(encoded.latsI16[3]).toBe(32767);
    expect(encoded.lonsI16[3]).toBe(-32767);

    const outXY = new Float32Array(8);
    const outIdx = new Int32Array(4);
    const visible = batchProjectPointsI16(
      encoded.latsI16,
      encoded.lonsI16,
      encoded.count,
      cam,
      32,
      outXY,
      outIdx
    );
    expect(visible).toBeGreaterThanOrEqual(1);
    expect(outIdx[0]).toBe(0);
    expect(outXY[0]).toBeCloseTo(400, 0);
    expect(outXY[1]).toBeCloseTo(300, 0);

    const hitIdx = hitTestPointsI16(
      400,
      300,
      encoded.latsI16,
      encoded.lonsI16,
      encoded.count,
      cam,
      16
    );
    expect(hitIdx).toBe(0);

    // Defensive bounds checks
    expect(
      batchProjectPointsI16(
        encoded.latsI16,
        encoded.lonsI16,
        0,
        cam,
        32,
        outXY,
        outIdx
      )
    ).toBe(0);
    expect(
      hitTestPointsI16(400, 300, encoded.latsI16, encoded.lonsI16, 10, cam, 16)
    ).toBe(-1);
    expect(uploadStaticRingsU16(new Uint16Array(0), ringLens, 1)).toBeNull();
  });
});

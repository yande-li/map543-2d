/// <reference types="node" />
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Viewport,
  MapView,
  Popup,
  Overlay,
  Marker,
  PointLayer,
  VectorLayer,
  TrajectoryLayer,
  ImageLayer,
  useMap,
  CanvasRenderer,
  attachInteractions,
  attachGamepad,
  hitTestPoints,
  encodePoints16,
  uploadStaticPoints,
  uploadStaticRings,
  encodeRings16,
  prepareArcs,
  drawTrajectories,
  createGlowDotSprite,
  packPoints,
  drawBatchPoints,
  attachPointHover,
  uploadVectorLayers,
  drawVectorLayers,
  drawImage,
  loadImage,
  initWasm,
  resetWasmArena,
  disposeWasm,
  getWasmMemoryStats,
  latToMercatorY,
  latLonToNorm,
  latLonToNormInto,
  normToLatLon,
  pxToLatLon,
  getMinZoom,
  computeZoomForBounds,
  clampCenterToBounds,
  createEquirectangular,
  getWrappedSlices,
  type LatLon,
} from 'map543-2d';
import {
  QUADRATIC_ARC_POINTS,
  computeArcsBatch,
  getArcTiming,
  latLonsToSvgPath,
  manhattanDeg,
  projectMercator,
  traceArc,
  xyToSvgPath,
} from '../core/curves';
import { normalizePulseMode, resolveMarkerGeometry } from '../core/marker';
import { attachSvgSync, scheduleAnimation } from '../core/trajectory';
import {
  getPixelStep,
  shouldCullFeature,
  shouldSkipLayer,
} from '../core/vectorLod';
import {
  getResponsiveZoom,
  getViewportBounds,
  resolveProjection,
} from '../core/projection';

describe('map543-2d projection', () => {
  it('round-trips normalized Mercator coordinates', () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [25.033, 121.5654],
      [-33.8688, 151.2093],
      [51.5074, -0.1278],
    ];

    for (const [lat, lon] of samples) {
      const norm = latLonToNorm(lat, lon);
      const [outLat, outLon] = normToLatLon(norm.x, norm.y);
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

describe('Viewport', () => {
  it('projects center to container midpoint and unprojects back', () => {
    const viewport = new Viewport({
      center: [25.033, 121.5654],
      zoom: 5,
      width: 1000,
      height: 600,
    });

    const centerPt = viewport.project(25.033, 121.5654);
    expect(centerPt.x).toBeCloseTo(500, 3);
    expect(centerPt.y).toBeCloseTo(300, 3);

    const [lat, lon] = viewport.unproject(500, 300);
    expect(lat).toBeCloseTo(25.033, 3);
    expect(lon).toBeCloseTo(121.5654, 3);
  });

  it('clamps zoom and center to constraints and notifies subscribers', () => {
    const viewport = new Viewport({
      center: [0, 0],
      zoom: 2,
      width: 800,
      height: 600,
      minZoom: 1,
      maxZoom: 8,
    });
    const listener = vi.fn();
    const unsubscribe = viewport.subscribe(listener);

    viewport.setConstraints({
      minZoom: 2,
      maxZoom: 6,
      maxBounds: [
        [-60, -120],
        [60, 120],
      ],
    });

    viewport.setView([80, 170], 10);
    const state = viewport.getState();
    expect(state.zoom).toBe(6);
    expect(state.center[0]).toBeLessThanOrEqual(60);
    expect(state.center[1]).toBeLessThanOrEqual(120);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it('pans and zooms around an anchor point', () => {
    const viewport = new Viewport({
      center: [0, 0],
      zoom: 3,
      width: 1000,
      height: 800,
      minZoom: 1,
      maxZoom: 10,
    });

    const anchorLatLon = viewport.unproject(250, 200);
    viewport.zoomAt(5, 250, 200);
    const afterPt = viewport.project(anchorLatLon[0], anchorLatLon[1]);
    expect(afterPt.x).toBeCloseTo(250, 1);
    expect(afterPt.y).toBeCloseTo(200, 1);

    const beforeCenter = viewport.getState().center;
    viewport.panBy(100, -50);
    const afterCenter = viewport.getState().center;
    expect(afterCenter[1]).toBeLessThan(beforeCenter[1]);
    expect(afterCenter[0]).toBeLessThan(beforeCenter[0]);
  });

  it('animates flyTo to target view', () => {
    vi.useFakeTimers();
    const viewport = new Viewport({
      center: [0, 0],
      zoom: 2,
      width: 800,
      height: 600,
    });

    viewport.flyTo([35.6762, 139.6503], 5, 100);
    vi.advanceTimersByTime(150);

    let state = viewport.getState();
    expect(state.center[0]).toBeCloseTo(35.6762, 2);
    expect(state.center[1]).toBeCloseTo(139.6503, 2);
    expect(state.zoom).toBeCloseTo(5, 2);

    // Omitting zoom preserves current zoom
    viewport.flyTo([25, 121], undefined, 50);
    vi.advanceTimersByTime(100);
    state = viewport.getState();
    expect(state.center[0]).toBeCloseTo(25, 1);
    expect(state.zoom).toBeCloseTo(5, 2);
    vi.useRealTimers();
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

    const tip = container.querySelector('.map-popup-tip');
    expect(tip).not.toBeNull();
    expect(container.textContent).toContain('Taipei');

    const mapEl = container.querySelector('.map-container')!;
    onMove.mockClear();
    fireEvent.doubleClick(mapEl, { clientX: 100, clientY: 100 });
    expect(onMove).toHaveBeenCalled();
  });
});

describe('WebAssembly batch kernels', () => {
  it('initializes WASM and matches Pure-TS hitTestPoints', async () => {
    expect(initWasm()).toBe(true);
    expect(getWasmMemoryStats().ready).toBe(true);

    const viewport = new Viewport({
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

    const pt = viewport.project(25.033, 121.5654);
    const points = { count, lats, lons };

    const fastIdx = hitTestPoints(pt.x + 2, pt.y - 2, points, viewport, 18);

    expect(fastIdx).toBe(targetIdx);
    expect(hitTestPoints(-9999, -9999, points, viewport, 18)).toBe(-1);
  });

  it('uploads static rings to WASM arena, invalidates on resetWasmArena, and supports disposeWasm/re-init', async () => {
    expect(initWasm()).toBe(true);
    resetWasmArena();

    const packedXY = new Float32Array([
      0.1, 0.1, 0.1001, 0.1001, 0.2, 0.2, 0.3, 0.3, 0.1, 0.1,
    ]);
    const ringLengths = new Int32Array([10]);
    const handle = uploadStaticRings(packedXY, ringLengths, 1);
    expect(handle).not.toBeNull();
    expect(getWasmMemoryStats().arenaUsedBytes).toBeGreaterThan(0);

    // Epoch invalidation on resetWasmArena
    resetWasmArena();
    expect(getWasmMemoryStats().arenaUsedBytes).toBe(0);

    // Full WASM disposal and re-initialization
    disposeWasm();
    expect(getWasmMemoryStats().ready).toBe(false);
    expect(initWasm()).toBe(true);
    expect(getWasmMemoryStats().ready).toBe(true);
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

    const viewport = new Viewport({ center: [0, 0], zoom: 3 });
    const dispose = attachInteractions(el, viewport, {
      zoomDelta: 0.5,
      observeResize: true,
    });

    expect(viewport.getState().width).toBe(800);
    el.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 400, clientY: 300, bubbles: true })
    );
    expect(viewport.getState().zoom).toBeCloseTo(4, 3);

    dispose();
    el.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 400, clientY: 300, bubbles: true })
    );
    expect(viewport.getState().zoom).toBeCloseTo(4, 3);
  });

  it('supports equirectangular projection round-trips and 2:1 image bounds fitting', () => {
    const eq = createEquirectangular();
    for (const [lat, lon] of [
      [0, 0],
      [90, -180],
      [-90, 180],
      [25.03, 121.56],
    ] as Array<[number, number]>) {
      const n = eq.latLonToNorm(lat, lon);
      const back = eq.normToLatLon(n.x, n.y);
      expect(back[0]).toBeCloseTo(lat, 5);
      expect(back[1]).toBeCloseTo(lon, 5);
    }

    const viewport = new Viewport({
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
    viewport.fitBounds([
      [-90, -180],
      [90, 180],
    ]);

    const nw = viewport.project(90, -180);
    const se = viewport.project(-90, 180);
    const mid = viewport.project(0, 0);
    expect(nw.x).toBeCloseTo(0, 2);
    expect(nw.y).toBeCloseTo(0, 2);
    expect(se.x).toBeCloseTo(400, 2);
    expect(se.y).toBeCloseTo(200, 2);
    expect(mid.x).toBeCloseTo(200, 2);
    expect(mid.y).toBeCloseTo(100, 2);
  });

  it('computes batch quadratic Bezier arcs in WASM', async () => {
    expect(initWasm()).toBe(true);
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
    expect(out[0]).toBeCloseTo(25.033, 2);
    expect(out[1]).toBeCloseTo(121.5654, 2);
    const lastIdx = (QUADRATIC_ARC_POINTS - 1) * 2;
    expect(out[lastIdx]).toBeCloseTo(37.7749, 2);
    expect(out[lastIdx + 1]).toBeCloseTo(-122.4194, 2);
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

    const cam = new Viewport({
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

  it('manages CanvasRenderer lifecycle cleanly without React', () => {
    const cam = new Viewport({
      center: [0, 0],
      zoom: 2,
      width: 400,
      height: 300,
    });
    const onDraw = vi.fn();
    const layer = new CanvasRenderer({ onDraw, zIndex: 123 });
    const host = document.createElement('div');

    const detach = layer.mount(host, cam);
    const canvas = host.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.style.zIndex).toBe('123');

    detach();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('attaches and cleans up attachGamepad with zero idle rAF when no gamepad is connected', () => {
    const cam = new Viewport({
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
    const cam = new Viewport({
      center: [0, 0],
      zoom: 2,
      width: 800,
      height: 600,
    });
    const { container } = render(
      React.createElement(
        MapView,
        { center: [0, 0], zoom: 2, smooth: true },
        React.createElement(Marker, {
          lat: cam.getState().center[0],
          lon: 0,
          variant: 'dot',
          pulse: 'ripple',
          smooth: true,
        })
      )
    );
    const pulseEl = container.querySelector('.map-marker-pulse--ripple');
    expect(pulseEl).not.toBeNull();
    expect(pulseEl?.classList.contains('map-marker-pulse--smooth')).toBe(true);
    expect(pulseEl?.children.length).toBe(0);
  });

  it('never renders 3 world copies at 1280x600 minimum zoom with [-180, 180] bounds', () => {
    const maxBounds: [LatLon, LatLon] = [
      [-85, -180],
      [85, 180],
    ];
    const cam = new Viewport({
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

  it('supports unified 16-bit static rings and 16-bit point projection/hit-test APIs', () => {
    expect(initWasm()).toBe(true);
    resetWasmArena();

    // 1. 16-bit quantized rings via unified uploadStaticRings
    const packedF32 = new Float32Array([
      0.2, 0.3, 0.25, 0.3, 0.25, 0.35, 0.2, 0.35, 0.2, 0.3,
    ]);
    const packed16 = encodeRings16(packedF32);
    expect(packed16.byteLength).toBe(packedF32.byteLength / 2);

    const ringLens = new Int32Array([10]);
    const handle = uploadStaticRings(packed16, ringLens, 1);
    expect(handle).not.toBeNull();
    expect(handle?.precision).toBe(16);

    // 2. 16-bit points via unified encodePoints16 and hitTestPoints
    const cam = new Viewport({
      center: [25.033, 121.5654],
      zoom: 4,
      width: 800,
      height: 600,
    });
    const lats = [25.033, 0, NaN, 95];
    const lons = [121.5654, 0, Infinity, -185];
    const encoded = encodePoints16(lats, lons);
    expect(encoded.count).toBe(4);
    expect(encoded.lats[2]).toBe(0);
    expect(encoded.lons[2]).toBe(0);
    expect(encoded.lats[3]).toBe(32767);
    expect(encoded.lons[3]).toBe(-32767);

    const hitIdx = hitTestPoints(400, 300, encoded, cam, 16);
    expect(hitIdx).toBe(0);

    // Defensive bounds checks
    expect(
      hitTestPoints(
        400,
        300,
        { count: 10, lats: encoded.lats, lons: encoded.lons },
        cam,
        16
      )
    ).toBe(-1);
    expect(uploadStaticRings(new Uint16Array(0), ringLens, 1)).toBeNull();
  });

  it('supports Static Point Arena zero-copy projection, hit-test, TrajectoryItem src/dst, and style-optional VectorLayer', () => {
    expect(initWasm()).toBe(true);
    resetWasmArena();

    const cam = new Viewport({
      center: [25, 121],
      zoom: 4,
      width: 800,
      height: 600,
    });
    const lats = new Float32Array([25, 26]);
    const lons = new Float32Array([121, 122]);
    const handle = uploadStaticPoints(lats, lons, 2);
    expect(handle).not.toBeNull();

    expect(hitTestPoints(400, 300, handle!, cam, 16)).toBe(0);

    // TrajectoryItem tuple coordinates
    const prepared = prepareArcs([
      { key: 't1', src: [25, 121], dst: [35, 139] },
    ]);
    expect(prepared.items.length).toBe(1);
    expect(prepared.items[0].src).toEqual([25, 121]);
    expect(prepared.items[0].dst).toEqual([35, 139]);

    // VectorLayer with PreparedLayer (no inline style) + styles map + 16-bit precision
    const rawLayers = [
      {
        name: 'land',
        features: [
          {
            packedXY: new Float32Array([0.5, 0.5, 0.51, 0.5, 0.5, 0.51]),
            ringLengths: new Int32Array([6]),
            ringCount: 1,
            isPolygon: true,
            minLon: -180,
            minLat: -85,
            maxLon: 180,
            maxLat: 85,
          },
        ],
      },
    ];
    const handles = uploadVectorLayers(rawLayers, [], { precision: 16 });
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    drawVectorLayers(mockCtx, cam.getState(), rawLayers, [], handles, {
      styles: { land: { fillColor: '#123456' } },
    });
  });
});

describe('Extended projection, Viewport, curves, and trajectories', () => {
  it('converts world/px coordinates, computes responsive zoom, bounds, and resolves projections', () => {
    const out = { x: 0, y: 0 };
    latLonToNormInto(25.033, 121.5654, out);
    const norm = latLonToNorm(25.033, 121.5654);
    expect(out.x).toBeCloseTo(norm.x, 6);
    expect(out.y).toBeCloseTo(norm.y, 6);

    const state = {
      center: [25.033, 121.5654] as LatLon,
      zoom: 4,
      width: 800,
      height: 600,
    };
    const [pLat, pLon] = pxToLatLon(400, 300, state);
    expect(pLat).toBeCloseTo(25.033, 3);
    expect(pLon).toBeCloseTo(121.5654, 3);

    const bounds = getViewportBounds(state);
    expect(bounds.north).toBeGreaterThan(25.033);
    expect(bounds.south).toBeLessThan(25.033);
    expect(bounds.east).toBeGreaterThan(121.5654);
    expect(bounds.west).toBeLessThan(121.5654);

    expect(getResponsiveZoom(4, 960, 1920)).toBeCloseTo(3, 5);
    expect(getMinZoom(800, 600)).toBeGreaterThan(0);

    const fitted = computeZoomForBounds(
      [
        [20, 118],
        [26, 123],
      ],
      800,
      600,
      20
    );
    expect(fitted.center[0]).toBeCloseTo(23, 0);
    expect(fitted.zoom).toBeGreaterThan(4);

    const clamped = clampCenterToBounds([89, 0], 3, 800, 600, [
      [-60, -120],
      [60, 120],
    ]);
    expect(clamped[0]).toBeLessThanOrEqual(60);

    expect(resolveProjection('mercator').id).toBe('mercator');
    expect(resolveProjection('equirectangular').id).toBe('equirectangular');
  });

  it('preserves viewport span and scales referenceWidth on Viewport.setSize', () => {
    const cam = new Viewport({
      center: [0, 0],
      zoom: 4,
      width: 0,
      height: 0,
      referenceWidth: 1920,
      preserveViewportSpan: true,
    });
    // First resize from 0 -> 960 scales by log2(960 / 1920) = -1
    cam.setSize(960, 600);
    expect(cam.getState().zoom).toBeCloseTo(3, 4);

    // Subsequent resize from 960 -> 1920 preserves horizontal span (+1 zoom)
    cam.setSize(1920, 600);
    expect(cam.getState().zoom).toBeCloseTo(4, 4);
    expect(cam.getBounds().north).toBeGreaterThan(0);
  });

  it('formats polyline and smooth quadratic SVG paths, projects Mercator batch, and traces canvas arcs', () => {
    expect(manhattanDeg([10, 20], [15, 12])).toBe(13);
    const timing = getArcTiming(30);
    expect(timing.dashRatio).toBeGreaterThan(0);
    expect(timing.duration).toBeGreaterThanOrEqual(800);

    const cam = new Viewport({
      center: [25, 121],
      zoom: 4,
      width: 800,
      height: 600,
    });
    const inLatLon = new Float32Array([25, 121, 26, 122, 27, 123]);
    const outXY = new Float32Array(6);
    expect(projectMercator(inLatLon, 3, cam, outXY)).toBe(3);
    expect(outXY[0]).toBeCloseTo(400, 1);
    expect(outXY[1]).toBeCloseTo(300, 1);

    const polyPath = xyToSvgPath(outXY, 0, 3, false);
    expect(polyPath.startsWith('M')).toBe(true);
    expect(polyPath.includes('L')).toBe(true);
    expect(polyPath.includes('Q')).toBe(false);

    const smoothPath = xyToSvgPath(outXY, 0, 3, true);
    expect(smoothPath.includes('Q')).toBe(true);

    const directPath = latLonsToSvgPath(
      [
        [25, 121],
        [26, 122],
      ],
      (lat, lon, o) => cam.projectInto(lat, lon, o)
    );
    expect(directPath).toBe(xyToSvgPath(outXY, 0, 2, false));

    const canvasOps: string[] = [];
    const ctx = {
      lineTo: () => canvasOps.push('L'),
      quadraticCurveTo: () => canvasOps.push('Q'),
    } as unknown as CanvasRenderingContext2D;
    traceArc(ctx, 0, 0, 10, 10, 100);
    traceArc(ctx, 0, 0, 200, 200, 100);
    expect(canvasOps).toEqual(['L', 'Q']);
  });

  it('synchronizes SVG trajectories on pan/zoom and batches drawTrajectories overloads', () => {
    const cam = new Viewport({
      center: [25, 121],
      zoom: 4,
      width: 800,
      height: 600,
    });
    const batch = prepareArcs([
      { key: 'arc1', src: [25, 121], dst: [35, 139] },
      {
        key: 'line1',
        src: [25, 121],
        dst: [26, 122],
        curve: 'straight',
        isReversed: true,
      },
      { key: 'skip1', src: [0, 0], dst: [1, 1], curve: 'none' },
    ]);
    expect(batch.items).toHaveLength(2);
    expect(batch.arcCount).toBe(1);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const pathMap = new Map<string, SVGPathElement>();
    const baseMap = new Map<string, SVGPathElement>();
    for (const item of batch.items) {
      pathMap.set(
        item.key,
        document.createElementNS('http://www.w3.org/2000/svg', 'path')
      );
      baseMap.set(
        item.key,
        document.createElementNS('http://www.w3.org/2000/svg', 'path')
      );
    }

    const detach = attachSvgSync(
      svg,
      cam,
      batch,
      (k) => pathMap.get(k),
      (k) => baseMap.get(k),
      true
    );
    expect(pathMap.get('arc1')?.getAttribute('d')).toContain('Q');
    expect(pathMap.get('line1')?.getAttribute('d')).toContain('L');

    // Pan translates SVG container without rebuilding path strings
    cam.panBy(40, -20);
    expect(svg.style.transform).toContain('translate3d(');

    // Zoom rebuilds paths and resets transform
    cam.zoomAt(5, 400, 300);
    expect(svg.style.transform).toBe('');
    detach();

    // scheduleAnimation queues and cancels cleanly
    const fn = vi.fn();
    const cancel = scheduleAnimation(fn);
    cancel();

    // drawTrajectories multi-to-one and multi-to-multi
    let strokeCalls = 0;
    let rectCalls = 0;
    const mockCtx = {
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      stroke: () => {
        strokeCalls++;
      },
      rect: () => {
        rectCalls++;
      },
      fill: () => {},
      drawImage: () => {},
    } as unknown as CanvasRenderingContext2D;

    const srcXY = new Float32Array([100, 100, 300, 250, -500, -500]);
    drawTrajectories(mockCtx, srcXY, 3, 400, 300, 800, 600, '#0ebf9c');
    expect(strokeCalls).toBe(2);
    expect(rectCalls).toBe(2); // 3rd source point is offscreen

    const dstXY = new Float32Array([400, 300, 500, 400, -600, -600]);
    drawTrajectories(mockCtx, srcXY, 3, dstXY, 800, 600, '#ff0000');
    expect(strokeCalls).toBe(4);
    const sprite = createGlowDotSprite('#0ebf9c', 8);
    expect(sprite).not.toBeNull(); // @napi-rs/canvas provides a 2D context in jsdom
    expect(sprite?.width).toBe(8);
    expect(sprite?.height).toBe(8);
  });
});

describe('PointLayer, VectorLayer, VectorLod, and ImageLayer core helpers', () => {
  it('packs f32 and 16bit points with style buckets, draws batches, and handles hover cursor', () => {
    const cam = new Viewport({
      center: [25, 121],
      zoom: 4,
      width: 800,
      height: 600,
    });
    const pts = [
      { lat: 25, lon: 121, radius: 5, color: '#ff0000', alpha: 0.8 },
      { lat: 25.1, lon: 121.1, radius: 4, color: '#ff0000', alpha: 0.8 },
      { lat: 26, lon: 122, radius: 6, color: '#00ff00', alpha: 0.5 },
    ];

    const buf32 = packPoints(pts, 32);
    expect(buf32.origIndices?.[0]).toBe(2);
    expect(buf32.staticHandle).not.toBeNull();
    expect(buf32.precision).toBe(32);

    const buf16 = packPoints(pts, 16);
    expect(buf16.lats).toBeInstanceOf(Int16Array);
    expect(buf16.staticHandle?.precision).toBe(16);

    let arcCount = 0;
    let fillCount = 0;
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      arc: () => {
        arcCount++;
      },
      fill: () => {
        fillCount++;
      },
    } as unknown as CanvasRenderingContext2D;

    drawBatchPoints(mockCtx, cam, pts, buf32);
    expect(arcCount).toBe(3);
    expect(fillCount).toBe(3); // each symbol drawn individually for clean alpha overlap

    // Auto re-uploads static handle after disposeWasm
    disposeWasm();
    drawBatchPoints(mockCtx, cam, pts, buf16);
    expect(arcCount).toBe(6);

    // attachPointHover updates cursor on pointermove / pointerleave
    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof window.requestAnimationFrame;

    const detachHover = attachPointHover(container, cam, buf32, 20);
    container.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: 400,
        clientY: 300,
        buttons: 0,
        bubbles: true,
      })
    );
    expect(container.style.cursor).toBe('pointer');

    container.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(container.style.cursor).toBe('');
    detachHover();
    window.requestAnimationFrame = origRaf;
  });

  it('evaluates VectorLod rules, caches dashArray in drawVectorLayers, and draws georeferenced images', async () => {
    expect(getPixelStep(false, 0.75, 6)).toBe(0.75);
    expect(getPixelStep(true, 0.75, 6)).toBe(6);
    expect(shouldSkipLayer('grid', true, new Set(['grid']))).toBe(true);
    expect(shouldSkipLayer('grid', false, new Set(['grid']))).toBe(false);
    expect(shouldCullFeature(0, 0.1, 0, 0.1, 10, true, 6)).toBe(true);
    expect(shouldCullFeature(0, 2, 0, 2, 10, true, 6)).toBe(false);

    expect(normalizePulseMode(true)).toBe('radar');
    expect(normalizePulseMode(false)).toBeNull();
    expect(normalizePulseMode('ripple')).toBe('ripple');
    expect(resolveMarkerGeometry('pin', 24).anchor).toEqual([0.5, 1]);
    expect(resolveMarkerGeometry('dot', 10).anchor).toEqual([0.5, 0.5]);

    const cam = new Viewport({
      center: [0, 0],
      zoom: 3,
      width: 800,
      height: 600,
    });
    const strokeLayer = {
      name: 'borders',
      style: { color: '#fff', weight: 1.5, dashArray: '4, 2' },
      features: [
        {
          packedXY: new Float32Array([0.4, 0.4, 0.6, 0.6]),
          ringLengths: new Int32Array([4]),
          ringCount: 1,
          isPolygon: false,
          minLon: -40,
          minLat: -40,
          maxLon: 40,
          maxLat: 40,
        },
      ],
    };
    const dashesApplied: number[][] = [];
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      setLineDash: (d: number[]) => dashesApplied.push(d),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const handles = uploadVectorLayers([], [strokeLayer], { reset: true });
    drawVectorLayers(mockCtx, cam.getState(), [], [strokeLayer], handles);
    drawVectorLayers(mockCtx, cam.getState(), [], [strokeLayer], handles);
    expect(dashesApplied).toEqual([
      [4, 2],
      [4, 2],
    ]);

    // No JS fallback when handle is missing from WeakMap (no-op)
    drawVectorLayers(mockCtx, cam.getState(), [], [strokeLayer], new WeakMap());

    // drawImage projects bounds and calls ctx.drawImage
    const fakeImg = {} as CanvasImageSource;
    drawImage(
      mockCtx,
      fakeImg,
      [
        [-20, -20],
        [20, 20],
      ],
      cam,
      { opacity: 0.5, imageSmoothingEnabled: false }
    );
    expect(mockCtx.drawImage).toHaveBeenCalledTimes(1);

    // loadImage resolves on onload and rejects on onerror
    const OrigImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = 'async';
      set src(v: string) {
        queueMicrotask(() => {
          if (v === 'bad') this.onerror?.();
          else this.onload?.();
        });
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;
    await expect(loadImage('ok.png')).resolves.toBeInstanceOf(MockImage);
    await expect(loadImage('bad')).rejects.toThrow('Failed to load geo image');
    globalThis.Image = OrigImage;
  });
});

describe('DOM interactions (drag, click, pinch, gamepad) and React layers', () => {
  it('distinguishes click vs drag pan, handles two-finger pinch, ignores input keydown, and polls connected gamepad', () => {
    const el = document.createElement('div');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const onClick = vi.fn();
    const cam = new Viewport({
      center: [0, 0],
      zoom: 3,
      width: 800,
      height: 600,
    });
    const dispose = attachInteractions(el, cam, {
      coalesceFrame: false,
      onClick,
    });

    // 1. Click within 5px slop triggers onClick with { latLon, x, y }
    el.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 400,
        clientY: 300,
        button: 0,
        bubbles: true,
      })
    );
    el.dispatchEvent(
      new MouseEvent('pointerup', {
        clientX: 401,
        clientY: 301,
        button: 0,
        bubbles: true,
      })
    );
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        x: 401,
        y: 301,
        latLon: expect.any(Array),
      })
    );

    // 2. Drag > 5px pans viewport and does NOT trigger onClick
    onClick.mockClear();
    const dragDown = new MouseEvent('pointerdown', {
      clientX: 400,
      clientY: 300,
      button: 0,
      bubbles: true,
    });
    Object.defineProperty(dragDown, 'pointerId', { value: 1 });
    el.dispatchEvent(dragDown);

    const dragMove = new MouseEvent('pointermove', {
      clientX: 450,
      clientY: 320,
      bubbles: true,
    });
    Object.defineProperty(dragMove, 'pointerId', { value: 1 });
    el.dispatchEvent(dragMove);

    const dragUp = new MouseEvent('pointerup', {
      clientX: 450,
      clientY: 320,
      bubbles: true,
    });
    Object.defineProperty(dragUp, 'pointerId', { value: 1 });
    el.dispatchEvent(dragUp);
    expect(onClick).not.toHaveBeenCalled();
    expect(cam.getState().center[1]).toBeLessThan(0);

    // 3. Two-finger pinch zoom
    const zBeforePinch = cam.getState().zoom;
    const p1Down = new MouseEvent('pointerdown', {
      clientX: 350,
      clientY: 300,
      button: 0,
      bubbles: true,
    });
    Object.defineProperty(p1Down, 'pointerId', { value: 10 });
    const p2Down = new MouseEvent('pointerdown', {
      clientX: 450,
      clientY: 300,
      button: 0,
      bubbles: true,
    });
    Object.defineProperty(p2Down, 'pointerId', { value: 11 });
    el.dispatchEvent(p1Down);
    el.dispatchEvent(p2Down);

    const p2Move = new MouseEvent('pointermove', {
      clientX: 550,
      clientY: 300,
      bubbles: true,
    });
    Object.defineProperty(p2Move, 'pointerId', { value: 11 });
    el.dispatchEvent(p2Move);
    expect(cam.getState().zoom).toBeGreaterThan(zBeforePinch);

    // 4. Keydown inside <input> is ignored
    const input = document.createElement('input');
    el.appendChild(input);
    const lonBeforeInput = cam.getState().center[1];
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
    expect(cam.getState().center[1]).toBe(lonBeforeInput);
    dispose();

    // 5. Connected Gamepad polling
    const origGetGamepads = navigator.getGamepads;
    let rafCallback: FrameRequestCallback | null = null;
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCallback = cb;
        return 42;
      });
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        {
          connected: true,
          axes: [0.8, 0, 0, -0.5],
          buttons: Array.from({ length: 16 }, (_, i) => ({
            pressed: i === 5 || i === 12,
            value: i === 7 ? 0.8 : 0,
          })),
        },
      ],
    });
    const stopGamepad = attachGamepad(cam);
    expect(rafCallback).not.toBeNull();
    const zoomBeforePad = cam.getState().zoom;
    rafCallback!(1000);
    expect(cam.getState().zoom).not.toBe(zoomBeforePad);
    stopGamepad();
    rafSpy.mockRestore();
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: origGetGamepads,
    });
  });

  it('mounts React MapView controls, Overlay culling, Popup Escape/flip, PointLayer, VectorLayer, TrajectoryLayer, ImageLayer, and guards useMap()', () => {
    // useMap() outside <MapView> throws
    const BadChild: React.FC = () => {
      useMap();
      return null;
    };
    expect(() => render(React.createElement(BadChild))).toThrow(
      'useMap must be used within a <MapView>'
    );

    const onMapClick = vi.fn();
    const onClose = vi.fn();
    const onPointClick = vi.fn();

    const { container, rerender, unmount } = render(
      React.createElement(
        MapView,
        {
          center: [25, 121],
          zoom: 4,
          zoomControls: true,
          syncViewOnPropsChange: true,
          onClick: onMapClick,
        },
        React.createElement(Overlay, {
          position: [-80, -170],
          fixedSize: [40, 40],
          cullOffscreen: true,
          children: React.createElement(
            'div',
            { className: 'culled-child' },
            'Off'
          ),
        }),
        React.createElement(
          Popup,
          { position: [25, 121], onClose },
          React.createElement('span', null, 'Info')
        ),
        React.createElement(Marker, {
          position: [25, 121],
          variant: 'ring',
        }),
        React.createElement(PointLayer, {
          points: [{ lat: 25, lon: 121, radius: 6, color: '#0ebf9c' }] as const,
          precision: 16,
          className: 'pt-layer',
          onPointClick,
        }),
        React.createElement(VectorLayer, {
          fillLayers: [] as const,
          precision: 16,
          className: 'vec-layer',
        }),
        React.createElement(TrajectoryLayer, {
          items: [{ key: 'arc-1', src: [25, 121], dst: [35, 139] }] as const,
          lowPower: true,
        }),
        React.createElement(ImageLayer, {
          image: {} as CanvasImageSource,
          bounds: [
            [20, 118],
            [28, 124],
          ],
        })
      )
    );

    // Zoom control buttons
    const zoomInBtn = container.querySelector(
      '.map-zoom-in'
    ) as HTMLButtonElement;
    const zoomOutBtn = container.querySelector(
      '.map-zoom-out'
    ) as HTMLButtonElement;
    expect(zoomInBtn).not.toBeNull();
    expect(zoomOutBtn).not.toBeNull();
    fireEvent.click(zoomInBtn);
    fireEvent.click(zoomOutBtn);

    // Map click triggers onClick({ latLon, x, y }) and PointLayer hit-test
    const mapEl = container.querySelector('.map-container')!;
    expect(container.querySelector('.pt-layer')).not.toBeNull();
    expect(container.querySelector('.vec-layer')).not.toBeNull();
    fireEvent.pointerDown(mapEl, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerUp(mapEl, { clientX: 0, clientY: 0, button: 0 });
    expect(onMapClick).toHaveBeenCalledTimes(1);
    expect(onMapClick.mock.calls[0][0].latLon).toHaveLength(2);
    expect(onPointClick).toHaveBeenCalledTimes(1);

    // Escape key closes Popup
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Controlled center/zoom syncViewOnPropsChange rerender
    rerender(
      React.createElement(MapView, {
        center: [35, 139],
        zoom: 5,
        syncViewOnPropsChange: true,
      })
    );
    unmount();
  });
});

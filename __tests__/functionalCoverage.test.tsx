import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  CanvasLayer,
  MapView,
  Marker,
  type MapViewHandle,
  useViewportSelector,
} from '../index';
import {
  Viewport,
  createMap,
  drawBatchPoints,
  drawBatchTrajectories,
  drawHeatmap,
  hitTestPointBuffers,
  hitTestPoints,
  packHeatmapPoints,
  packPoints,
  packTrajectories,
  resetWasmArena,
  resolveAnimationEasing,
  resolveFrameIntervalMs,
  shouldAdvanceFrame,
} from '../core';
import { createCruiseController } from '../cruise';
import { projectPointsToScratch } from '../core/batch';
import { observeElementRect } from '../core/controls';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function createNoopCtx(): CanvasRenderingContext2D {
  return {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    closePath: () => {},
    arc: () => {},
    rect: () => {},
    fill: () => {},
    stroke: () => {},
    drawImage: () => {},
    setLineDash: () => {},
    clearRect: () => {},
    setTransform: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
}

describe('Viewport.zoomBy, setConstraints, and polar clamping', () => {
  it('zooms around viewport center with zoomBy and respects zoom limits', () => {
    const vp = new Viewport({
      center: [25, 121],
      zoom: 4,
      minZoom: 2,
      maxZoom: 6,
      width: 800,
      height: 600,
    });
    vp.zoomBy(1.5);
    expect(vp.getState().zoom).toBeCloseTo(5.5, 4);
    expect(vp.getState().center[0]).toBeCloseTo(25, 2);
    expect(vp.getState().center[1]).toBeCloseTo(121, 2);

    vp.zoomBy(10);
    expect(vp.getState().zoom).toBeCloseTo(6, 4);

    vp.zoomBy(-10);
    expect(vp.getState().zoom).toBeGreaterThanOrEqual(2);
  });

  it('clears optional constraints and switches projections in setConstraints', () => {
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 800,
      height: 600,
      maxBounds: [
        [20, 118],
        [26, 123],
      ],
      referenceWidth: 1920,
      projection: 'mercator',
    });
    vp.setConstraints({
      maxBounds: undefined,
      referenceWidth: undefined,
      projection: 'equirectangular',
    });
    expect(vp.getState().maxBounds).toBeUndefined();
    expect(vp.getState().referenceWidth).toBeUndefined();
    expect(vp.getProjection().id).toBe('equirectangular');

    // Equirectangular allows polar latitude up to 90 deg
    vp.setView([90, 0], 4);
    expect(vp.getState().center[0]).toBeCloseTo(90, 4);

    // Mercator clamps polar latitude to MAX_MERCATOR_LAT (~85.051129)
    vp.setConstraints({ projection: 'mercator' });
    vp.setView([90, 0], 4);
    expect(vp.getState().center[0]).toBeCloseTo(85.051129, 4);
  });
});

describe('WASM F32 vs I16 parity, subarray offset, and arena recovery', () => {
  it('produces matching projection and hit-test results for f32 and i16 including subarrays', () => {
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 800,
      height: 600,
    });
    const pts = [
      { lat: 24.1, lon: 120.7, radius: 5, color: '#0ea5e9' },
      { lat: 25.033, lon: 121.565, radius: 5, color: '#ef4444' },
      { lat: 22.6, lon: 120.3, radius: 5, color: '#22c55e' },
    ];
    const b32 = packPoints(pts, 32);
    const b16 = packPoints(pts, 16);

    const p32 = projectPointsToScratch(b32, vp, 30);
    const xy32 = p32
      ? Array.from(
          p32.rt.f32.subarray(
            p32.outXYFloatBase,
            p32.outXYFloatBase + p32.visible * 2
          )
        )
      : [];
    const p16 = projectPointsToScratch(b16, vp, 30);
    const xy16 = p16
      ? Array.from(
          p16.rt.f32.subarray(
            p16.outXYFloatBase,
            p16.outXYFloatBase + p16.visible * 2
          )
        )
      : [];

    expect(xy32).toHaveLength(6);
    expect(xy16).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      expect(Math.abs(xy32[i] - xy16[i])).toBeLessThan(0.5);
    }

    // Subarray with non-zero byteOffset
    const subLats = (b32.lats as Float32Array).subarray(1, 3);
    const subLons = (b32.lons as Float32Array).subarray(1, 3);
    const targetPt = vp.project(pts[1].lat, pts[1].lon);
    const hitIdx = hitTestPoints(
      targetPt.x,
      targetPt.y,
      { count: 2, lats: subLats, lons: subLons },
      vp,
      10
    );
    expect(hitIdx).toBe(0);
  });

  it('recovers automatically across layers after resetWasmArena()', () => {
    const ctx = createNoopCtx();
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 600,
      height: 400,
    });
    const pts = [{ lat: 25, lon: 121, radius: 6, color: '#0ebf9c' }];
    const pBuf = packPoints(pts, 16);
    const tBuf = packTrajectories([{ src: [24, 120], dst: [25, 121] }], 16);
    const hBuf = packHeatmapPoints(pts, 16);

    resetWasmArena();

    drawBatchPoints(ctx, vp, pts, pBuf);
    drawBatchTrajectories(ctx, vp, tBuf);
    drawHeatmap(ctx, hBuf, vp);
    const center = vp.project(25, 121);
    expect(
      hitTestPointBuffers(center.x, center.y, pts, pBuf, vp, 18)?.index
    ).toBe(0);
  });
});

describe('createMap full lifecycle & observeElementRect', () => {
  it('cleans up all layers, slots, and listeners on destroy()', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onClick = vi.fn();
    const map = createMap(container, {
      center: [25, 121],
      zoom: 5,
      zoomControls: true,
      onClick,
    });

    const overlayEl = document.createElement('div');
    overlayEl.className = 'test-overlay';
    const ctrlEl = document.createElement('button');
    ctrlEl.textContent = 'Reset';

    map.addPointLayer({
      points: [{ lat: 25, lon: 121, radius: 5, color: '#fff' }],
    });
    map.addTrajectoryLayer([{ src: [24, 120], dst: [25, 121] }]);
    map.addHeatmapLayer({ points: [{ lat: 25, lon: 121, weight: 1 }] });
    map.addOverlay(overlayEl, [25, 121]);
    map.addControl(ctrlEl, 'top-left');

    expect(container.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(
      3
    );
    expect(container.querySelector('.test-overlay')).not.toBeNull();
    expect(container.querySelector('.map-zoom-controls')).not.toBeNull();

    map.destroy();
    expect(container.querySelectorAll('canvas').length).toBe(0);
    expect(container.querySelector('.test-overlay')).toBeNull();
    expect(container.querySelector('.map-control-slot')).toBeNull();

    // Post-destroy layer additions must immediately clean up
    const lateOverlay = document.createElement('div');
    map.addOverlay(lateOverlay, [25, 121]);
    expect(container.contains(lateOverlay)).toBe(false);

    container.remove();
  });

  it('re-syncs element rect on window scroll via observeElementRect', () => {
    const el = document.createElement('div');
    let left = 10;
    el.getBoundingClientRect = () =>
      ({
        left,
        top: 20,
        width: 300,
        height: 200,
        right: left + 300,
        bottom: 220,
        x: left,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    const seen: number[] = [];
    const stop = observeElementRect(el, (r) => seen.push(r.left), false);
    expect(seen).toEqual([10]);

    left = 45;
    window.dispatchEvent(new Event('scroll'));
    expect(seen).toEqual([10, 45]);

    stop();
    left = 80;
    window.dispatchEvent(new Event('scroll'));
    expect(seen).toEqual([10, 45]);
  });
});

describe('createCruiseController edge cases', () => {
  it('supports pause + resumeAfterMs, loop=false completion, and next/prev/goTo', () => {
    vi.useFakeTimers();
    const vp = new Viewport({
      center: [0, 0],
      zoom: 3,
      width: 600,
      height: 400,
    });
    const events: string[] = [];
    let dynamicList = [
      {
        center: [25, 121] as [number, number],
        zoom: 6,
        durationMs: 0,
        dwellMs: 100,
      },
      {
        center: [35, 139] as [number, number],
        zoom: 6,
        durationMs: 0,
        dwellMs: 100,
      },
    ];
    const ctrl = createCruiseController(vp, () => dynamicList, {
      loop: false,
      durationMs: 0,
      onUserInteract: 'pause',
      resumeAfterMs: 250,
    });
    ctrl.on('pause', () => events.push('pause'));
    ctrl.on('resume', () => events.push('resume'));
    ctrl.on('complete', () => events.push('complete'));

    ctrl.start();
    expect(ctrl.getState().currentIndex).toBe(0);

    // Simulate user pan -> pauses, then auto-resumes after 250ms
    vp.panBy(10, 0);
    expect(ctrl.getState().paused).toBe(true);
    expect(events).toContain('pause');

    vi.advanceTimersByTime(250);
    expect(ctrl.getState().paused).toBe(false);
    expect(events).toContain('resume');

    // Finish waypoints -> triggers complete with loop=false
    vi.advanceTimersByTime(300);
    expect(events).toContain('complete');
    expect(ctrl.getState().phase).toBe('idle');

    // Manual navigation next / prev / goTo clamping
    ctrl.goTo(99);
    expect(ctrl.getState().currentIndex).toBe(1);
    ctrl.prev();
    expect(ctrl.getState().currentIndex).toBe(0);
    ctrl.next();
    expect(ctrl.getState().currentIndex).toBe(1);

    dynamicList = [];
    ctrl.destroy();
  });
});

describe('React Marker variants, useViewportSelector, and CanvasLayer', () => {
  it('renders Marker pin/dot/ring variants and toggles popup with click and Escape', () => {
    const { container, getByText, queryByText } = render(
      <MapView center={[25, 121]} zoom={5}>
        <Marker
          position={[25, 121]}
          variant="pin"
          pulse="ripple"
          pulseLoop
          dropIn
          fadeMs={2000}
          popup={<span>Taipei Popup</span>}
        />
        <Marker position={[24, 120]} variant="dot" glow intensity={1.2} />
        <Marker position={[23, 120]} variant="ring" pulse="expand" fps={0} />
      </MapView>
    );

    expect(container.querySelector('.map-marker-pulse--ripple')).not.toBeNull();
    expect(container.querySelector('.map-marker-pulse--expand')).not.toBeNull();
    expect(queryByText('Taipei Popup')).toBeNull();

    const pinOverlay = container.querySelector('.map-marker-pulse--ripple')
      ?.parentElement?.parentElement?.parentElement;
    expect(pinOverlay).not.toBeNull();
    fireEvent.click(pinOverlay!);
    expect(getByText('Taipei Popup')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByText('Taipei Popup')).toBeNull();
  });

  it('skips re-render in useViewportSelector when derived slice is unchanged and preserves CanvasLayer DOM', () => {
    const mapRef = React.createRef<MapViewHandle>();
    let selectorRenders = 0;

    const ZoomIntProbe: React.FC = () => {
      selectorRenders += 1;
      const zInt = useViewportSelector((s) => Math.floor(s.zoom));
      return <span data-testid="z-int">{zInt}</span>;
    };

    const DynamicCanvasHost: React.FC = () => {
      const [dpr, setDpr] = useState(0.5);
      return (
        <>
          <button onClick={() => setDpr(1)} data-testid="bump-dpr">
            bump
          </button>
          <CanvasLayer interactionMaxDpr={dpr} onDraw={() => {}} />
        </>
      );
    };

    const { container, getByTestId } = render(
      <MapView ref={mapRef} center={[25, 121]} zoom={4}>
        <ZoomIntProbe />
        <DynamicCanvasHost />
      </MapView>
    );

    expect(selectorRenders).toBe(1);
    const canvasBefore = container.querySelector('canvas');
    expect(canvasBefore).not.toBeNull();

    // Panning does not change Math.floor(zoom) -> no re-render
    act(() => {
      mapRef.current?.setView([26, 122], 4.4);
    });
    expect(selectorRenders).toBe(1);

    // Crossing integer zoom boundary -> re-renders
    act(() => {
      mapRef.current?.setView([26, 122], 5.1);
    });
    expect(selectorRenders).toBe(2);
    expect(getByTestId('z-int').textContent).toBe('5');

    // Updating interactionMaxDpr reuses the same <canvas> element
    fireEvent.click(getByTestId('bump-dpr'));
    expect(container.querySelector('canvas')).toBe(canvasBefore);
  });
});

describe('Generalized animation frame-pacing (core/animation)', () => {
  it('resolves frame intervals and stepped/smooth easings across FPS modes', () => {
    expect(resolveFrameIntervalMs(undefined)).toBe(0);
    expect(resolveFrameIntervalMs(undefined, 20)).toBe(50);
    expect(resolveFrameIntervalMs(10, 20)).toBe(100);
    expect(resolveFrameIntervalMs(0, 20)).toBe(0);
    expect(resolveFrameIntervalMs(Number.POSITIVE_INFINITY, 20)).toBe(0);

    expect(shouldAdvanceFrame(100, 0, 50)).toBe(true);
    expect(shouldAdvanceFrame(120, 100, 50)).toBe(false);
    expect(shouldAdvanceFrame(150, 100, 50)).toBe(true);
    expect(shouldAdvanceFrame(105, 100, 0)).toBe(true);

    expect(resolveAnimationEasing(1000, undefined, 'ease-out')).toBe(
      'ease-out'
    );
    expect(resolveAnimationEasing(1000, 18, 'ease-out')).toBe('steps(18, end)');
    expect(resolveAnimationEasing(100, 10, 'ease-out', 0, 6)).toBe(
      'steps(6, end)'
    );
    expect(resolveAnimationEasing(1000, 0, 'ease-out')).toBe('ease-out');
  });

  it('applies custom fps and unthrottled default to Marker pulse CSS variables', () => {
    const { container } = render(
      <MapView center={[25, 121]} zoom={5}>
        <Marker
          position={[25, 121]}
          variant="dot"
          pulse="radar"
          dropIn
          fps={10}
        />
        <Marker position={[24, 120]} variant="dot" pulse="radar" />
      </MapView>
    );
    const pulses = container.querySelectorAll('.map-marker-pulse--radar');
    expect(pulses).toHaveLength(2);
    expect(
      (pulses[0] as HTMLElement).style.getPropertyValue('--map-pulse-easing')
    ).toBe('steps(18, end)');
    expect(
      (pulses[1] as HTMLElement).style.getPropertyValue('--map-pulse-easing')
    ).toBe('ease-out');
  });
});

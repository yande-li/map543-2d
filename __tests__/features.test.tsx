import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MapView,
  Overlay,
  PointLayer,
  Viewport,
  createEquirectangular,
  drawBatchTrajectories,
  initWasm,
  packTrajectories,
  packTrajectoryArrays,
  resetWasmArena,
} from '../index';
import { createMap } from '../core';
import {
  createCruiseController,
  type CruiseTarget,
  type CruiseWaypoint,
} from '../cruise';
import { useCruise } from '../cruise-react';

describe('MapView cursor & PointLayer hover restoration', () => {
  it('applies cursor prop and falls back to --map543-cursor CSS variable', () => {
    const { container, rerender } = render(
      <MapView center={[25, 121]} zoom={4} />
    );
    const el = container.querySelector('.map-container') as HTMLDivElement;
    expect(el.style.cursor).toBe('var(--map543-cursor, grab)');

    rerender(<MapView center={[25, 121]} zoom={4} cursor="crosshair" />);
    expect(el.style.cursor).toBe('crosshair');

    rerender(<MapView center={[25, 121]} zoom={4} cursor="none" />);
    expect(el.style.cursor).toBe('none');
  });

  it('preserves MapView cursor when PointLayer hover enters and leaves', () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });

    const { container } = render(
      <MapView center={[25, 121]} zoom={4} cursor="crosshair">
        <PointLayer
          points={[{ lat: 25, lon: 121, radius: 8, color: '#f00' }]}
          onPointHover={() => {}}
        />
      </MapView>
    );
    const el = container.querySelector('.map-container') as HTMLDivElement;
    expect(el.style.cursor).toBe('crosshair');

    el.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(el.style.cursor).toBe('crosshair');

    vi.restoreAllMocks();
  });

  it('supports cursor in createMap and Overlay', () => {
    const host = document.createElement('div');
    const map = createMap(host, { cursor: 'cell' });
    expect(host.style.cursor).toBe('cell');
    map.destroy();
    expect(host.style.cursor).toBe('');

    const { container } = render(
      <MapView center={[25, 121]} zoom={4}>
        <Overlay position={[25, 121]} interactive cursor="zoom-in">
          <span>Pin</span>
        </Overlay>
      </MapView>
    );
    const span = container.querySelector('span');
    expect(span?.parentElement?.style.cursor).toBe('zoom-in');
  });
});

describe('createCruiseController & useCruise', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cycles overview + waypoints with callbacks and stops on user interaction', () => {
    vi.useFakeTimers();
    const vp = new Viewport({
      center: [0, 0],
      zoom: 2,
      width: 1920,
      height: 1080,
      referenceWidth: 1920,
    });

    const entered: number[] = [];
    const left: number[] = [];
    const waypoints: CruiseWaypoint[] = [
      { center: [25, 121], zoom: 6, label: 'TPE' },
      { center: [35.68, 139.65], zoom: 6, label: 'TYO' },
    ];

    const cruise = createCruiseController(vp, () => waypoints, {
      overview: { center: [20, 100], zoom: 2, durationMs: 0, dwellMs: 100 },
      lowPower: true,
      responsiveZoom: true,
      dwellMs: 100,
      onEnterWaypoint: (_wp, idx) => entered.push(idx),
      onLeaveWaypoint: (_wp, idx) => left.push(idx),
    });

    cruise.start();
    expect(cruise.getState().phase).toBe('overview');
    expect(vp.getState().center).toEqual([20, 100]);

    vi.advanceTimersByTime(100);
    expect(cruise.getState().phase).toBe('waypoint');
    expect(entered).toEqual([0]);

    vi.advanceTimersByTime(100);
    expect(entered).toEqual([0, 1]);
    expect(left).toEqual([0]);

    // User pan triggers stop (default onUserInteract: 'stop')
    vp.panBy(20, 0);
    expect(cruise.getState().playing).toBe(false);
    expect(left).toEqual([0, 1]);

    cruise.destroy();
  });

  it('supports declarative useCruise hook inside MapView', () => {
    let latestPlaying = false;
    const Probe: React.FC = () => {
      const { state } = useCruise([{ center: [25, 121], zoom: 5 }], {
        autoStart: true,
        lowPower: true,
      });
      latestPlaying = state.playing;
      return null;
    };
    const { unmount } = render(
      <MapView center={[0, 0]} zoom={2}>
        <Probe />
      </MapView>
    );
    expect(latestPlaying).toBe(true);
    act(() => unmount());
  });

  it('supports generic CruiseTarget (custom fitBounds, data payload T, setOptions, standalone useCruise)', () => {
    vi.useFakeTimers();
    const fitCalls: number[] = [];
    const setCalls: number[] = [];
    const customTarget: CruiseTarget = {
      setView: (_c, z) => setCalls.push(z ?? 0),
      flyTo: (_c, z) => setCalls.push(z ?? 0),
      fitBounds: (_b, pad) => fitCalls.push(pad ?? 0),
    };
    const seenIds: string[] = [];
    const cruise = createCruiseController<{ id: string }>(
      customTarget,
      [
        {
          bounds: [
            [21, 119],
            [26, 122],
          ],
          paddingPx: 24,
          data: { id: 'tw' },
        },
        { center: [35.68, 139.65], zoom: 7, data: { id: 'jp' } },
      ],
      {
        dwellMs: 50,
        durationMs: 100,
        onEnterWaypoint: (wp) => {
          if (wp.data) seenIds.push(wp.data.id);
        },
      }
    );

    cruise.start();
    expect(fitCalls).toEqual([24]);
    expect(seenIds).toEqual(['tw']);

    cruise.setOptions({ lowPower: true });
    vi.advanceTimersByTime(150);
    expect(seenIds).toEqual(['tw', 'jp']);
    expect(setCalls).toEqual([7]);
    cruise.destroy();

    let standalonePlaying = false;
    const Standalone: React.FC = () => {
      const { state } = useCruise([{ center: [0, 0], zoom: 3 }], {
        target: customTarget,
        autoStart: true,
        lowPower: true,
      });
      standalonePlaying = state.playing;
      return null;
    };
    const { unmount } = render(<Standalone />);
    expect(standalonePlaying).toBe(true);
    act(() => unmount());
  });
});

describe('Mercator & multi-projection 32/16-bit batch Canvas trajectories', () => {
  it('draws 32/16-bit trajectories in Mercator (WASM) and Equirectangular with culling & wrap-around', () => {
    expect(initWasm()).toBe(true);
    resetWasmArena();

    let moveCount = 0;
    let curveCount = 0;
    let rectCount = 0;
    const mockCtx = {
      beginPath: () => {},
      moveTo: () => {
        moveCount++;
      },
      lineTo: () => {},
      quadraticCurveTo: () => {
        curveCount++;
      },
      stroke: () => {},
      rect: () => {
        rectCount++;
      },
      fill: () => {},
      strokeStyle: '',
      fillStyle: '',
      lineCap: 'butt',
      lineWidth: 1,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    const items = [
      {
        src: [25, 121] as [number, number],
        dst: [35.68, 139.65] as [number, number],
      },
      {
        src: [-80, -170] as [number, number],
        dst: [-80, -169] as [number, number],
      }, // offscreen at zoom 4
    ];

    const vpMerc = new Viewport({
      center: [30, 130],
      zoom: 4,
      width: 800,
      height: 600,
    });
    const buf32 = packTrajectories(items, 32);
    const buf16 = packTrajectories(items, 16);
    expect(buf16.srcLats).toBeInstanceOf(Int16Array);

    drawBatchTrajectories(mockCtx, vpMerc, buf32);
    expect(moveCount).toBe(1);
    expect(curveCount).toBe(1);
    expect(rectCount).toBe(1);

    moveCount = 0;
    drawBatchTrajectories(mockCtx, vpMerc, buf16);
    expect(moveCount).toBe(1);

    // Equirectangular projection path + SoA packing
    const vpEq = new Viewport({
      center: [30, 130],
      zoom: 2,
      width: 800,
      height: 600,
      projection: createEquirectangular(),
    });
    const soa = packTrajectoryArrays({
      srcLats: new Float32Array([25]),
      srcLons: new Float32Array([121]),
      dstLats: new Float32Array([35.68]),
      dstLons: new Float32Array([139.65]),
    });
    moveCount = 0;
    drawBatchTrajectories(mockCtx, vpEq, soa);
    expect(moveCount).toBeGreaterThanOrEqual(1);
  });
});

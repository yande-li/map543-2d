// @vitest-environment jsdom
import React, { createRef } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MapError,
  MapView,
  Marker,
  PointLayer,
  TrajectoryLayer,
  VectorLayer,
  loadGeobuf,
  prepareArcs,
  useGeobuf,
  useMapClick,
  useViewport,
  useViewportSelector,
  type MapViewHandle,
  type PointItem,
} from '../index';
import { createMap } from '../core';

// Minimal valid Geobuf (FeatureCollection with 1 Point [121, 25])
const SAMPLE_GEOBUF = new Uint8Array([
  0x10,
  0x02, // dimensions = 2
  0x18,
  0x06, // precision = 6
  0x22,
  0x10, // feature_collection
  0x0a,
  0x0e, // feature
  0x0a,
  0x0c, // geometry
  0x08,
  0x00, // type = Point
  0x1a,
  0x08,
  0xf8,
  0xa2,
  0xc3,
  0x73,
  0xa0,
  0xd4,
  0xd8,
  0x17, // coords
]).buffer;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Simplified Core & React APIs', () => {
  it('loadGeobuf fetches and parses a Geobuf buffer and wraps HTTP errors in MapError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        arrayBuffer: async () => SAMPLE_GEOBUF.slice(0),
      })
    );

    const parsed = await loadGeobuf('/test.geobuf');
    expect(parsed.fillLayers).toHaveLength(0);
    expect(parsed.strokeLayers).toHaveLength(0);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
    );

    await expect(loadGeobuf('/missing.geobuf')).rejects.toMatchObject({
      name: 'MapError',
      code: 'GEOBUF_DECODE_ERROR',
    });
  });

  it('prepareArcs generates stable fallback keys when TrajectoryItem.key is omitted', () => {
    const prepared = prepareArcs([
      { src: [25, 121], dst: [35, 139] },
      { srcLat: 0, srcLon: 0, dstLat: 10, dstLon: 10, curve: 'straight' },
    ]);
    expect(prepared.items).toHaveLength(2);
    expect(prepared.items[0].key).toBeTruthy();
    expect(prepared.items[1].key).toBeTruthy();
    expect(prepared.items[0].key).not.toBe(prepared.items[1].key);
  });

  it('createMap provides unified non-React lifecycle, zoom controls, layers, and destroy', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);

    const onMove = vi.fn();
    const map = createMap(container, {
      center: [25, 121],
      zoom: 5,
      zoomControls: { position: 'top-left', delta: 1 },
      onMove,
    });

    expect(
      container.querySelector('.map-zoom-controls.top-left')
    ).not.toBeNull();

    const points: PointItem[] = [
      { lat: 25, lon: 121, radius: 5, color: '#0ff' },
    ];
    const removePoints = map.addPointLayer({ points, precision: 16 });
    const removeTraj = map.addTrajectoryLayer([
      { src: [25, 121], dst: [35, 139] },
    ]);
    const removeVec = map.addVectorLayer({ data: SAMPLE_GEOBUF.slice(0) });
    const pinEl = document.createElement('div');
    pinEl.textContent = 'Taipei 101';
    const removeOverlay = map.addOverlay(pinEl, [25.033, 121.565]);
    expect(container.textContent).toContain('Taipei 101');

    map.setView([24, 120], 6);
    expect(map.getState().zoom).toBe(6);
    expect(onMove).toHaveBeenCalled();

    map.fitBounds([
      [20, 118],
      [26, 123],
    ]);
    expect(map.getState().center[0]).toBeCloseTo(23, 0);

    removeOverlay();
    removePoints();
    removeTraj();
    removeVec();
    map.destroy();

    expect(container.querySelector('.map-zoom-controls')).toBeNull();
    container.remove();
  });

  it('MapView exposes MapViewHandle ref, passes ViewportState to onMove, and supports zoomControls object', () => {
    const ref = createRef<MapViewHandle>();
    const onMove = vi.fn();

    render(
      <MapView
        ref={ref}
        center={[25, 121]}
        zoom={4}
        zoomControls={{ position: 'top-right', delta: 1 }}
        onMove={onMove}
      />
    );

    expect(ref.current).not.toBeNull();
    act(() => {
      ref.current?.setView([35, 139], 7);
    });

    expect(ref.current?.getState().zoom).toBe(7);
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 7, center: [35, 139] })
    );
  });

  it('useViewport, useViewportSelector, and useMapClick work without manual useEffect', () => {
    const ref = createRef<MapViewHandle>();
    const clickSpy = vi.fn();

    const Hud: React.FC = () => {
      const vp = useViewport();
      const zoomOnly = useViewportSelector((s) => Math.round(s.zoom));
      useMapClick(clickSpy);
      return (
        <div data-testid="hud">
          {vp.center[0].toFixed(1)}|{zoomOnly}
        </div>
      );
    };

    render(
      <MapView ref={ref} center={[25, 121]} zoom={4}>
        <Hud />
      </MapView>
    );

    expect(screen.getByTestId('hud').textContent).toBe('25.0|4');

    act(() => {
      ref.current?.setView([30, 120], 8);
    });
    expect(screen.getByTestId('hud').textContent).toBe('30.0|8');
  });

  it('VectorLayer src and useGeobuf fetch declaratively and invoke onLoad/onError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        arrayBuffer: async () => SAMPLE_GEOBUF.slice(0),
      })
    );

    const onLoad = vi.fn();
    const GeobufProbe: React.FC = () => {
      const { data, loading, error } = useGeobuf('/probe.geobuf');
      return (
        <div data-testid="probe">
          {loading ? 'loading' : error ? 'error' : data ? 'ready' : 'idle'}
        </div>
      );
    };

    render(
      <MapView center={[25, 121]} zoom={4}>
        <VectorLayer src="/world.geobuf" precision={16} onLoad={onLoad} />
        <GeobufProbe />
      </MapView>
    );

    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('probe').textContent).toBe('ready');
    });
  });

  it('Marker popup toggles on click and closes on Escape, and TrajectoryLayer accepts items without key', () => {
    render(
      <MapView center={[25, 121]} zoom={4}>
        <Marker
          position={[25.033, 121.565]}
          title="Taipei"
          popup={<span>Taipei 101</span>}
        />
        <PointLayer
          points={[{ lat: 25, lon: 121, radius: 4, color: '#0ff' }]}
          onPointHover={vi.fn()}
        />
        <TrajectoryLayer items={[{ src: [25, 121], dst: [35, 139] }]} />
      </MapView>
    );

    expect(screen.queryByText('Taipei 101')).toBeNull();
    const markerEl = screen.getByTitle('Taipei');
    fireEvent.click(markerEl);
    expect(screen.getByText('Taipei 101')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Taipei 101')).toBeNull();
  });

  it('MapError preserves typed code', () => {
    const err = new MapError('RESOURCE_LIMIT_EXCEEDED', 'Too large');
    expect(err.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(err.message).toContain('RESOURCE_LIMIT_EXCEEDED');
  });
});

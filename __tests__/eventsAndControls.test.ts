import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import {
  createEmitter,
  Viewport,
  createControlSlots,
  createLayerGroup,
  MAP_Z_INDEX,
  hitTestPointBuffers,
  packPoints,
  attachInteractions,
  attachGamepad,
  type LayerHandle,
} from '../core';
import { MapView, PointLayer, type PointLayerHandle } from '../index';

describe('createEmitter', () => {
  it('supports on, once, hasListeners, and disposers', () => {
    const emitter = createEmitter<{ ping: number; done: string }>();
    const hits: number[] = [];

    expect(emitter.hasListeners('ping')).toBe(false);
    const unsub = emitter.on('ping', (n) => hits.push(n));
    expect(emitter.hasListeners('ping')).toBe(true);

    emitter.emit('ping', 1);
    emitter.emit('ping', 2);
    unsub();
    emitter.emit('ping', 3);
    expect(emitter.hasListeners('ping')).toBe(false);
    expect(hits).toEqual([1, 2]);

    const onceFn = vi.fn();
    emitter.once('done', onceFn);
    emitter.emit('done', 'a');
    emitter.emit('done', 'b');
    expect(onceFn).toHaveBeenCalledTimes(1);
    expect(onceFn).toHaveBeenCalledWith('a');
  });
});

describe('Viewport lifecycle events', () => {
  it('emits movestart -> move -> moveend on panBy', () => {
    const vp = new Viewport({
      center: [0, 0],
      zoom: 4,
      width: 400,
      height: 300,
    });
    const order: string[] = [];

    vp.on('movestart', () => order.push('movestart'));
    vp.on('move', () => order.push('move'));
    vp.on('moveend', () => order.push('moveend'));
    vp.on('zoomstart', () => order.push('zoomstart'));

    vp.panBy(20, 10);
    expect(order).toEqual(['movestart', 'move', 'moveend']);
  });

  it('emits zoomstart -> move -> zoom -> zoomend -> moveend on zoomAt', () => {
    const vp = new Viewport({
      center: [0, 0],
      zoom: 4,
      width: 400,
      height: 300,
    });
    const order: string[] = [];

    vp.on('movestart', () => order.push('movestart'));
    vp.on('zoomstart', () => order.push('zoomstart'));
    vp.on('move', () => order.push('move'));
    vp.on('zoom', () => order.push('zoom'));
    vp.on('zoomend', () => order.push('zoomend'));
    vp.on('moveend', () => order.push('moveend'));

    vp.zoomAt(5, 200, 150);
    expect(order).toEqual([
      'movestart',
      'zoomstart',
      'move',
      'zoom',
      'zoomend',
      'moveend',
    ]);
  });

  it('coalesces continuous gesture updates into single start/end pair', () => {
    const vp = new Viewport({
      center: [0, 0],
      zoom: 4,
      width: 400,
      height: 300,
    });
    const starts = vi.fn();
    const moves = vi.fn();
    const ends = vi.fn();

    vp.on('movestart', starts);
    vp.on('move', moves);
    vp.on('moveend', ends);

    vp.beginGesture(false);
    vp.panBy(5, 0);
    vp.panBy(5, 0);
    expect(starts).toHaveBeenCalledTimes(1);
    expect(moves).toHaveBeenCalledTimes(2);
    expect(ends).toHaveBeenCalledTimes(0);

    vp.endGesture();
    expect(ends).toHaveBeenCalledTimes(1);
  });
});

describe('createControlSlots', () => {
  it('lazily creates corner slots, stacks controls, and cleans up empty slots', () => {
    const container = document.createElement('div');
    const slots = createControlSlots(container);

    const el1 = document.createElement('button');
    const el2 = document.createElement('button');

    const unmount1 = slots.mountControl(el1, 'top-right');
    const unmount2 = slots.mountControl(el2, 'top-right');

    const slot = container.querySelector('.map-control-slot.top-right');
    expect(slot).not.toBeNull();
    expect(slot?.getAttribute('style')).toContain(
      `z-index: ${MAP_Z_INDEX.control}`
    );
    expect(slot?.childElementCount).toBe(2);

    unmount1();
    expect(
      container.querySelector('.map-control-slot.top-right')
    ).not.toBeNull();
    expect(slot?.childElementCount).toBe(1);

    unmount2();
    expect(container.querySelector('.map-control-slot.top-right')).toBeNull();

    slots.destroy();
  });
});

describe('createLayerGroup', () => {
  it('propagates visibility, opacity, zIndex, and clear to member handles', () => {
    const h1: LayerHandle = {
      remove: vi.fn(),
      setVisible: vi.fn(),
      setOpacity: vi.fn(),
      setZIndex: vi.fn(),
    };
    const h2: LayerHandle = {
      remove: vi.fn(),
      setVisible: vi.fn(),
    };
    const group = createLayerGroup([h1]);
    group.add(h2);
    expect(group.size()).toBe(2);

    group.setVisible(false);
    expect(h1.setVisible).toHaveBeenCalledWith(false);
    expect(h2.setVisible).toHaveBeenCalledWith(false);

    group.setOpacity(0.5);
    expect(h1.setOpacity).toHaveBeenCalledWith(0.5);

    group.setZIndex(42);
    expect(h1.setZIndex).toHaveBeenCalledWith(42);

    group.clear();
    expect(group.size()).toBe(0);
    expect(h1.remove).toHaveBeenCalledTimes(1);
    expect(h2.remove).toHaveBeenCalledTimes(1);
  });
});

describe('PointLayer hitTest bridge', () => {
  it('queries nearest point at screen coordinates and viewport center', () => {
    const points = [
      { lat: 25.033, lon: 121.565, radius: 6, color: '#f00' },
      { lat: 35.6762, lon: 139.6503, radius: 6, color: '#0f0' },
    ];
    const vp = new Viewport({
      center: [25.033, 121.565],
      zoom: 6,
      width: 400,
      height: 300,
    });
    const buffers = packPoints(points, 32);

    const centerHit = hitTestPointBuffers(200, 150, points, buffers, vp, 18);
    expect(centerHit?.index).toBe(0);
    expect(centerHit?.point).toBe(points[0]);

    const miss = hitTestPointBuffers(0, 0, points, buffers, vp, 10);
    expect(miss).toBeNull();
  });

  it('exposes hitTest and hitTestCenter on React <PointLayer ref />', () => {
    const layerRef = React.createRef<PointLayerHandle>();
    const points = [{ lat: 25, lon: 121, radius: 5, color: '#00f' }];

    render(
      React.createElement(
        MapView,
        { center: [25, 121], zoom: 5 },
        React.createElement(PointLayer, { ref: layerRef, points })
      )
    );

    expect(layerRef.current).not.toBeNull();
    // In jsdom, container size defaults to 0x0 so center is (0, 0) where [25, 121] projects
    const hit = layerRef.current?.hitTestCenter(18);
    expect(hit?.index).toBe(0);
  });
});

describe('Input device gesture lifecycle alignment', () => {
  it('coalesces repeated keyboard pan keys into one movestart -> moveend pair', () => {
    const el = document.createElement('div');
    const vp = new Viewport({
      center: [0, 0],
      zoom: 4,
      width: 400,
      height: 300,
    });
    const starts = vi.fn();
    const moves = vi.fn();
    const ends = vi.fn();
    vp.on('movestart', starts);
    vp.on('move', moves);
    vp.on('moveend', ends);

    const detach = attachInteractions(el, vp, {
      keyboard: true,
      observeResize: false,
    });

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true })
    );
    expect(starts).toHaveBeenCalledTimes(1);
    expect(moves).toHaveBeenCalledTimes(2);
    expect(ends).toHaveBeenCalledTimes(0);

    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    expect(ends).toHaveBeenCalledTimes(1);

    detach();
  });

  it('coalesces continuous gamepad stick input into one movestart -> moveend pair', () => {
    const vp = new Viewport({
      center: [0, 0],
      zoom: 4,
      width: 400,
      height: 300,
    });
    const starts = vi.fn();
    const moves = vi.fn();
    const ends = vi.fn();
    vp.on('movestart', starts);
    vp.on('move', moves);
    vp.on('moveend', ends);

    let axisX = 0.8;
    const mockPad = {
      connected: true,
      axes: [axisX, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    } as unknown as Gamepad;
    Object.defineProperty(mockPad, 'axes', {
      get: () => [axisX, 0, 0, 0],
    });

    const origGetGamepads = navigator.getGamepads;
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;

    let rafCb: FrameRequestCallback | null = null;
    let nextId = 1;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [mockPad],
    });
    globalThis.requestAnimationFrame = (cb) => {
      rafCb = cb;
      return nextId++;
    };
    globalThis.cancelAnimationFrame = () => {
      rafCb = null;
    };

    try {
      const detach = attachGamepad(vp);
      rafCb?.(100);
      rafCb?.(150);
      expect(starts).toHaveBeenCalledTimes(1);
      expect(moves).toHaveBeenCalledTimes(2);
      expect(ends).toHaveBeenCalledTimes(0);

      axisX = 0;
      rafCb?.(200);
      expect(ends).toHaveBeenCalledTimes(1);

      detach();
    } finally {
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: origGetGamepads,
      });
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
    }
  });
});

describe('Input device gesture lifecycle alignment', () => {
  it('coalesces repeated keyboard pan keys into one movestart -> moveend pair', () => {
    const el = document.createElement('div');
    const vp = new Viewport({
      center: [0, 0],
      zoom: 4,
      width: 400,
      height: 300,
    });
    const starts = vi.fn();
    const moves = vi.fn();
    const ends = vi.fn();
    vp.on('movestart', starts);
    vp.on('move', moves);
    vp.on('moveend', ends);

    const detach = attachInteractions(el, vp, {
      keyboard: true,
      observeResize: false,
    });

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true })
    );
    expect(starts).toHaveBeenCalledTimes(1);
    expect(moves).toHaveBeenCalledTimes(2);
    expect(ends).toHaveBeenCalledTimes(0);

    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    expect(ends).toHaveBeenCalledTimes(1);

    detach();
  });

  it('coalesces continuous gamepad stick input into one movestart -> moveend pair', () => {
    const vp = new Viewport({
      center: [0, 0],
      zoom: 4,
      width: 400,
      height: 300,
    });
    const starts = vi.fn();
    const moves = vi.fn();
    const ends = vi.fn();
    vp.on('movestart', starts);
    vp.on('move', moves);
    vp.on('moveend', ends);

    let axisX = 0.8;
    const mockPad = {
      connected: true,
      axes: [axisX, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    } as unknown as Gamepad;
    Object.defineProperty(mockPad, 'axes', {
      get: () => [axisX, 0, 0, 0],
    });

    const origGetGamepads = navigator.getGamepads;
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;

    let rafCb: FrameRequestCallback | null = null;
    let nextId = 1;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [mockPad],
    });
    globalThis.requestAnimationFrame = (cb) => {
      rafCb = cb;
      return nextId++;
    };
    globalThis.cancelAnimationFrame = () => {
      rafCb = null;
    };

    try {
      const detach = attachGamepad(vp);
      rafCb?.(100);
      rafCb?.(150);
      expect(starts).toHaveBeenCalledTimes(1);
      expect(moves).toHaveBeenCalledTimes(2);
      expect(ends).toHaveBeenCalledTimes(0);

      axisX = 0;
      rafCb?.(200);
      expect(ends).toHaveBeenCalledTimes(1);

      detach();
    } finally {
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: origGetGamepads,
      });
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
    }
  });
});

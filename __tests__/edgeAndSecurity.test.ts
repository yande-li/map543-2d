import { describe, expect, it, vi } from 'vitest';
import {
  MapError,
  Viewport,
  drawBatchPoints,
  drawBatchTrajectories,
  drawHeatmap,
  encodePoints16,
  encodeRings16,
  getWasmMemoryStats,
  initWasm,
  loadGeobuf,
  packHeatmapPoints,
  packPoints,
  packTrajectories,
  parseGeobuf,
  quantize16,
  resetWasmArena,
} from '../core';
import { getWasmRuntime } from '../wasm/bridge';

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

describe('Security & malformed Geobuf handling', () => {
  it('rejects varint overflow, invalid wire types, and precision > 12', () => {
    const varintOverflow = new Uint8Array(12).fill(0x80);
    expect(() => parseGeobuf(varintOverflow.buffer)).toThrow(
      /varint overflow/i
    );

    // field 1, wire type 3 (deprecated start-group, unsupported)
    const badWire = new Uint8Array([(1 << 3) | 3]);
    expect(() => parseGeobuf(badWire.buffer)).toThrow(/wire 3/i);

    // field 3 (precision) = 13 (exceeds max 12)
    const badPrecision = new Uint8Array([(3 << 3) | 0, 13]);
    expect(() => parseGeobuf(badPrecision.buffer)).toThrow(MapError);
  });

  it('enforces maxBytes quota on Content-Length and actual body in loadGeobuf', async () => {
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '2048' }),
        arrayBuffer: async () => new ArrayBuffer(2048),
      });
      await expect(
        loadGeobuf('/huge.geobuf', { maxBytes: 1024 })
      ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(2048),
      });
      await expect(
        loadGeobuf('/huge-no-header.geobuf', { maxBytes: 1024 })
      ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('propagates AbortSignal cancellation in loadGeobuf', async () => {
    const origFetch = globalThis.fetch;
    const controller = new AbortController();
    controller.abort();
    try {
      globalThis.fetch = vi
        .fn()
        .mockImplementation((_url: string, init?: RequestInit) => {
          if (init?.signal?.aborted) {
            return Promise.reject(new DOMException('Aborted', 'AbortError'));
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            arrayBuffer: async () => new ArrayBuffer(0),
          });
        });
      await expect(
        loadGeobuf('/cancelled.geobuf', { signal: controller.signal })
      ).rejects.toThrow(/Aborted/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('resists prototype pollution from malicious Geobuf property keys', () => {
    const encoder = new TextEncoder();
    const encodeStrField = (fieldNum: number, s: string): number[] => {
      const b = encoder.encode(s);
      return [(fieldNum << 3) | 2, b.length, ...b];
    };
    const payload = new Uint8Array([
      ...encodeStrField(1, '__proto__'),
      ...encodeStrField(1, 'constructor'),
      ...encodeStrField(1, 'prototype'),
    ]);
    const parsed = parseGeobuf(payload.buffer);
    expect(parsed.fillLayers).toHaveLength(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('Degenerate numerics & WASM memory ceiling', () => {
  it('sanitizes NaN and Infinity in quantizers and packers without throwing', () => {
    expect(quantize16(Number.NaN, 90)).toBe(0);
    expect(quantize16(Number.POSITIVE_INFINITY, 90)).toBe(0);
    expect(quantize16(-Number.POSITIVE_INFINITY, 180)).toBe(0);

    const encPts = encodePoints16(
      [Number.NaN, 999, -999],
      [Number.POSITIVE_INFINITY, -999, 999]
    );
    expect(encPts.lats[0]).toBe(0);
    expect(encPts.lats[1]).toBe(32767);
    expect(encPts.lats[2]).toBe(-32767);
    expect(encPts.lons[0]).toBe(0);

    const encRings = encodeRings16(new Float32Array([-0.5, 1.5, Number.NaN]));
    expect(encRings[0]).toBe(0);
    expect(encRings[1]).toBe(65535);
    expect(encRings[2]).toBe(0);

    const pBuf = packPoints(
      [
        {
          lat: Number.NaN,
          lon: Number.POSITIVE_INFINITY,
          radius: 4,
          color: '#f00',
        },
      ],
      16
    );
    expect(pBuf.lats[0]).toBe(0);
    expect(pBuf.lons[0]).toBe(0);

    const hBuf = packHeatmapPoints(
      [{ lat: Number.NaN, lon: 121, weight: Number.NaN }],
      16
    );
    expect(hBuf.maxWeight).toBe(1);

    const tBuf = packTrajectories(
      [{ src: [Number.NaN, 120], dst: [25, Number.POSITIVE_INFINITY] }],
      16
    );
    expect(tBuf.count).toBe(1);
    expect(tBuf.srcLats[0]).toBe(0);
    expect(tBuf.dstLons[0]).toBe(0);
  });

  it('rejects WASM capacity requests exceeding 32 MiB without trapping', () => {
    expect(initWasm()).toBe(true);
    const rt = getWasmRuntime();
    expect(rt).not.toBeNull();
    expect(rt?.ensureCapacity(64 * 1024 * 1024)).toBe(false);
    expect(rt?.ensureCapacity(0)).toBe(false);
    expect(rt?.allocStatic(64 * 1024 * 1024)).toBeNull();
  });

  it('returns false safely from drawHeatmap on invalid palette or zero viewport', () => {
    const ctx = createNoopCtx();
    const vpZero = new Viewport({
      center: [25, 121],
      zoom: 4,
      width: 0,
      height: 0,
    });
    const vpOk = new Viewport({
      center: [25, 121],
      zoom: 4,
      width: 400,
      height: 300,
    });
    const hm = packHeatmapPoints([{ lat: 25, lon: 121, weight: 2 }], 32);

    expect(drawHeatmap(ctx, hm, vpZero)).toBe(false);
    expect(drawHeatmap(ctx, hm, vpOk, { palette: new Uint8Array(16) })).toBe(
      false
    );
  });
});

describe('Render-loop steady-state WASM zero-leak', () => {
  it('maintains constant WASM byteLength and arenaUsedBytes over 100 frames', () => {
    resetWasmArena();
    const ctx = createNoopCtx();
    const vp = new Viewport({
      center: [25, 121],
      zoom: 5,
      width: 800,
      height: 600,
    });
    const pts = Array.from({ length: 200 }, (_, i) => ({
      lat: 22 + (i % 6) * 0.5,
      lon: 119 + (i % 8) * 0.5,
      radius: 4,
      color: '#0ebf9c',
    }));
    const pBuf = packPoints(pts, 16);
    const tBuf = packTrajectories(
      pts.slice(0, 100).map((p) => ({ src: [p.lat, p.lon], dst: [25, 121] })),
      16
    );
    const hBuf = packHeatmapPoints(pts, 16);
    const scratch = {};

    // Warm up 2 frames
    for (let f = 0; f < 2; f++) {
      drawBatchPoints(ctx, vp, pts, pBuf);
      drawBatchTrajectories(ctx, vp, tBuf);
      drawHeatmap(ctx, hBuf, vp, { gridScale: 0.25 }, scratch);
    }
    const baseline = getWasmMemoryStats();
    expect(baseline.ready).toBe(true);

    for (let f = 0; f < 100; f++) {
      drawBatchPoints(ctx, vp, pts, pBuf);
      drawBatchTrajectories(ctx, vp, tBuf);
      drawHeatmap(ctx, hBuf, vp, { gridScale: 0.25 }, scratch);
    }
    const after = getWasmMemoryStats();
    expect(after.byteLength).toBe(baseline.byteLength);
    expect(after.arenaUsedBytes).toBe(baseline.arenaUsedBytes);
    expect(after.epoch).toBe(baseline.epoch);
  });
});

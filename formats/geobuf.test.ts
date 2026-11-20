/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { initWasm } from '../wasm/bridge';
import { parseGeobuf } from './geobuf';

beforeAll(async () => {
  const wasmBytes = readFileSync(
    resolve(import.meta.dirname, '../wasm/kernels.wasm')
  );
  await initWasm(wasmBytes);
});

function pushVarint(out: number[], v: number): void {
  let n = BigInt(v);
  while (n >= 0x80n) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
}

function pushZigZag(out: number[], v: number): void {
  const n = BigInt(v);
  const zz = n >= 0n ? n << 1n : (-n << 1n) - 1n;
  let u = zz;
  while (u >= 0x80n) {
    out.push(Number((u & 0x7fn) | 0x80n));
    u >>= 7n;
  }
  out.push(Number(u));
}

function pushTag(out: number[], field: number, wire: number): void {
  pushVarint(out, (field << 3) | wire);
}

function pushBytesField(out: number[], field: number, payload: number[]): void {
  pushTag(out, field, 2);
  pushVarint(out, payload.length);
  out.push(...payload);
}

function pushStringField(out: number[], field: number, text: string): void {
  const encoded = Array.from(new TextEncoder().encode(text));
  pushBytesField(out, field, encoded);
}

function buildTestGeobufPolygon(options?: {
  precision?: number;
  dimensions?: number;
  layerName?: string;
}): ArrayBuffer {
  const precision = options?.precision ?? 6;
  const dimensions = options?.dimensions ?? 2;
  const scale = Math.pow(10, precision);

  // Open ring (closing point omitted per official mapbox/geobuf spec)
  const pts: [number, number][] = [
    [10, 20],
    [12, 20],
    [12, 22],
    [10, 22],
  ];

  const coords: number[] = [];
  let accX = 0;
  let accY = 0;
  for (const [lon, lat] of pts) {
    const qx = Math.round(lon * scale);
    const qy = Math.round(lat * scale);
    pushZigZag(coords, qx - accX);
    pushZigZag(coords, qy - accY);
    if (dimensions === 3) {
      pushZigZag(coords, 0);
    }
    accX = qx;
    accY = qy;
  }

  const geom: number[] = [];
  pushTag(geom, 1, 0);
  pushVarint(geom, 4); // POLYGON
  pushBytesField(geom, 3, coords);

  const feat: number[] = [];
  pushBytesField(feat, 1, geom);
  if (options?.layerName) {
    const valMsg: number[] = [];
    pushStringField(valMsg, 1, options.layerName);
    pushBytesField(feat, 13, valMsg);
    const props: number[] = [];
    pushVarint(props, 0);
    pushVarint(props, 0);
    pushBytesField(feat, 14, props);
  }

  const fc: number[] = [];
  pushBytesField(fc, 1, feat);

  const data: number[] = [];
  if (options?.layerName) {
    pushStringField(data, 1, 'layer');
  }
  pushTag(data, 2, 0);
  pushVarint(data, dimensions);
  pushTag(data, 3, 0);
  pushVarint(data, precision);
  pushBytesField(data, 4, fc);

  return Uint8Array.from(data).buffer;
}

describe('parseGeobuf', () => {
  it('decodes a Geobuf Polygon and closes the ring with Mercator projection', () => {
    const buf = buildTestGeobufPolygon({
      precision: 5,
      dimensions: 3,
      layerName: 'urban',
    });

    const { fillLayers, strokeLayers } = parseGeobuf(buf);
    expect(fillLayers).toHaveLength(1);
    expect(strokeLayers).toHaveLength(1);
    expect(fillLayers[0].name).toBe('urban');

    const feat = fillLayers[0].features[0];
    expect(feat.isPolygon).toBe(true);
    expect(feat.ringCount).toBe(1);
    // 4 open vertices + 1 closing vertex = 5 points (10 floats)
    expect(feat.ringLengths[0]).toBe(10);
    expect(feat.packedXY.length).toBe(10);
    expect(feat.minLon).toBeCloseTo(10, 4);
    expect(feat.maxLon).toBeCloseTo(12, 4);
    expect(feat.minLat).toBeCloseTo(20, 4);
    expect(feat.maxLat).toBeCloseTo(22, 4);
    // Closed ring check
    expect(feat.packedXY[0]).toBeCloseTo(feat.packedXY[8], 6);
    expect(feat.packedXY[1]).toBeCloseTo(feat.packedXY[9], 6);
  });

  it('decodes a MultiPolygon with outer and inner ring lengths', () => {
    const scale = 1e6;
    const coords: number[] = [];
    const ring1: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const ring2: [number, number][] = [
      [2, 2],
      [4, 2],
      [4, 4],
      [2, 4],
    ];
    let accX = 0;
    let accY = 0;
    for (const [lon, lat] of [...ring1, ...ring2]) {
      const qx = Math.round(lon * scale);
      const qy = Math.round(lat * scale);
      pushZigZag(coords, qx - accX);
      pushZigZag(coords, qy - accY);
      accX = qx;
      accY = qy;
    }

    const lengths: number[] = [];
    for (const n of [1, 2, 4, 4]) {
      pushVarint(lengths, n);
    }

    const geom: number[] = [];
    pushTag(geom, 1, 0);
    pushVarint(geom, 5); // MULTIPOLYGON
    pushBytesField(geom, 2, lengths);
    pushBytesField(geom, 3, coords);

    const data: number[] = [];
    pushBytesField(data, 6, geom);

    const { fillLayers } = parseGeobuf(Uint8Array.from(data).buffer, 'land');
    expect(fillLayers).toHaveLength(1);
    expect(fillLayers[0].name).toBe('land');
    const feat = fillLayers[0].features[0];
    expect(feat.ringCount).toBe(2);
    expect(Array.from(feat.ringLengths)).toEqual([10, 10]);
  });

  it('rejects empty, truncated, and invalid-dimension Geobuf buffers', () => {
    expect(() => parseGeobuf(new ArrayBuffer(0))).toThrow();

    // Truncated length-delimited field
    const truncated = Uint8Array.from([0x22, 0x10, 0x01]).buffer;
    expect(() => parseGeobuf(truncated)).toThrow();

    // Invalid dimensions = 1
    const badDims = Uint8Array.from([0x10, 0x01]).buffer;
    expect(() => parseGeobuf(badDims)).toThrow();
  });
});

import type { PreparedFeature, PreparedLayer } from './types';
import { splitAntimeridianFeature } from './antimeridian';
import { LUT_OFFSET_BYTES, getWasmRuntime } from '../wasm/bridge';
import { MapError } from '../core/errors';

const textDecoder = new TextDecoder('utf-8');

const enum GeomType {
  Point = 0,
  MultiPoint = 1,
  LineString = 2,
  MultiLineString = 3,
  Polygon = 4,
  MultiPolygon = 5,
  GeometryCollection = 6,
}

interface PbReader {
  bytes: Uint8Array;
  pos: number;
  end: number;
}

interface RawGeobufGeometry {
  type: number;
  lengths: Int32Array;
  lengthsLen: number;
  coords: Float64Array;
  coordsLen: number;
  subGeoms: RawGeobufGeometry[];
}

function growBuffer<T extends Float64Array | Int32Array | Uint32Array>(
  buf: T,
  Ctor: new (len: number) => T
): T {
  const next = new Ctor(buf.length * 2);
  next.set(buf);
  return next;
}

class GeobufScratch {
  coords = new Float64Array(4096);
  coordsLen = 0;
  lengths = new Int32Array(256);
  lengthsLen = 0;
  propPairs = new Uint32Array(64);
  propPairsLen = 0;
  values: (string | null)[] = [];
  ringPtCounts: number[] = [];

  resetFeature(): void {
    this.propPairsLen = 0;
    this.values.length = 0;
  }

  resetGeom(): void {
    this.coordsLen = 0;
    this.lengthsLen = 0;
  }

  pushCoord(v: number): void {
    if (this.coordsLen >= this.coords.length) {
      this.coords = growBuffer(this.coords, Float64Array);
    }
    this.coords[this.coordsLen++] = v;
  }

  pushLength(v: number): void {
    if (this.lengthsLen >= this.lengths.length) {
      this.lengths = growBuffer(this.lengths, Int32Array);
    }
    this.lengths[this.lengthsLen++] = v;
  }

  pushPropPair(v: number): void {
    if (this.propPairsLen >= this.propPairs.length) {
      this.propPairs = growBuffer(this.propPairs, Uint32Array);
    }
    this.propPairs[this.propPairsLen++] = v;
  }
}

const ANTIMERIDIAN_LAYERS: ReadonlySet<string> = new Set(['land', 'lakes']);

function assertRange(r: PbReader, needed: number): void {
  if (needed < 0 || r.pos + needed > r.end) {
    throw new Error('GEOBUF_DECODE_ERROR: out of bounds');
  }
}

function readVarintBig(r: PbReader): bigint {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    assertRange(r, 1);
    const b = r.bytes[r.pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return result;
    }
    shift += 7n;
  }
  throw new Error('GEOBUF_DECODE_ERROR: varint overflow');
}

function readVarintNum(r: PbReader): number {
  assertRange(r, 1);
  const b0 = r.bytes[r.pos];
  if (b0 < 0x80) {
    r.pos++;
    return b0;
  }
  let result = b0 & 0x7f;
  r.pos++;
  let factor = 128;
  for (let i = 1; i < 10; i++) {
    assertRange(r, 1);
    const b = r.bytes[r.pos++];
    result += (b & 0x7f) * factor;
    if (b < 0x80) {
      if (result > Number.MAX_SAFE_INTEGER) {
        throw new Error('GEOBUF_DECODE_ERROR: unsafe int');
      }
      return result;
    }
    factor *= 128;
  }
  throw new Error('GEOBUF_DECODE_ERROR: varint overflow');
}

function readZigZagNum(r: PbReader): number {
  assertRange(r, 1);
  const b0 = r.bytes[r.pos];
  if (b0 < 0x80) {
    r.pos++;
    return (b0 >>> 1) ^ -(b0 & 1);
  }
  // Fast 32-bit path for 2..4 byte varints (up to 28-bit unsigned ZigZag)
  if (r.pos + 3 < r.end || r.bytes[r.pos + 1] < 0x80) {
    const startPos = r.pos;
    let u = b0 & 0x7f;
    r.pos++;
    let shift = 7;
    for (let i = 1; i < 4; i++) {
      if (r.pos >= r.end) break;
      const b = r.bytes[r.pos++];
      u |= (b & 0x7f) << shift;
      if (b < 0x80) {
        return (u >>> 1) ^ -(u & 1);
      }
      shift += 7;
    }
    r.pos = startPos;
  }
  const u = readVarintBig(r);
  const signed = (u >> 1n) ^ -(u & 1n);
  return Number(signed);
}

function readString(r: PbReader): string {
  const len = readVarintNum(r);
  assertRange(r, len);
  const str = textDecoder.decode(r.bytes.subarray(r.pos, r.pos + len));
  r.pos += len;
  return str;
}

function readSubReader(r: PbReader): PbReader {
  const len = readVarintNum(r);
  assertRange(r, len);
  const sub: PbReader = { bytes: r.bytes, pos: r.pos, end: r.pos + len };
  r.pos += len;
  return sub;
}

function skipVarint(r: PbReader): void {
  for (let i = 0; i < 10; i++) {
    assertRange(r, 1);
    if ((r.bytes[r.pos++] & 0x80) === 0) return;
  }
  throw new Error('GEOBUF_DECODE_ERROR: varint overflow');
}

function skipField(r: PbReader, wireType: number): void {
  switch (wireType) {
    case 0:
      skipVarint(r);
      return;
    case 1:
      assertRange(r, 8);
      r.pos += 8;
      return;
    case 2: {
      const len = readVarintNum(r);
      assertRange(r, len);
      r.pos += len;
      return;
    }
    case 5:
      assertRange(r, 4);
      r.pos += 4;
      return;
    default:
      throw new Error(`GEOBUF_DECODE_ERROR: wire ${wireType}`);
  }
}

function withLengthPrefixedSubReader(
  r: PbReader,
  fn: (sub: PbReader) => void
): void {
  const len = readVarintNum(r);
  assertRange(r, len);
  const subEnd = r.pos + len;
  const savedEnd = r.end;
  r.end = subEnd;
  while (r.pos < subEnd) {
    fn(r);
  }
  r.end = savedEnd;
}

function readPackedLengths(r: PbReader, sc: GeobufScratch): void {
  withLengthPrefixedSubReader(r, (sub) => sc.pushLength(readVarintNum(sub)));
}

function readPackedPropPairs(r: PbReader, sc: GeobufScratch): void {
  withLengthPrefixedSubReader(r, (sub) => sc.pushPropPair(readVarintNum(sub)));
}

function readPackedCoords(r: PbReader, sc: GeobufScratch): void {
  withLengthPrefixedSubReader(r, (sub) => sc.pushCoord(readZigZagNum(sub)));
}

function readValueString(r: PbReader): string | null {
  const len = readVarintNum(r);
  assertRange(r, len);
  const subEnd = r.pos + len;
  const savedEnd = r.end;
  r.end = subEnd;
  let strVal: string | null = null;
  while (r.pos < subEnd) {
    const tag = readVarintNum(r);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      strVal = readString(r);
    } else {
      skipField(r, wire);
    }
  }
  r.end = savedEnd;
  return strVal;
}

function parseGeometryScratch(
  r: PbReader,
  sc: GeobufScratch
): RawGeobufGeometry {
  sc.resetGeom();
  let type: number = GeomType.Point;
  const subGeoms: RawGeobufGeometry[] = [];
  while (r.pos < r.end) {
    const tag = readVarintNum(r);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 0) {
      type = readVarintNum(r);
    } else if (field === 2 && wire === 2) {
      readPackedLengths(r, sc);
    } else if (field === 2 && wire === 0) {
      sc.pushLength(readVarintNum(r));
    } else if (field === 3 && wire === 2) {
      readPackedCoords(r, sc);
    } else if (field === 3 && wire === 0) {
      sc.pushCoord(readZigZagNum(r));
    } else if (field === 4 && wire === 2) {
      // GeometryCollection: parse sub-geometry with its own copied buffers
      const subSc = new GeobufScratch();
      subGeoms.push(parseGeometryScratch(readSubReader(r), subSc));
    } else {
      skipField(r, wire);
    }
  }
  return {
    type,
    lengths: sc.lengths,
    lengthsLen: sc.lengthsLen,
    coords: sc.coords,
    coordsLen: sc.coordsLen,
    subGeoms,
  };
}

function resolveLayerName(
  keys: string[],
  values: (string | null)[],
  propPairs: Uint32Array,
  propPairsLen: number,
  defaultLayerName: string
): string {
  for (let i = 0; i + 1 < propPairsLen; i += 2) {
    const key = keys[propPairs[i]];
    if (key === 'layer') {
      const val = values[propPairs[i + 1]];
      if (val && val.length > 0) return val;
    }
  }
  return defaultLayerName;
}

function pushPreparedFeatures(
  layerName: string,
  features: readonly PreparedFeature[],
  fillMap: Map<string, PreparedFeature[]>,
  strokeMap: Map<string, PreparedFeature[]>,
  antimeridianLayers: ReadonlySet<string>
): void {
  if (features.length === 0) return;
  let fillList = fillMap.get(layerName);
  if (!fillList) {
    fillList = [];
    fillMap.set(layerName, fillList);
  }
  let strokeList = strokeMap.get(layerName);
  if (!strokeList) {
    strokeList = [];
    strokeMap.set(layerName, strokeList);
  }
  const needsCleanSeam = antimeridianLayers.has(layerName);
  for (let i = 0; i < features.length; i++) {
    const pf = features[i];
    fillList.push(pf);
    if (needsCleanSeam && pf.isPolygon) {
      const cleaned = splitAntimeridianFeature(pf);
      if (cleaned) strokeList.push(cleaned);
    } else {
      strokeList.push(pf);
    }
  }
}

function appendFeature(
  r: PbReader,
  keys: string[],
  defaultLayerName: string,
  dimensions: number,
  invScale: number,
  sc: GeobufScratch,
  fillMap: Map<string, PreparedFeature[]>,
  strokeMap: Map<string, PreparedFeature[]>,
  antimeridianLayers: ReadonlySet<string>,
  allowedLayers?: ReadonlySet<string>
): void {
  sc.resetFeature();
  const geomSpans: PbReader[] = [];

  while (r.pos < r.end) {
    const tag = readVarintNum(r);
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      geomSpans.push(readSubReader(r));
    } else if (field === 13 && wire === 2) {
      sc.values.push(readValueString(r));
    } else if (field === 14 && wire === 2) {
      readPackedPropPairs(r, sc);
    } else if (field === 14 && wire === 0) {
      sc.pushPropPair(readVarintNum(r));
    } else {
      skipField(r, wire);
    }
  }

  const layerName = resolveLayerName(
    keys,
    sc.values,
    sc.propPairs,
    sc.propPairsLen,
    defaultLayerName
  );
  if (allowedLayers !== undefined && !allowedLayers.has(layerName)) {
    return;
  }

  for (let g = 0; g < geomSpans.length; g++) {
    const geom = parseGeometryScratch(geomSpans[g], sc);
    const tempOut: PreparedFeature[] = [];
    prepareGeometry(geom, dimensions, invScale, tempOut, sc);
    pushPreparedFeatures(
      layerName,
      tempOut,
      fillMap,
      strokeMap,
      antimeridianLayers
    );
  }
}

function pushLengthsOrTotal(
  geom: RawGeobufGeometry,
  totalPoints: number,
  outCounts: number[]
): void {
  if (geom.lengthsLen === 0) {
    outCounts.push(totalPoints);
    return;
  }
  for (let i = 0; i < geom.lengthsLen; i++) {
    outCounts.push(geom.lengths[i]);
  }
}

function extractRingCounts(
  geom: RawGeobufGeometry,
  totalPoints: number,
  outCounts: number[]
): boolean {
  outCounts.length = 0;
  switch (geom.type) {
    case GeomType.LineString:
      outCounts.push(totalPoints);
      return false;
    case GeomType.MultiLineString:
      pushLengthsOrTotal(geom, totalPoints, outCounts);
      return false;
    case GeomType.Polygon:
      pushLengthsOrTotal(geom, totalPoints, outCounts);
      return true;
    case GeomType.MultiPolygon: {
      if (geom.lengthsLen === 0) {
        outCounts.push(totalPoints);
        return true;
      }
      let idx = 0;
      const numPolys = geom.lengths[idx++] ?? 0;
      for (let p = 0; p < numPolys && idx < geom.lengthsLen; p++) {
        const numRings = geom.lengths[idx++] ?? 0;
        for (let r = 0; r < numRings && idx < geom.lengthsLen; r++) {
          outCounts.push(geom.lengths[idx++]);
        }
      }
      return true;
    }
    default:
      return false;
  }
}

function prepareGeometry(
  geom: RawGeobufGeometry,
  dimensions: number,
  invScale: number,
  outFeatures: PreparedFeature[],
  sc: GeobufScratch
): void {
  if (geom.type === GeomType.GeometryCollection) {
    for (const sub of geom.subGeoms) {
      prepareGeometry(sub, dimensions, invScale, outFeatures, sc);
    }
    return;
  }

  const totalPoints = (geom.coordsLen / dimensions) | 0;
  const isPolygon = extractRingCounts(geom, totalPoints, sc.ringPtCounts);
  const ringPtCounts = sc.ringPtCounts;
  if (ringPtCounts.length === 0 || totalPoints === 0) return;

  const extraFloats = isPolygon ? ringPtCounts.length * 2 : 0;
  const packedXY = new Float32Array(totalPoints * 2 + extraFloats);
  const ringLengths = new Int32Array(ringPtCounts.length);

  let coordCursor = 0;
  let outCursor = 0;

  const rt = getWasmRuntime();
  if (rt === null) {
    throw new Error('WASM_MEMORY_ERROR');
  }

  let maxRingPts = 0;
  let totalValidPts = 0;
  for (let r = 0; r < ringPtCounts.length; r++) {
    const c = ringPtCounts[r];
    if (c > maxRingPts) maxRingPts = c;
    if (c > 0) totalValidPts += c;
  }
  if (maxRingPts === 0) return;

  const totalInputFloats = Math.min(geom.coordsLen, totalValidPts * dimensions);
  const base = rt.getScratchBase();
  const accOff = (base + 7) & ~7;
  const boundsOff = accOff + 16;
  const inOff = boundsOff + 16;
  const outOff = inOff + totalInputFloats * 8;
  if (!rt.ensureCapacity(outOff + maxRingPts * 8)) {
    throw new Error('WASM_MEMORY_ERROR');
  }

  rt.f64[accOff >> 3] = 0;
  rt.f64[(accOff >> 3) + 1] = 0;
  rt.f32[boundsOff >> 2] = 1e9;
  rt.f32[(boundsOff >> 2) + 1] = 1e9;
  rt.f32[(boundsOff >> 2) + 2] = -1e9;
  rt.f32[(boundsOff >> 2) + 3] = -1e9;
  const inF64Base = inOff >> 3;
  const outF32Base = outOff >> 2;

  // Stage all coordinates for this feature into WASM linear memory once
  rt.f64.set(
    totalInputFloats === geom.coords.length
      ? geom.coords
      : geom.coords.subarray(0, totalInputFloats),
    inF64Base
  );

  for (let r = 0; r < ringPtCounts.length; r++) {
    const ptCount = ringPtCounts[r];
    if (ptCount <= 0) continue;
    const ringStart = outCursor;
    const availPts = Math.min(
      ptCount,
      ((geom.coordsLen - coordCursor) / dimensions) | 0
    );
    if (availPts <= 0) continue;

    const inFloats = availPts * dimensions;
    const written = rt.exports.decodeGeobufRingMercator(
      availPts,
      dimensions,
      LUT_OFFSET_BYTES,
      inOff + coordCursor * 8,
      outOff,
      boundsOff,
      invScale,
      accOff
    );
    packedXY.set(rt.f32.subarray(outF32Base, outF32Base + written), outCursor);
    coordCursor += inFloats;
    outCursor += written;
    if (isPolygon) {
      packedXY[outCursor++] = packedXY[ringStart];
      packedXY[outCursor++] = packedXY[ringStart + 1];
    }
    ringLengths[r] = outCursor - ringStart;
  }

  outFeatures.push({
    packedXY:
      outCursor === packedXY.length
        ? packedXY
        : packedXY.subarray(0, outCursor),
    ringLengths,
    ringCount: ringLengths.length,
    isPolygon,
    minLon: rt.f32[boundsOff >> 2],
    minLat: rt.f32[(boundsOff >> 2) + 1],
    maxLon: rt.f32[(boundsOff >> 2) + 2],
    maxLat: rt.f32[(boundsOff >> 2) + 3],
  });
}

interface GeobufHeader {
  keys: string[];
  dimensions: number;
  precision: number;
  fcReader: PbReader | null;
  singleFeatureReader: PbReader | null;
  singleGeomReader: PbReader | null;
}

function parseGeobufHeader(r: PbReader): GeobufHeader {
  const keys: string[] = [];
  let dimensions = 2;
  let precision = 6;
  let fcReader: PbReader | null = null;
  let singleFeatureReader: PbReader | null = null;
  let singleGeomReader: PbReader | null = null;

  while (r.pos < r.end) {
    const tag = readVarintNum(r);
    const field = tag >>> 3;
    const wire = tag & 7;

    if (field === 1 && wire === 2) {
      keys.push(readString(r));
    } else if (field === 2 && wire === 0) {
      dimensions = readVarintNum(r);
    } else if (field === 3 && wire === 0) {
      precision = readVarintNum(r);
    } else if (field === 4 && wire === 2) {
      fcReader = readSubReader(r);
    } else if (field === 5 && wire === 2) {
      singleFeatureReader = readSubReader(r);
    } else if (field === 6 && wire === 2) {
      singleGeomReader = readSubReader(r);
    } else {
      skipField(r, wire);
    }
  }

  if (dimensions < 2 || dimensions > 4) {
    throw new MapError('GEOBUF_DECODE_ERROR', 'dimensions');
  }
  if (precision > 12) {
    throw new MapError('GEOBUF_DECODE_ERROR', 'precision');
  }

  return {
    keys,
    dimensions,
    precision,
    fcReader,
    singleFeatureReader,
    singleGeomReader,
  };
}

export interface ParsedGeobuf {
  fillLayers: PreparedLayer[];
  strokeLayers: PreparedLayer[];
}

export interface LoadGeobufOptions {
  signal?: AbortSignal;
  defaultLayerName?: string;
  allowedLayers?: ReadonlySet<string>;
  antimeridianLayers?: ReadonlySet<string>;
  maxBytes?: number;
}

const DEFAULT_MAX_GEOBUF_BYTES = 64 * 1024 * 1024;

/**
 * Parses a Mapbox Geobuf (.geobuf / .pbf) binary buffer into normalized
 * Web Mercator PreparedLayer arrays compatible with map543-2d renderers.
 */
export function parseGeobuf(
  rawBuffer: ArrayBuffer,
  defaultLayerName = 'land',
  allowedLayers?: ReadonlySet<string>,
  antimeridianLayers: ReadonlySet<string> = ANTIMERIDIAN_LAYERS
): ParsedGeobuf {
  const scratch = new GeobufScratch();
  const bytes = new Uint8Array(rawBuffer);
  if (bytes.length === 0) {
    throw new MapError('GEOBUF_DECODE_ERROR', 'empty');
  }
  if (bytes.length > DEFAULT_MAX_GEOBUF_BYTES) {
    throw new MapError(
      'RESOURCE_LIMIT_EXCEEDED',
      `Geobuf exceeds max size (${DEFAULT_MAX_GEOBUF_BYTES} bytes)`
    );
  }

  const {
    keys,
    dimensions,
    precision,
    fcReader,
    singleFeatureReader,
    singleGeomReader,
  } = parseGeobufHeader({ bytes, pos: 0, end: bytes.length });

  const invScale = Math.pow(10, -precision);
  const fillMap = new Map<string, PreparedFeature[]>();
  const strokeMap = new Map<string, PreparedFeature[]>();

  if (fcReader) {
    while (fcReader.pos < fcReader.end) {
      const tag = readVarintNum(fcReader);
      const field = tag >>> 3;
      const wire = tag & 7;
      if (field === 1 && wire === 2) {
        appendFeature(
          readSubReader(fcReader),
          keys,
          defaultLayerName,
          dimensions,
          invScale,
          scratch,
          fillMap,
          strokeMap,
          antimeridianLayers,
          allowedLayers
        );
      } else {
        skipField(fcReader, wire);
      }
    }
  } else if (singleFeatureReader) {
    appendFeature(
      singleFeatureReader,
      keys,
      defaultLayerName,
      dimensions,
      invScale,
      scratch,
      fillMap,
      strokeMap,
      antimeridianLayers,
      allowedLayers
    );
  } else if (singleGeomReader) {
    const geom = parseGeometryScratch(singleGeomReader, scratch);
    const prepared: PreparedFeature[] = [];
    prepareGeometry(geom, dimensions, invScale, prepared, scratch);
    pushPreparedFeatures(
      defaultLayerName,
      prepared,
      fillMap,
      strokeMap,
      antimeridianLayers
    );
  }

  const fillLayers: PreparedLayer[] = [];
  for (const [name, features] of fillMap) {
    fillLayers.push({ name, features });
  }
  const strokeLayers: PreparedLayer[] = [];
  for (const [name, features] of strokeMap) {
    strokeLayers.push({ name, features });
  }

  return { fillLayers, strokeLayers };
}

/**
 * Fetches and parses a Mapbox Geobuf (.geobuf / .pbf) file with quota and AbortSignal support.
 */
export async function loadGeobuf(
  url: string,
  options: LoadGeobufOptions = {}
): Promise<ParsedGeobuf> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_GEOBUF_BYTES;
  const res = await fetch(
    url,
    options.signal ? { signal: options.signal } : undefined
  );
  if (!res.ok) {
    throw new MapError(
      'GEOBUF_DECODE_ERROR',
      `Failed to fetch Geobuf (${res.status})`
    );
  }
  const contentLength = res.headers?.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new MapError(
        'RESOURCE_LIMIT_EXCEEDED',
        `Geobuf exceeds max size (${maxBytes} bytes)`
      );
    }
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    throw new MapError(
      'RESOURCE_LIMIT_EXCEEDED',
      `Geobuf exceeds max size (${maxBytes} bytes)`
    );
  }
  return parseGeobuf(
    buf,
    options.defaultLayerName,
    options.allowedLayers,
    options.antimeridianLayers
  );
}

/**
 * Normalizes an ArrayBuffer, Uint8Array, or pre-parsed Geobuf object into ParsedGeobuf.
 */
export function parseGeobufInput(
  data: ArrayBuffer | Uint8Array | ParsedGeobuf
): ParsedGeobuf {
  if (data instanceof ArrayBuffer) return parseGeobuf(data);
  if (data instanceof Uint8Array) {
    const slice = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    return parseGeobuf(slice as ArrayBuffer);
  }
  return data;
}

import { cleanMercatorSeamFeature, projectLonLatInPlace } from './geomUtils';

export interface PreparedFeature {
  packedXY: Float32Array;
  ringLengths: Int32Array;
  ringCount: number;
  isPolygon: boolean;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface PreparedLayer {
  name: string;
  features: PreparedFeature[];
}

const FGB_V3_PREFIX = [0x66, 0x67, 0x62, 0x03, 0x66, 0x67, 0x62];

const textDecoder = new TextDecoder('utf-8');

export type CleanSeamRingFn = (
  input: Float32Array,
  inputLen: number,
  output: Float32Array,
  segLens: Int32Array,
  bbox: Float32Array
) => number;

interface ColumnMeta {
  name: string;
  type: number;
}

interface ParsedHeader {
  geometryType: number;
  featuresCount: number;
  indexNodeSize: number;
  columns: ColumnMeta[];
}

function matchesMagic(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function assertBounds(view: DataView, offset: number, size: number): void {
  if (offset < 0 || size < 0 || offset + size > view.byteLength) {
    throw new Error(
      `FlatGeobuf binary out of bounds: offset=${offset}, size=${size}, total=${view.byteLength}`
    );
  }
}

function readSlotOffset(
  view: DataView,
  tablePos: number,
  slot: number
): number {
  assertBounds(view, tablePos, 4);
  const vtableRel = view.getInt32(tablePos, true);
  const vtablePos = tablePos - vtableRel;
  assertBounds(view, vtablePos, 4);
  const vtableSize = view.getUint16(vtablePos, true);
  const slotBytePos = vtablePos + 4 + slot * 2;
  if (slotBytePos + 2 > vtablePos + vtableSize) return 0;
  assertBounds(view, slotBytePos, 2);
  const fieldRel = view.getUint16(slotBytePos, true);
  return fieldRel === 0 ? 0 : tablePos + fieldRel;
}

function readIndirectTable(view: DataView, fieldPos: number): number {
  assertBounds(view, fieldPos, 4);
  return fieldPos + view.getUint32(fieldPos, true);
}

function readFBString(view: DataView, bytes: Uint8Array, fieldPos: number): string {
  const strPos = readIndirectTable(view, fieldPos);
  assertBounds(view, strPos, 4);
  const len = view.getUint32(strPos, true);
  assertBounds(view, strPos + 4, len);
  return textDecoder.decode(bytes.subarray(strPos + 4, strPos + 4 + len));
}

function readColumns(
  view: DataView,
  bytes: Uint8Array,
  headerTablePos: number
): ColumnMeta[] {
  const fieldPos = readSlotOffset(view, headerTablePos, 7);
  if (fieldPos === 0) return [];
  const vecPos = readIndirectTable(view, fieldPos);
  assertBounds(view, vecPos, 4);
  const count = view.getUint32(vecPos, true);
  const cols: ColumnMeta[] = [];

  for (let i = 0; i < count; i++) {
    const elemPos = vecPos + 4 + i * 4;
    const colTable = readIndirectTable(view, elemPos);
    const namePos = readSlotOffset(view, colTable, 0);
    const typePos = readSlotOffset(view, colTable, 1);
    const name = namePos !== 0 ? readFBString(view, bytes, namePos) : '';
    const colType = typePos !== 0 ? view.getUint8(typePos) : 0;
    cols.push({ name, type: colType });
  }
  return cols;
}

function parseHeader(
  view: DataView,
  bytes: Uint8Array,
  offset: number
): { header: ParsedHeader; nextOffset: number } {
  assertBounds(view, offset, 8);
  const bodySize = view.getUint32(offset, true);
  const bodyStart = offset + 4;
  assertBounds(view, bodyStart, bodySize);

  const rootTable = bodyStart + view.getUint32(bodyStart, true);

  const geomTypePos = readSlotOffset(view, rootTable, 2);
  const geometryType = geomTypePos !== 0 ? view.getUint8(geomTypePos) : 0;

  const featuresCountPos = readSlotOffset(view, rootTable, 8);
  let featuresCount = 0;
  if (featuresCountPos !== 0) {
    assertBounds(view, featuresCountPos, 8);
    featuresCount = Number(view.getBigUint64(featuresCountPos, true));
  }

  const nodeSizePos = readSlotOffset(view, rootTable, 9);
  const indexNodeSize =
    nodeSizePos !== 0 ? view.getUint16(nodeSizePos, true) : 0;

  const columns = readColumns(view, bytes, rootTable);

  return {
    header: { geometryType, featuresCount, indexNodeSize, columns },
    nextOffset: bodyStart + bodySize,
  };
}

function calcRTreeBytes(featuresCount: number, nodeSize: number): number {
  if (featuresCount <= 0 || nodeSize < 2) return 0;
  let count = featuresCount;
  let totalNodes = count;
  while (count > 1) {
    count = Math.ceil(count / nodeSize);
    totalNodes += count;
  }
  return totalNodes * 40;
}

interface LayerNameCacheEntry {
  bytes: Uint8Array;
  name: string;
}

function decodeCachedLayerName(
  bytes: Uint8Array,
  start: number,
  len: number,
  cache: LayerNameCacheEntry[]
): string {
  for (let i = 0; i < cache.length; i++) {
    const entry = cache[i];
    if (entry.bytes.length !== len) continue;
    let match = true;
    for (let j = 0; j < len; j++) {
      if (entry.bytes[j] !== bytes[start + j]) {
        match = false;
        break;
      }
    }
    if (match) return entry.name;
  }
  const slice = bytes.subarray(start, start + len);
  const name = textDecoder.decode(slice);
  if (cache.length < 32) {
    cache.push({ bytes: slice.slice(), name });
  }
  return name;
}

function extractLayerName(
  view: DataView,
  bytes: Uint8Array,
  propsPos: number,
  columns: ColumnMeta[],
  layerColIdx: number,
  defaultLayerName: string,
  nameCache: LayerNameCacheEntry[]
): string {
  if (propsPos === 0 || layerColIdx < 0) return defaultLayerName;
  const vecPos = readIndirectTable(view, propsPos);
  assertBounds(view, vecPos, 4);
  const byteLen = view.getUint32(vecPos, true);
  let cursor = vecPos + 4;
  const end = cursor + byteLen;
  assertBounds(view, cursor, byteLen);

  while (cursor + 2 <= end) {
    const colIdx = view.getUint16(cursor, true);
    cursor += 2;
    const col = columns[colIdx];
    if (!col) break;

    switch (col.type) {
      case 0: // Byte
      case 1: // UByte
      case 2: // Bool
        cursor += 1;
        break;
      case 3: // Short
      case 4: // UShort
        cursor += 2;
        break;
      case 5: // Int
      case 6: // UInt
        cursor += 4;
        break;
      case 7: // Long
      case 8: // ULong
        cursor += 8;
        break;
      case 9: // Float
        cursor += 4;
        break;
      case 10: // Double
        cursor += 8;
        break;
      case 11: // String
      case 12: // Json
      case 13: // DateTime
      case 14: { // Binary
        if (cursor + 4 > end) return defaultLayerName;
        const strLen = view.getUint32(cursor, true);
        cursor += 4;
        if (cursor + strLen > end) return defaultLayerName;
        if (colIdx === layerColIdx && col.type === 11) {
          return decodeCachedLayerName(bytes, cursor, strLen, nameCache);
        }
        cursor += strLen;
        break;
      }
      default:
        return defaultLayerName;
    }
  }
  return defaultLayerName;
}

interface ParsedGeom {
  packedXY: Float32Array;
  ringLengths: Int32Array;
  ringCount: number;
  isPolygon: boolean;
  bounds: [number, number, number, number];
}

interface GeomMeasure {
  totalFloats: number;
  totalRings: number;
}

function measureGeometryTable(
  view: DataView,
  geomTablePos: number,
  out: GeomMeasure
): void {
  const partsPos = readSlotOffset(view, geomTablePos, 7);
  if (partsPos !== 0) {
    const partsVec = readIndirectTable(view, partsPos);
    assertBounds(view, partsVec, 4);
    const partCount = view.getUint32(partsVec, true);
    for (let i = 0; i < partCount; i++) {
      const partTable = readIndirectTable(view, partsVec + 4 + i * 4);
      measureGeometryTable(view, partTable, out);
    }
    return;
  }

  const xyPos = readSlotOffset(view, geomTablePos, 1);
  if (xyPos === 0) return;
  const xyVec = readIndirectTable(view, xyPos);
  assertBounds(view, xyVec, 4);
  const xyCount = view.getUint32(xyVec, true);
  assertBounds(view, xyVec + 4, xyCount * 8);
  if (xyCount < 2) return;

  out.totalFloats += xyCount;
  const endsPos = readSlotOffset(view, geomTablePos, 0);
  if (endsPos !== 0) {
    const endsVec = readIndirectTable(view, endsPos);
    assertBounds(view, endsVec, 4);
    out.totalRings += view.getUint32(endsVec, true);
  } else {
    out.totalRings += 1;
  }
}

interface GeomWriteState {
  xyCursor: number;
  ringCursor: number;
}

function writeGeometryTable(
  view: DataView,
  geomTablePos: number,
  outXY: Float32Array,
  outLens: Int32Array,
  bounds: [number, number, number, number],
  ws: GeomWriteState
): void {
  const partsPos = readSlotOffset(view, geomTablePos, 7);
  if (partsPos !== 0) {
    const partsVec = readIndirectTable(view, partsPos);
    assertBounds(view, partsVec, 4);
    const partCount = view.getUint32(partsVec, true);
    for (let i = 0; i < partCount; i++) {
      const partTable = readIndirectTable(view, partsVec + 4 + i * 4);
      writeGeometryTable(view, partTable, outXY, outLens, bounds, ws);
    }
    return;
  }

  const xyPos = readSlotOffset(view, geomTablePos, 1);
  if (xyPos === 0) return;
  const xyVec = readIndirectTable(view, xyPos);
  assertBounds(view, xyVec, 4);
  const xyCount = view.getUint32(xyVec, true);
  const xyDataStart = xyVec + 4;
  assertBounds(view, xyDataStart, xyCount * 8);
  if (xyCount < 2) return;

  const endsPos = readSlotOffset(view, geomTablePos, 0);
  if (endsPos !== 0) {
    const endsVec = readIndirectTable(view, endsPos);
    assertBounds(view, endsVec, 4);
    const endsCount = view.getUint32(endsVec, true);
    assertBounds(view, endsVec + 4, endsCount * 4);
    let prev = 0;
    for (let i = 0; i < endsCount; i++) {
      const endFloatIdx = view.getUint32(endsVec + 4 + i * 4, true) * 2;
      outLens[ws.ringCursor++] = endFloatIdx - prev;
      prev = endFloatIdx;
    }
  } else {
    outLens[ws.ringCursor++] = xyCount;
  }

  for (let i = 0; i < xyCount; i += 2) {
    const lon = view.getFloat64(xyDataStart + i * 8, true);
    const lat = view.getFloat64(xyDataStart + (i + 1) * 8, true);
    projectLonLatInPlace(lon, lat, outXY, ws.xyCursor + i, bounds);
  }
  ws.xyCursor += xyCount;
}

function readGeometryTable(
  view: DataView,
  geomTablePos: number,
  defaultGeomType: number
): ParsedGeom | null {
  const typePos = readSlotOffset(view, geomTablePos, 6);
  const geomType = typePos !== 0 ? view.getUint8(typePos) : defaultGeomType;
  const isPolygon = geomType === 3 || geomType === 6;

  // Handle MultiPolygon / MultiLineString parts in two passes (single Float32Array + Int32Array)
  const partsPos = readSlotOffset(view, geomTablePos, 7);
  if (partsPos !== 0) {
    const measure: GeomMeasure = { totalFloats: 0, totalRings: 0 };
    measureGeometryTable(view, geomTablePos, measure);
    if (measure.totalRings === 0 || measure.totalFloats === 0) return null;

    const packedXY = new Float32Array(measure.totalFloats);
    const ringLengths = new Int32Array(measure.totalRings);
    const bounds: [number, number, number, number] = [
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
    ];
    const ws: GeomWriteState = { xyCursor: 0, ringCursor: 0 };
    writeGeometryTable(view, geomTablePos, packedXY, ringLengths, bounds, ws);

    return {
      packedXY,
      ringLengths,
      ringCount: measure.totalRings,
      isPolygon,
      bounds,
    };
  }

  const xyPos = readSlotOffset(view, geomTablePos, 1);
  if (xyPos === 0) return null;
  const xyVec = readIndirectTable(view, xyPos);
  assertBounds(view, xyVec, 4);
  const xyVecLen = view.getUint32(xyVec, true);
  const xyDataStart = xyVec + 4;

  const xyCount = xyVecLen;
  assertBounds(view, xyDataStart, xyCount * 8);
  if (xyCount < 2) return null;

  const endsPos = readSlotOffset(view, geomTablePos, 0);
  let ringLengths: Int32Array;
  if (endsPos !== 0) {
    const endsVec = readIndirectTable(view, endsPos);
    assertBounds(view, endsVec, 4);
    const endsCount = view.getUint32(endsVec, true);
    assertBounds(view, endsVec + 4, endsCount * 4);
    ringLengths = new Int32Array(endsCount);
    let prev = 0;
    for (let i = 0; i < endsCount; i++) {
      const endCoordIdx = view.getUint32(endsVec + 4 + i * 4, true);
      const endFloatIdx = endCoordIdx * 2;
      ringLengths[i] = endFloatIdx - prev;
      prev = endFloatIdx;
    }
  } else {
    ringLengths = new Int32Array([xyCount]);
  }

  const packedXY = new Float32Array(xyCount);
  const bounds: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ];

  for (let i = 0; i < xyCount; i += 2) {
    const lon = view.getFloat64(xyDataStart + i * 8, true);
    const lat = view.getFloat64(xyDataStart + (i + 1) * 8, true);
    projectLonLatInPlace(lon, lat, packedXY, i, bounds);
  }

  return {
    packedXY,
    ringLengths,
    ringCount: ringLengths.length,
    isPolygon,
    bounds,
  };
}

const DEFAULT_SEAM_CLEAN_LAYERS: ReadonlySet<string> = new Set([
  'land',
  'lakes',
]);

export function parseFgbToPreparedLayers(
  rawBuffer: ArrayBuffer,
  _cleanSeamRing?: CleanSeamRingFn,
  defaultLayerName = 'land',
  seamCleanLayers: ReadonlySet<string> = DEFAULT_SEAM_CLEAN_LAYERS,
  layerProperty = 'layer'
): { fillLayers: PreparedLayer[]; strokeLayers: PreparedLayer[] } {
  const bytes = new Uint8Array(rawBuffer);
  if (!matchesMagic(bytes, FGB_V3_PREFIX)) {
    throw new Error('Unsupported map format: expected FlatGeobuf v3 (.fgb)');
  }

  const view = new DataView(rawBuffer);
  const { header, nextOffset } = parseHeader(view, bytes, 8);
  const layerColIdx = header.columns.findIndex((c) => c.name === layerProperty);

  let cursor =
    nextOffset + calcRTreeBytes(header.featuresCount, header.indexNodeSize);

  const fillMap = new Map<string, PreparedFeature[]>();
  const strokeMap = new Map<string, PreparedFeature[]>();
  const nameCache: LayerNameCacheEntry[] = [];

  while (cursor + 8 <= view.byteLength) {
    const featBodySize = view.getUint32(cursor, true);
    const featBodyStart = cursor + 4;
    if (featBodySize === 0 || featBodyStart + featBodySize > view.byteLength) {
      break;
    }
    const featRoot = featBodyStart + view.getUint32(featBodyStart, true);

    const propsPos = readSlotOffset(view, featRoot, 1);
    const layerName = extractLayerName(
      view,
      bytes,
      propsPos,
      header.columns,
      layerColIdx,
      defaultLayerName,
      nameCache
    );

    const geomPos = readSlotOffset(view, featRoot, 0);
    if (geomPos !== 0) {
      const geomTable = readIndirectTable(view, geomPos);
      const needsCleanSeam = seamCleanLayers.has(layerName);
      const parsed = readGeometryTable(view, geomTable, header.geometryType);

      if (parsed) {
        const fillFeature: PreparedFeature = {
          packedXY: parsed.packedXY,
          ringLengths: parsed.ringLengths,
          ringCount: parsed.ringCount,
          isPolygon: parsed.isPolygon,
          minLon: parsed.bounds[0],
          minLat: parsed.bounds[1],
          maxLon: parsed.bounds[2],
          maxLat: parsed.bounds[3],
        };

        let fillList = fillMap.get(layerName);
        if (!fillList) {
          fillList = [];
          fillMap.set(layerName, fillList);
        }
        fillList.push(fillFeature);

        let strokeList = strokeMap.get(layerName);
        if (!strokeList) {
          strokeList = [];
          strokeMap.set(layerName, strokeList);
        }

        if (needsCleanSeam && parsed.isPolygon) {
          const cleaned = cleanMercatorSeamFeature(fillFeature);
          if (cleaned) {
            strokeList.push(cleaned);
          }
        } else {
          strokeList.push(fillFeature);
        }
      }
    }

    cursor = featBodyStart + featBodySize;
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

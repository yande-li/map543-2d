import type { PreparedFeature } from './fgb';
import { MAX_MERCATOR_LAT, projectLatToMercatorY } from '../core/projection';

const INV_360 = 0.002777777777777778;
const INV_TWO_PI = 0.15915494309189535;

const SEAM_EDGE_EPS = 0.0014; // ~0.5 deg from ±180° in [0, 1] Mercator X
const SEAM_DELTA_EPS = 0.000003; // ~0.001 deg in [0, 1] Mercator X

/**
 * Projects a WGS84 (lon, lat) coordinate into normalized Web Mercator [0, 1]^2
 * and updates the feature's geographic bounding box [minLon, minLat, maxLon, maxLat].
 */
export function projectLonLatInPlace(
  lon: number,
  rawLat: number,
  out: Float32Array,
  outIdx: number,
  bounds: [number, number, number, number]
): void {
  if (lon < bounds[0]) bounds[0] = lon;
  if (rawLat < bounds[1]) bounds[1] = rawLat;
  if (lon > bounds[2]) bounds[2] = lon;
  if (rawLat > bounds[3]) bounds[3] = rawLat;

  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, rawLat));
  out[outIdx] = (lon + 180) * INV_360;
  out[outIdx + 1] = 0.5 - projectLatToMercatorY(lat) * INV_TWO_PI;
}

/**
 * Splits polygon stroke rings that touch or wrap across the ±180° antimeridian
 * so border strokes do not draw horizontal artifacts across the map.
 */
export function cleanMercatorSeamFeature(
  feature: PreparedFeature
): PreparedFeature | null {
  const { packedXY, ringLengths, ringCount } = feature;
  if (feature.minLon > -179.5 && feature.maxLon < 179.5) {
    return feature;
  }

  const maxSegs = Math.max(ringCount, packedXY.length >> 2);
  const outXY = new Float32Array(packedXY.length);
  const outLens = new Int32Array(maxSegs);
  let outPos = 0;
  let segCount = 0;
  let cursor = 0;

  for (let r = 0; r < ringCount; r++) {
    const len = ringLengths[r];
    if (len < 4) {
      cursor += len;
      continue;
    }
    let segStart = -1;
    for (let i = 0; i + 3 < len; i += 2) {
      const x1 = packedXY[cursor + i];
      const y1 = packedXY[cursor + i + 1];
      const x2 = packedXY[cursor + i + 2];
      const dx = Math.abs(x1 - x2);
      const isSeam =
        ((x1 < SEAM_EDGE_EPS || x1 > 1 - SEAM_EDGE_EPS) &&
          dx < SEAM_DELTA_EPS) ||
        dx > 0.5;
      if (isSeam) {
        if (segStart >= 0) {
          outXY[outPos++] = x1;
          outXY[outPos++] = y1;
          outLens[segCount++] = outPos - segStart;
          segStart = -1;
        }
      } else {
        if (segStart < 0) {
          segStart = outPos;
        }
        outXY[outPos++] = x1;
        outXY[outPos++] = y1;
      }
    }
    if (segStart >= 0) {
      outXY[outPos++] = packedXY[cursor + len - 2];
      outXY[outPos++] = packedXY[cursor + len - 1];
      outLens[segCount++] = outPos - segStart;
    }
    cursor += len;
  }

  if (segCount === 0) return null;
  return {
    packedXY: outPos === outXY.length ? outXY : outXY.subarray(0, outPos),
    ringLengths: segCount === outLens.length ? outLens : outLens.subarray(0, segCount),
    ringCount: segCount,
    isPolygon: false,
    minLon: feature.minLon,
    minLat: feature.minLat,
    maxLon: feature.maxLon,
    maxLat: feature.maxLat,
  };
}

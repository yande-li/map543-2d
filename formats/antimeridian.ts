import type { PreparedFeature } from './types';

const SEAM_EDGE_EPS = 0.0014; // ~0.5 deg from ±180° in [0, 1] Mercator X
const SEAM_DELTA_EPS = 0.000003; // ~0.001 deg in [0, 1] Mercator X

/**
 * Splits polygon stroke rings that touch or wrap across the ±180° antimeridian
 * so border strokes do not draw horizontal artifacts across the map.
 */
export function splitAntimeridianFeature(
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
    ringLengths:
      segCount === outLens.length ? outLens : outLens.subarray(0, segCount),
    ringCount: segCount,
    isPolygon: false,
    minLon: feature.minLon,
    minLat: feature.minLat,
    maxLon: feature.maxLon,
    maxLat: feature.maxLat,
  };
}

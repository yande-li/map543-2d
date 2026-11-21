export type LatLng = [number, number];

export interface Point2D {
  x: number;
  y: number;
}

export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ProjectionState {
  center: LatLng;
  zoom: number;
  width: number;
  height: number;
}

export const TILE_SIZE = 256;
export const MAX_MERCATOR_LAT = 85.05112878;
export const DEG_TO_RAD = 0.017453292519943295;
export const RAD_TO_DEG = 57.29577951308232;

const INV_360 = 1 / 360;
const INV_TWO_PI = 1 / (2 * Math.PI);
const PI_4 = Math.PI / 4;
const TABLE_SIZE = 5400; // 90 deg * 60 arc-minutes
const TMP_NORM: Point2D = { x: 0, y: 0 };
const TMP_NORM_2: Point2D = { x: 0, y: 0 };

export interface BoundsExtent {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const TMP_EXTENT: BoundsExtent = { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };

/**
 * Normalizes two opposite [lat, lon] corners into min/max extents, writing into `out`.
 */
export function getBoundsExtent(
  bounds: readonly [LatLng, LatLng],
  out: BoundsExtent
): BoundsExtent {
  out.minLat = Math.min(bounds[0][0], bounds[1][0]);
  out.maxLat = Math.max(bounds[0][0], bounds[1][0]);
  out.minLon = Math.min(bounds[0][1], bounds[1][1]);
  out.maxLon = Math.max(bounds[0][1], bounds[1][1]);
  return out;
}

/**
 * Symmetric Web Mercator Y lookup table (0..90 deg at 1 arc-minute resolution).
 */
export const MERCATOR_Y_LOOKUP = new Float32Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) {
  const lat = i / 60;
  const rad = lat * DEG_TO_RAD;
  MERCATOR_Y_LOOKUP[i] = i === 0 ? 0 : Math.log(Math.tan(PI_4 + rad * 0.5));
}

/**
 * Converts latitude to Mercator Y (radians-like space) using lookup + linear interpolation.
 */
export function latToMercatorY(lat: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const idxFull = Math.min(TABLE_SIZE, Math.abs(clamped) * 60);
  const idx = idxFull | 0;
  const frac = idxFull - idx;
  const y0 = MERCATOR_Y_LOOKUP[idx] ?? 0;
  const y1 = MERCATOR_Y_LOOKUP[idx + 1] ?? y0;
  const y = y0 + frac * (y1 - y0);
  return clamped < 0 ? -y : y;
}

/**
 * Projects [lat, lon] into normalized Web Mercator [0..1, 0..1] world coordinates
 * using the precomputed lookup table.
 */
export function latLngToNorm(lat: number, lon: number): Point2D {
  const nx = (lon + 180) * INV_360;
  const ny = 0.5 - latToMercatorY(lat) * INV_TWO_PI;
  return { x: nx, y: ny };
}

/**
 * Zero-allocation variant of latLngToNorm that writes into an existing Point2D.
 */
export function latLngToNormInto(
  lat: number,
  lon: number,
  out: Point2D
): Point2D {
  out.x = (lon + 180) * INV_360;
  out.y = 0.5 - latToMercatorY(lat) * INV_TWO_PI;
  return out;
}

/**
 * Unprojects normalized Web Mercator [0..1, 0..1] coordinates back to [lat, lon].
 */
export function normToLatLng(nx: number, ny: number): LatLng {
  const lon = nx * 360 - 180;
  const expVal = Math.exp((0.5 - ny) * 2 * Math.PI);
  const lat = (2 * Math.atan(expVal) - Math.PI / 2) * RAD_TO_DEG;
  return [Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)), lon];
}

/**
 * Projects [lat, lon] to pixel coordinates in world space at a given zoom level.
 */
export function latLngToWorld(
  lat: number,
  lon: number,
  zoom: number,
  projection: Projection = MERCATOR_PROJECTION
): Point2D {
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  const norm = projection.latLngToNorm(lat, lon);
  return { x: norm.x * worldSize, y: norm.y * worldSize };
}

/**
 * Unprojects world pixel coordinates at a given zoom level back to [lat, lon].
 */
export function worldToLatLng(
  wx: number,
  wy: number,
  zoom: number,
  projection: Projection = MERCATOR_PROJECTION
): LatLng {
  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  return projection.normToLatLng(wx / worldSize, wy / worldSize);
}

/**
 * Projects [lat, lon] into container pixel coordinates relative to top-left of the viewport.
 */
export function latLngToPx(
  lat: number,
  lon: number,
  state: ProjectionState,
  projection: Projection = MERCATOR_PROJECTION
): Point2D {
  const worldSize = TILE_SIZE * Math.pow(2, state.zoom);
  const centerNorm = projection.latLngToNorm(
    state.center[0],
    state.center[1],
    TMP_NORM
  );
  const ptNorm = projection.latLngToNorm(lat, lon, TMP_NORM_2);
  return {
    x: state.width * 0.5 + (ptNorm.x - centerNorm.x) * worldSize,
    y: state.height * 0.5 + (ptNorm.y - centerNorm.y) * worldSize,
  };
}

/**
 * Unprojects container pixel coordinates back to [lat, lon].
 */
export function pxToLatLng(
  px: number,
  py: number,
  state: ProjectionState,
  projection: Projection = MERCATOR_PROJECTION
): LatLng {
  const worldSize = TILE_SIZE * Math.pow(2, state.zoom);
  const centerNorm = projection.latLngToNorm(
    state.center[0],
    state.center[1],
    TMP_NORM
  );
  const nx = centerNorm.x + (px - state.width * 0.5) / worldSize;
  const ny = centerNorm.y + (py - state.height * 0.5) / worldSize;
  return projection.normToLatLng(nx, ny);
}

/**
 * Returns the geographic bounding box currently visible in the viewport.
 */
export function getViewportBounds(
  state: ProjectionState,
  projection: Projection = MERCATOR_PROJECTION
): LatLngBounds {
  const nw = pxToLatLng(0, 0, state, projection);
  const se = pxToLatLng(state.width, state.height, state, projection);
  return {
    north: nw[0],
    west: nw[1],
    south: se[0],
    east: se[1],
  };
}

export type ProjectionType = 'mercator' | 'equirectangular';

export interface BoundsSpec {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface Projection {
  readonly id: string;
  latLngToNorm: (lat: number, lon: number, out?: Point2D) => Point2D;
  normToLatLng: (nx: number, ny: number) => LatLng;
}

export const MERCATOR_PROJECTION: Projection = {
  id: 'mercator',
  latLngToNorm: (lat: number, lon: number, out?: Point2D): Point2D =>
    out ? latLngToNormInto(lat, lon, out) : latLngToNorm(lat, lon),
  normToLatLng,
};

/**
 * Creates an Equirectangular (Plate Carree) projection preserving the 2:1 geographic
 * aspect ratio when spanning [-180, 180] x [-90, 90] (nx in [0, 1], ny in [0, 0.5]).
 */
export function createEquirectangular(
  bounds: Partial<BoundsSpec> = {}
): Projection {
  const minLat = bounds.minLat ?? -90;
  const maxLat = bounds.maxLat ?? 90;
  const minLon = bounds.minLon ?? -180;
  const maxLon = bounds.maxLon ?? 180;
  const lonSpan = Math.max(1e-6, maxLon - minLon);
  const latSpan = Math.max(1e-6, maxLat - minLat);
  const yScale = latSpan / lonSpan; // 0.5 for standard 360x180 world

  return {
    id: 'equirectangular',
    latLngToNorm: (lat: number, lon: number, out?: Point2D): Point2D => {
      const clampedLat = Math.max(minLat, Math.min(maxLat, lat));
      const nx = (lon - minLon) / lonSpan;
      const ny = ((maxLat - clampedLat) / latSpan) * yScale;
      if (out) {
        out.x = nx;
        out.y = ny;
        return out;
      }
      return { x: nx, y: ny };
    },
    normToLatLng: (nx: number, ny: number): LatLng => {
      const lon = minLon + nx * lonSpan;
      const lat = maxLat - (ny / yScale) * latSpan;
      return [Math.max(minLat, Math.min(maxLat, lat)), lon];
    },
  };
}

const BASE_EQUIRECT = createEquirectangular();

export function resolveProjection(
  projection?: ProjectionType | Projection
): Projection {
  if (!projection || projection === 'mercator') {
    return MERCATOR_PROJECTION;
  }
  if (projection === 'equirectangular') {
    return BASE_EQUIRECT;
  }
  return projection;
}

export interface NormalizedBounds {
  nwX: number;
  nwY: number;
  seX: number;
  seY: number;
}

/**
 * Pre-projects geographic maxBounds into normalized [0, 1] space.
 */
export function getNormBounds(
  maxBounds?: [LatLng, LatLng],
  projection: Projection = MERCATOR_PROJECTION
): NormalizedBounds {
  const isEq = projection.id === 'equirectangular';
  const minLat = maxBounds
    ? Math.min(maxBounds[0][0], maxBounds[1][0])
    : isEq
      ? -90
      : -85;
  const maxLat = maxBounds
    ? Math.max(maxBounds[0][0], maxBounds[1][0])
    : isEq
      ? 90
      : 85;
  const minLon = maxBounds ? Math.min(maxBounds[0][1], maxBounds[1][1]) : -180;
  const maxLon = maxBounds ? Math.max(maxBounds[0][1], maxBounds[1][1]) : 180;
  const nw = projection.latLngToNorm(maxLat, minLon, TMP_NORM);
  const se = projection.latLngToNorm(minLat, maxLon, TMP_NORM_2);
  return { nwX: nw.x, nwY: nw.y, seX: se.x, seY: se.y };
}

/**
 * Computes the minimum zoom level required so the viewport does not exceed maxBounds.
 */
export function getMinZoom(
  width: number,
  height: number,
  maxBounds?: [LatLng, LatLng],
  cachedBounds?: NormalizedBounds,
  projection: Projection = MERCATOR_PROJECTION
): number {
  if (width <= 0 || height <= 0) return 0;
  const nb = cachedBounds ?? getNormBounds(maxBounds, projection);
  const spanX = Math.max(1e-6, nb.seX - nb.nwX);
  const spanY = Math.max(1e-6, nb.seY - nb.nwY);

  const zoomX = Math.log2(width / (TILE_SIZE * spanX));
  const zoomY = Math.log2(height / (TILE_SIZE * spanY));
  return Math.max(zoomX, zoomY);
}

/**
 * Scales a base zoom level relative to a reference viewport width so the
 * horizontal geographic span remains consistent across screen resolutions.
 */
export function getResponsiveZoom(
  baseZoom: number,
  viewportWidth: number,
  referenceWidth = 1920
): number {
  if (viewportWidth <= 0 || referenceWidth <= 0) return baseZoom;
  return baseZoom + Math.log2(viewportWidth / referenceWidth);
}

/**
 * Computes the center and continuous zoom level that fits the given geographic bounds
 * within the specified viewport dimensions.
 */
export function computeZoomForBounds(
  bounds: [LatLng, LatLng],
  width: number,
  height: number,
  paddingPx = 0,
  projection: Projection = MERCATOR_PROJECTION
): { center: LatLng; zoom: number } {
  const { minLat, maxLat, minLon, maxLon } = getBoundsExtent(
    bounds,
    TMP_EXTENT
  );
  const nw = projection.latLngToNorm(maxLat, minLon, TMP_NORM);
  const se = projection.latLngToNorm(minLat, maxLon, TMP_NORM_2);
  const centerNormX = (nw.x + se.x) * 0.5;
  const centerNormY = (nw.y + se.y) * 0.5;
  const center = projection.normToLatLng(centerNormX, centerNormY);

  const availW = Math.max(1, width - paddingPx * 2);
  const availH = Math.max(1, height - paddingPx * 2);
  if (width <= 0 || height <= 0) {
    return { center, zoom: 0 };
  }

  const spanX = Math.max(1e-6, se.x - nw.x);
  const spanY = Math.max(1e-6, se.y - nw.y);
  const zoomX = Math.log2(availW / (TILE_SIZE * spanX));
  const zoomY = Math.log2(availH / (TILE_SIZE * spanY));
  return { center, zoom: Math.min(zoomX, zoomY) };
}

export interface WrappedSlice {
  wrapShiftPx: number;
  drawOffsetX: number;
  adjLonMin: number;
  adjLonMax: number;
}

export interface WrappedSlices {
  scale: number;
  baseOffsetX: number;
  offsetY: number;
  viewLatMin: number;
  viewLatMax: number;
  slices: WrappedSlice[];
}

/**
 * Computes world-wrapped horizontal viewport slices (including -360/+360 antimeridian
 * copies when visible) for canvas layers that render across the ±180° seam.
 */
export function getWrappedSlices(
  state: ProjectionState,
  padDeg = 2,
  projection: Projection = MERCATOR_PROJECTION
): WrappedSlices {
  const scale = TILE_SIZE * Math.pow(2, state.zoom);
  const centerNorm = projection.latLngToNorm(
    state.center[0],
    state.center[1],
    TMP_NORM
  );
  const baseOffsetX = centerNorm.x * scale - state.width * 0.5;
  const offsetY = centerNorm.y * scale - state.height * 0.5;

  const nw = projection.normToLatLng(baseOffsetX / scale, offsetY / scale);
  const se = projection.normToLatLng(
    (baseOffsetX + state.width) / scale,
    (offsetY + state.height) / scale
  );
  const viewLonMin = nw[1] - padDeg;
  const viewLonMax = se[1] + padDeg;
  const viewLatMin = se[0] - padDeg;
  const viewLatMax = nw[0] + padDeg;

  const slices: WrappedSlice[] = [
    {
      wrapShiftPx: 0,
      drawOffsetX: baseOffsetX,
      adjLonMin: viewLonMin,
      adjLonMax: viewLonMax,
    },
  ];
  const needsLeftWrap = nw[1] < -180 - 1e-6;
  const needsRightWrap = se[1] > 180 + 1e-6;
  if (needsLeftWrap) {
    const lonShiftDeg = 360;
    slices.push({
      wrapShiftPx: scale,
      drawOffsetX: baseOffsetX + scale,
      adjLonMin: viewLonMin + lonShiftDeg,
      adjLonMax: viewLonMax + lonShiftDeg,
    });
  }
  if (needsRightWrap && (scale + 1e-3 < state.width || !needsLeftWrap)) {
    const lonShiftDeg = -360;
    slices.push({
      wrapShiftPx: -scale,
      drawOffsetX: baseOffsetX - scale,
      adjLonMin: viewLonMin + lonShiftDeg,
      adjLonMax: viewLonMax + lonShiftDeg,
    });
  }

  return {
    scale,
    baseOffsetX,
    offsetY,
    viewLatMin,
    viewLatMax,
    slices,
  };
}

/**
 * Clamps center coordinates so the viewport stays within maxBounds.
 */
export function clampCenterToBounds(
  center: LatLng,
  zoom: number,
  width: number,
  height: number,
  maxBounds?: [LatLng, LatLng],
  cachedBounds?: NormalizedBounds,
  projection: Projection = MERCATOR_PROJECTION
): LatLng {
  if (!maxBounds || width <= 0 || height <= 0) {
    const maxLat = projection.id === 'equirectangular' ? 90 : MAX_MERCATOR_LAT;
    return [Math.max(-maxLat, Math.min(maxLat, center[0])), center[1]];
  }

  const worldSize = TILE_SIZE * Math.pow(2, zoom);
  const nb = cachedBounds ?? getNormBounds(maxBounds, projection);
  const halfW = (width * 0.5) / worldSize;
  const halfH = (height * 0.5) / worldSize;

  const norm = projection.latLngToNorm(center[0], center[1], TMP_NORM);
  const minX = nb.nwX + halfW;
  const maxX = nb.seX - halfW;
  const minY = nb.nwY + halfH;
  const maxY = nb.seY - halfH;

  const clampedX =
    minX > maxX
      ? (nb.nwX + nb.seX) * 0.5
      : Math.max(minX, Math.min(maxX, norm.x));
  const clampedY =
    minY > maxY
      ? (nb.nwY + nb.seY) * 0.5
      : Math.max(minY, Math.min(maxY, norm.y));

  return projection.normToLatLng(clampedX, clampedY);
}

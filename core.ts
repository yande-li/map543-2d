export {
  type LatLon,
  type Point2D,
  type LatLonBounds,
  type BoundsExtent,
  type ProjectionState,
  type ProjectionType,
  type GeoBounds,
  type Projection,
  MERCATOR_PROJECTION,
  createEquirectangular,
  TILE_SIZE,
  MAX_MERCATOR_LAT,
  latToMercatorY,
  latLonToNorm,
  latLonToNormInto,
  normToLatLon,
  latLonToMapPx,
  mapPxToLatLon,
  latLonToPx,
  pxToLatLon,
  getViewportBounds,
  getWrappedSlices,
  type WrappedSlice,
  type WrappedSlices,
  getMinZoom,
  getResponsiveZoom,
  computeZoomForBounds,
  clampCenterToBounds,
} from './core/projection';
export {
  computeArcsBatch,
  latLonsToSvgPath,
  xyToSvgPath,
  projectMercator,
  traceArc,
} from './core/curves';
export { type MarkerVariant, type MarkerPulse } from './core/marker';
export {
  prepareArcs,
  type TrajectoryCurveMode,
  type TrajectoryItem,
} from './core/trajectory';
export { createGlowDotSprite, drawTrajectories } from './core/canvasTrajectory';
export {
  packPoints,
  drawBatchPoints,
  attachPointHover,
  type PointItem,
  type PointBuffers,
} from './core/pointLayer';
export {
  uploadVectorLayers,
  drawVectorLayers,
  type UploadVectorOptions,
  type VectorLayerStyle,
  type DrawVectorOptions,
} from './core/vectorLayer';
export { type PreparedFeature, type PreparedLayer } from './formats/types';
export {
  parseGeobuf,
  loadGeobuf,
  type ParsedGeobuf,
  type LoadGeobufOptions,
} from './formats/geobuf';
export { MapError, type MapErrorCode } from './core/errors';
export {
  createMap,
  type CreateMapOptions,
  type MapInstance,
  type ZoomControlPosition,
  type ZoomControlsConfig,
  type AddVectorLayerOptions,
  type AddPointLayerOptions,
  type AddImageLayerOptions,
  type AddTrajectoryLayerOptions,
  type AddOverlayOptions,
} from './core/map';

export {
  Viewport,
  type ViewportState,
  type ViewportConstraints,
  type ViewportListener,
  type ProjectionParams,
} from './core/viewport';

export { hitTestPoints, encodePoints16, type PointData } from './core/hitTest';

export {
  type CoordPrecision,
  batchProjectPoints,
  uploadStaticPoints,
  type StaticPointsHandle,
  uploadStaticRings,
  encodeRings16,
  decodeLocDict,
  type StaticGeometryHandle,
  splitAntimeridianRing,
} from './core/batch';
export { drawRings } from './core/vectorLod';

export {
  initWasm,
  resetWasmArena,
  disposeWasm,
  getWasmMemoryStats,
  type WasmMemoryStats,
} from './wasm/bridge';
export {
  attachInteractions,
  type InteractionOptions,
  type MapClickEvent,
} from './core/interactions';
export { attachGamepad, type GamepadOptions } from './core/gamepad';
export {
  CanvasRenderer,
  type CanvasRendererOptions,
  type CanvasDrawCallback,
} from './core/canvasRenderer';
export { loadImage, drawImage, type DrawImageOptions } from './core/imageLayer';
export { type MapLayerRenderer } from './core/renderer';

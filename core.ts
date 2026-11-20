export {
  type LatLng,
  type Point2D,
  type LatLngBounds,
  type ProjectionState,
  type ProjectionType,
  type BoundsSpec,
  type Projection,
  MERCATOR_PROJECTION,
  createEquirectangular,
  resolveProjection,
  TILE_SIZE,
  MAX_MERCATOR_LAT,
  DEG_TO_RAD,
  RAD_TO_DEG,
  MERCATOR_Y_LOOKUP,
  latToMercatorY,
  latLngToNorm,
  latLngToNormInto,
  normToLatLng,
  latLngToWorld,
  worldToLatLng,
  latLngToPx,
  pxToLatLng,
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
  computeArc,
  computeArcsBatch,
  QUADRATIC_ARC_POINTS,
  manhattanDeg,
  getArcTiming,
  type TrajectoryTimingFn,
  latLngsToSvgPath,
  xyToSvgPath,
  projectMercator,
  traceArc,
} from './core/curves';
export {
  ensureMarkerStyles,
  normalizePulseMode,
  resolveMarkerGeometry,
  type MarkerStyleOptions,
  type MarkerVariant,
  type MarkerPulse,
  type MarkerPulseMode,
  type MarkerGeometry,
} from './core/marker';
export {
  scheduleAnimation,
  animateStroke,
  prepareArcs,
  attachSvgSync,
  type TrajectoryCurveMode,
  type TrajectorySpec,
  type TrajectoryTimingFn as CoreTrajectoryTimingFn,
  type PreparedArc,
  type PreparedArcs,
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
  type StyledVectorLayer,
  type VectorScratchBuffers,
  type DrawVectorOptions,
} from './core/vectorLayer';
export { type PreparedFeature, type PreparedLayer } from './formats/types';
export { parseGeobuf } from './formats/geobuf';

export {
  Camera,
  type ViewportState,
  type CameraConstraints,
  type ViewportListener,
  type ProjectionParams,
} from './core/camera';

export {
  findNearestPoint,
  hitTestPoints,
  encodePointsToI16,
  hitTestPointsI16,
  type SpatialPoints,
} from './core/hitTest';

export {
  batchProjectPoints,
  batchProjectPointsI16,
  decimatePackedRings,
  uploadStaticRings,
  encodeNormU16,
  uploadStaticRingsU16,
  decimateStaticRings,
  type StaticGeometryHandle,
  cleanSeamRing,
} from './core/batch';
export {
  type ZoomControlPosition,
  type VectorLodOptions,
  getPixelStep,
  shouldSkipLayer,
  shouldCullFeature,
  drawDecimatedRings,
  drawStaticRings,
  drawStaticDirect,
  drawStaticU16Direct,
} from './core/vectorLod';

export {
  initWasm,
  isWasmReady,
  getWasmRuntime,
  LUT_OFFSET_BYTES,
  resetWasmArena,
  disposeWasm,
  getWasmMemoryStats,
  type WasmRuntime,
  type WasmMemoryStats,
} from './wasm/bridge';
export {
  attachInteractions,
  type InteractionOptions,
} from './core/interactions';
export { attachGamepad, type GamepadOptions } from './core/gamepad';
export {
  BlanketCanvasLayer,
  type BlanketLayerOptions,
  type BlanketDrawCallback,
} from './core/blanketLayer';
export {
  loadImage,
  drawImage,
  type ImageBounds,
  type DrawImageOptions,
} from './core/imageLayer';
export { type MapLayerRenderer } from './core/renderer';

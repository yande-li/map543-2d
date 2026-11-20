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
export { type PreparedFeature, type PreparedLayer } from './formats/types';
export { parseGeobuf, parseGeobufAsync } from './formats/geobuf';

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
  hitTestStaticPoints,
  type SpatialPoints,
} from './core/hitTest';
export {
  batchProjectPoints,
  batchProjectPointsI16,
  uploadStaticPoints,
  uploadStaticPointsI16,
  batchProjectStaticPoints,
  type StaticPointsHandle,
  decimatePackedRings,
  uploadStaticRings,
  encodeNormU16,
  uploadStaticRingsU16,
  decodeLocationDictBatch,
  decodeLocationDictBatchAsync,
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
  drawStaticDirect,
  drawStaticU16Direct,
} from './core/vectorLod';
export {
  initWasm,
  isWasmReady,
  getWasmRuntime,
  ensureWasm,
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
export { ImageLayer, type ImageLayerProps } from './react/ImageLayer';
export { type MapLayerRenderer } from './core/renderer';

export {
  MapContext,
  useMap,
  type MapContextValue,
  type MapClickListener,
} from './react/MapContext';

export { MapView, type MapViewProps } from './react/MapView';

export { CanvasLayer, type CanvasLayerProps } from './react/CanvasLayer';

export {
  Overlay,
  Popup,
  type OverlayProps,
  type PopupProps,
} from './react/Overlay';

export {
  Marker,
  type MarkerProps,
  type MarkerVariant,
  type MarkerPulse,
} from './react/Marker';

export {
  TrajectoryLayer,
  type TrajectoryItem,
  type TrajectoryLayerProps,
  type TrajectoryCurveMode,
} from './react/TrajectoryLayer';

export {
  ensureMarkerStyles,
  normalizePulseMode,
  resolveMarkerGeometry,
  type MarkerStyleOptions,
  type MarkerPulseMode,
  type MarkerGeometry,
} from './core/marker';

export {
  scheduleAnimation,
  animateStroke,
  prepareArcs,
  attachSvgSync,
  type TrajectorySpec,
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

export { PointLayer, type PointLayerProps } from './react/PointLayer';

export {
  uploadVectorLayers,
  drawVectorLayers,
  type UploadVectorOptions,
  type VectorLayerStyle,
  type StyledVectorLayer,
  type VectorScratchBuffers,
  type DrawVectorOptions,
} from './core/vectorLayer';

export { VectorLayer, type VectorLayerProps } from './react/VectorLayer';

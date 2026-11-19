export {
  type LatLng,
  type Point2D,
  type LatLngBounds,
  type ViewportProjectionState,
  type ProjectionType,
  type BoundsSpec,
  type Projection,
  MERCATOR_PROJECTION,
  createEquirectangularProjection,
  resolveProjection,
  TILE_SIZE,
  MAX_MERCATOR_LAT,
  DEG_TO_RAD,
  RAD_TO_DEG,
  MERCATOR_Y_LOOKUP,
  projectLatToMercatorY,
  projectToNormalized,
  projectToNormalizedInto,
  unprojectFromNormalized,
  latLngToWorld,
  worldToLatLng,
  projectLatLngToContainer,
  unprojectContainerToLatLng,
  getViewportBounds,
  getWrappedViewportSlices,
  type WrappedViewportSlice,
  type WrappedViewportSlices,
  computeDynamicMinZoom,
  computeResponsiveZoom,
  computeZoomForBounds,
  clampCenterToBounds,
} from './core/projection';
export {
  computeQuadraticArc,
  computeQuadraticArcsBatch,
  QUADRATIC_ARC_POINTS,
  manhattanDegDistance,
  computeTrajectoryTiming,
  type TrajectoryTimingFn,
  buildProjectedSvgPath,
  buildSvgPathFromFlatXY,
  projectInterleavedMercator,
  traceScreenQuadraticArc,
} from './core/curves';
export {
  parseFgbToPreparedLayers,
  type PreparedFeature,
  type PreparedLayer,
  type CleanSeamRingFn,
} from './formats/fgb';
export { parseGeobufToPreparedLayers } from './formats/geobuf';

export {
  Camera,
  type ViewportState,
  type CameraConstraints,
  type ViewportListener,
  type ProjectionParams,
} from './core/camera';

export {
  findNearestPoint,
  findNearestPointFast,
  type SpatialPoints,
} from './core/hitTest';
export {
  batchProjectPoints,
  decimatePackedRings,
  uploadStaticRings,
  decimateStaticRings,
  type StaticGeometryHandle,
  cleanSeamRing,
} from './core/batch';
export {
  type ZoomControlPosition,
  type VectorLodOptions,
  computeEffectivePixelStep,
  shouldSkipLayer,
  shouldCullFeatureOnInteract,
  traceDecimatedFeature,
  traceDecimatedStaticFeature,
  traceStaticRingsDirect,
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
} from './wasm/wasmBridge';
export {
  attachViewportInteractions,
  type ViewportInteractionsOptions,
} from './core/interactions';
export {
  attachGamepadControls,
  type GamepadControlsOptions,
} from './core/gamepad';
export {
  BlanketCanvasLayer,
  type BlanketCanvasLayerOptions,
  type BlanketDrawCallback,
} from './core/blanketCanvasLayer';
export {
  loadImage,
  drawImage,
  type ImageBounds,
  type DrawImageOptions,
} from './core/imageLayer';
export {
  ImageLayer,
  type ImageLayerProps,
} from './react/ImageLayer';
export { type MapLayerRenderer } from './core/renderer';

export {
  MapContext,
  useMap,
  type MapContextValue,
  type MapClickListener,
} from './react/MapContext';

export {
  MapView,
  type MapViewProps,
} from './react/MapView';

export {
  CanvasLayer,
  type CanvasLayerProps,
} from './react/CanvasLayer';

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
  type EnsureMarkerStylesOptions,
  type MarkerPulseMode,
  type MarkerGeometry,
} from './core/marker';

export {
  isGeckoEngine,
  scheduleStrokeAnimation,
  animateTrajectoryStroke,
  prepareTrajectoryBatch,
  attachSvgTrajectorySync,
  type TrajectorySpec,
  type PreparedTrajectoryEntry,
  type PreparedTrajectoryBatch,
} from './core/trajectory';

export {
  createGlowDotSprite,
  drawScreenTrajectoryBatch,
} from './core/canvasTrajectory';

export {
  buildPointSpatialBuffers,
  drawBatchPoints,
  attachPointHoverCursor,
  type PointItem,
  type PointSpatialBuffers,
} from './core/pointLayer';

export {
  PointLayer,
  type PointLayerProps,
} from './react/PointLayer';

export {
  uploadVectorLayers,
  drawVectorLayers,
  type UploadVectorOptions,
  type VectorLayerStyle,
  type StyledVectorLayer,
  type VectorScratchBuffers,
  type DrawVectorOptions,
} from './core/vectorLayer';

export {
  VectorLayer,
  type VectorLayerProps,
} from './react/VectorLayer';

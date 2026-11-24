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
  pxToLatLon,
  getWrappedSlices,
  type WrappedSlice,
  type WrappedSlices,
  getMinZoom,
  computeZoomForBounds,
  clampCenterToBounds,
  boundsIntersects,
} from './core/projection';
export { type MarkerVariant, type MarkerPulse } from './core/marker';
export {
  prepareArcs,
  type TrajectoryCurveMode,
  type TrajectoryItem,
} from './core/trajectory';
export {
  createGlowDotSprite,
  drawTrajectories,
  packTrajectories,
  packTrajectoryArrays,
  drawBatchTrajectories,
  type TrajectoryBuffers,
  type DrawBatchTrajectoriesOptions,
} from './core/canvasTrajectory';
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
  type MapEventMap,
  type PointLayerCleanup,
  type ZoomControlPosition,
  type ZoomControlsConfig,
  type AddVectorLayerOptions,
  type AddPointLayerOptions,
  type AddImageLayerOptions,
  type AddTrajectoryLayerOptions,
  type AddHeatmapLayerOptions,
  type AddOverlayOptions,
} from './core/map';
export {
  packHeatmapPoints,
  packHeatmapArrays,
  sliceHeatmapByTime,
  buildHeatmapPalette,
  drawHeatmap,
  type HeatmapPoint,
  type HeatmapColorStop,
  type HeatmapBuffers,
  type HeatmapOptions,
  type HeatmapScratch,
} from './core/heatmapLayer';

export {
  createEmitter,
  type TypedEmitter,
  type Unsubscribe,
} from './core/events';
export {
  MAP_Z_INDEX,
  createControlSlots,
  type ControlPosition,
  type ControlSlots,
} from './core/controls';
export {
  hitTestPointBuffers,
  type PointHitResult,
  type PointLayerHandle,
} from './core/pointLayer';

export {
  Viewport,
  type ViewportState,
  type ViewportEventMap,
  type ViewportConstraints,
  type ViewportListener,
  type ProjectionParams,
} from './core/viewport';

export { hitTestPoints, encodePoints16, type PointData } from './core/hitTest';

export {
  type CoordPrecision,
  quantize16,
  uploadStaticPoints,
  type StaticPointsHandle,
  uploadStaticRings,
  encodeRings16,
  type StaticGeometryHandle,
} from './core/batch';

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
  type MapPointerEvent,
} from './core/interactions';
export { attachGamepad, type GamepadOptions } from './core/gamepad';
export {
  CanvasRenderer,
  type CanvasRendererOptions,
  type CanvasDrawCallback,
} from './core/canvasRenderer';
export { loadImage, drawImage, type DrawImageOptions } from './core/imageLayer';
export { type MapLayerRenderer } from './core/renderer';

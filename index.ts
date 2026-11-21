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
  TILE_SIZE,
  MAX_MERCATOR_LAT,
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
  latLngsToSvgPath,
  xyToSvgPath,
  projectMercator,
  traceArc,
} from './core/curves';
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
  encodePoints16,
  type SpatialPoints,
} from './core/hitTest';
export {
  type CoordPrecision,
  batchProjectPoints,
  uploadStaticPoints,
  type StaticPointsHandle,
  decimatePackedRings,
  uploadStaticRings,
  encodeRings16,
  decodeLocationDictBatch,
  type StaticGeometryHandle,
  cleanSeamRing,
} from './core/batch';
export { type ZoomControlPosition, drawRings } from './core/vectorLod';
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

export { prepareArcs } from './core/trajectory';

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

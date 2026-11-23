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
export { type PreparedFeature, type PreparedLayer } from './formats/types';
export {
  parseGeobuf,
  loadGeobuf,
  type ParsedGeobuf,
  type LoadGeobufOptions,
} from './formats/geobuf';
export { MapError, type MapErrorCode } from './core/errors';

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
export { type ZoomControlPosition, type ZoomControlsConfig } from './core/map';
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
  createLayerGroup,
  type LayerHandle,
  type LayerGroup,
} from './core/layers';
export { type ViewportEventMap } from './core/viewport';
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
export { ImageLayer, type ImageLayerProps } from './react/ImageLayer';
export { type MapLayerRenderer } from './core/renderer';

export {
  MapContext,
  useMap,
  type MapContextValue,
  type MapClickListener,
} from './react/MapContext';
export { useViewport, useViewportSelector, useMapClick } from './react/hooks';
export { useGeobuf, type UseGeobufResult } from './react/useGeobuf';

export {
  MapView,
  type MapViewProps,
  type MapViewHandle,
} from './react/MapView';
export { MapControl, type MapControlProps } from './react/MapControl';

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
  hitTestPointBuffers,
  type PointItem,
  type PointBuffers,
  type PointHitResult,
  type PointLayerHandle,
} from './core/pointLayer';

export { PointLayer, type PointLayerProps } from './react/PointLayer';

export {
  uploadVectorLayers,
  drawVectorLayers,
  type UploadVectorOptions,
  type VectorLayerStyle,
  type DrawVectorOptions,
} from './core/vectorLayer';

export { VectorLayer, type VectorLayerProps } from './react/VectorLayer';

import {
  Viewport,
  type ViewportConstraints,
  type ViewportEventMap,
  type ViewportListener,
  type ViewportState,
} from './viewport';
import {
  MAP_Z_INDEX,
  createControlSlots,
  resolveZoomControlsConfig,
  type ControlPosition,
  type ControlSlots,
  type ZoomControlsConfig,
} from './controls';
import { createEmitter, type Unsubscribe } from './events';
import { CanvasRenderer, type CanvasRendererOptions } from './canvasRenderer';
import {
  createGlowDotSprite,
  drawBatchTrajectories,
  packTrajectories,
} from './canvasTrajectory';
import { toMapError, type MapError } from './errors';
import { attachGamepad, type GamepadOptions } from './gamepad';
import {
  buildHeatmapPalette,
  drawHeatmap,
  packHeatmapPoints,
  type HeatmapColorStop,
  type HeatmapIntensityMode,
  type HeatmapMaxIntensity,
  type HeatmapPoint,
  type HeatmapScratch,
} from './heatmapLayer';
import { DEFAULT_WORLD_BOUNDS, drawImage, loadImage } from './imageLayer';
import { attachInteractions, type MapPointerEvent } from './interactions';
import {
  attachPointHover,
  createPointLayerHandle,
  drawBatchPoints,
  hitTestPointBuffers,
  packPoints,
  type PointItem,
  type PointLayerHandle,
} from './pointLayer';
import { type GeoBounds, type LatLon, type Point2D } from './projection';
import { type MapLayerRenderer } from './renderer';
import { type TrajectoryItem } from './trajectory';
import {
  drawVectorLayers,
  uploadVectorLayers,
  computeVectorMaxDpr,
  type VectorLayerStyle,
} from './vectorLayer';
import { type CoordPrecision, type StaticGeometryHandle } from './batch';
import {
  loadGeobuf,
  parseGeobufInput,
  type ParsedGeobuf,
} from '../formats/geobuf';
import { type PreparedFeature, type PreparedLayer } from '../formats/types';

export type { ZoomControlsConfig };

export interface MapEventMap extends ViewportEventMap {
  click: MapPointerEvent;
  mousemove: MapPointerEvent;
  contextmenu: MapPointerEvent;
}

export interface CreateMapOptions extends ViewportConstraints {
  center?: LatLon;
  zoom?: number;
  interactive?: boolean;
  keyboard?: boolean;
  gamepad?: boolean | GamepadOptions;
  zoomDelta?: number;
  moveEndDelayMs?: number;
  zoomControls?: boolean | ZoomControlsConfig;
  cursor?: string;
  onClick?: (event: MapPointerEvent) => void;
  onMove?: (state: ViewportState) => void;
  onMoveEnd?: (state: ViewportState) => void;
}

export interface AddVectorLayerOptions {
  src?: string;
  data?: ArrayBuffer | Uint8Array | ParsedGeobuf;
  fillLayers?: readonly PreparedLayer[];
  strokeLayers?: readonly PreparedLayer[];
  styles?: Readonly<Record<string, VectorLayerStyle>>;
  smoothFactor?: number;
  maxDpr?: number;
  zIndex?: number;
  skipOnInteractLayers?: ReadonlySet<string>;
  resetOnUpload?: boolean;
  precision?: CoordPrecision;
  interactionMaxDpr?: number;
  className?: string;
  onLoad?: (layers: ParsedGeobuf) => void;
  onError?: (error: MapError) => void;
}

export interface AddPointLayerOptions {
  points: readonly PointItem[];
  zIndex?: number;
  hitRadiusPx?: number;
  marginPx?: number;
  strokeColor?: string;
  strokeWidth?: number;
  precision?: CoordPrecision;
  className?: string;
  onPointClick?: (point: PointItem, index: number) => void;
  onPointHover?: (point: PointItem | null, index: number) => void;
}

export interface AddImageLayerOptions {
  src?: string;
  image?: CanvasImageSource;
  bounds?: GeoBounds;
  zIndex?: number;
  opacity?: number;
  maxDpr?: number;
  imageSmoothingEnabled?: boolean;
  className?: string;
  onLoad?: () => void;
  onError?: (error: MapError) => void;
}

export interface AddTrajectoryLayerOptions {
  color?: string;
  zIndex?: number;
  maxDpr?: number;
  dotSize?: number;
  precision?: CoordPrecision;
  className?: string;
}

export interface AddHeatmapLayerOptions {
  points: readonly HeatmapPoint[];
  radiusPx?: number;
  gridScale?: number;
  maxIntensity?: HeatmapMaxIntensity;
  intensityMode?: HeatmapIntensityMode;
  opacity?: number;
  colorStops?: readonly HeatmapColorStop[];
  precision?: CoordPrecision;
  timeRange?: readonly [number, number];
  zIndex?: number;
  className?: string;
}

export interface AddOverlayOptions {
  anchor?: [number, number];
  zIndex?: number;
}

export type PointLayerCleanup = (() => void) & PointLayerHandle;

export interface MapInstance {
  readonly viewport: Viewport;
  setView: (center: LatLon, zoom?: number) => void;
  flyTo: (
    targetCenter: LatLon,
    targetZoom?: number,
    durationMs?: number
  ) => void;
  fitBounds: (
    bounds: [LatLon, LatLon],
    paddingPx?: number,
    durationMs?: number
  ) => void;
  getState: () => ViewportState;
  subscribe: (listener: ViewportListener) => () => void;
  on: <K extends keyof MapEventMap>(
    type: K,
    listener: (payload: MapEventMap[K]) => void
  ) => Unsubscribe;
  once: <K extends keyof MapEventMap>(
    type: K,
    listener: (payload: MapEventMap[K]) => void
  ) => Unsubscribe;
  addControl: (element: HTMLElement, position?: ControlPosition) => () => void;
  addLayer: (renderer: MapLayerRenderer) => () => void;
  addCanvasLayer: (options: CanvasRendererOptions) => () => void;
  addVectorLayer: (options: AddVectorLayerOptions) => () => void;
  addPointLayer: (options: AddPointLayerOptions) => PointLayerCleanup;
  addImageLayer: (options: AddImageLayerOptions) => () => void;
  addTrajectoryLayer: (
    items: readonly TrajectoryItem[],
    options?: AddTrajectoryLayerOptions
  ) => () => void;
  addHeatmapLayer: (options: AddHeatmapLayerOptions) => () => void;
  addOverlay: (
    element: HTMLElement,
    position: LatLon,
    options?: AddOverlayOptions
  ) => () => void;
  destroy: () => void;
}

function createZoomControlsElement(
  controlSlots: ControlSlots,
  viewport: Viewport,
  config: ZoomControlsConfig
): () => void {
  const { position, delta, inLabel, outLabel } =
    resolveZoomControlsConfig(config);

  const root = document.createElement('div');
  root.className = `map-zoom-controls ${position}`;
  root.style.display = 'flex';
  root.style.flexDirection = 'column';

  const stop = (e: Event) => e.stopPropagation();
  root.addEventListener('pointerdown', stop);
  root.addEventListener('dblclick', stop);

  const makeBtn = (cls: string, label: string, text: string, dir: number) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `map-zoom-btn ${cls}`;
    btn.setAttribute('aria-label', label);
    btn.textContent = text;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewport.zoomBy(delta * dir);
    });
    return btn;
  };

  const btnIn = makeBtn('map-zoom-in', inLabel, '+', 1);
  const btnOut = makeBtn('map-zoom-out', outLabel, '−', -1);

  root.appendChild(btnIn);
  root.appendChild(btnOut);
  const unmountControl = controlSlots.mountControl(root, position);

  const syncButtons = () => {
    const s = viewport.getState();
    const minZ = viewport.getEffectiveMinZoom();
    btnIn.disabled = s.zoom >= s.maxZoom - 1e-4;
    btnOut.disabled = s.zoom <= minZ + 1e-4;
  };
  syncButtons();
  const unsub = viewport.subscribe(syncButtons);

  return () => {
    unsub();
    root.removeEventListener('pointerdown', stop);
    root.removeEventListener('dblclick', stop);
    unmountControl();
  };
}

function mountVectorLayer(
  container: HTMLElement,
  viewport: Viewport,
  options: AddVectorLayerOptions
): () => void {
  let fillLayers: readonly PreparedLayer[] = options.fillLayers ?? [];
  let strokeLayers: readonly PreparedLayer[] = options.strokeLayers ?? [];
  let handles = new WeakMap<PreparedFeature, StaticGeometryHandle>();
  const precision = options.precision ?? 32;
  const smoothFactor = options.smoothFactor ?? 1.0;
  const maxDpr = options.maxDpr ?? computeVectorMaxDpr(smoothFactor);

  const drawOpts = {
    smoothFactor,
    isInteracting: false,
    projection: viewport.getProjection(),
    ...(options.styles ? { styles: options.styles } : {}),
    ...(options.skipOnInteractLayers
      ? { skipOnInteractLayers: options.skipOnInteractLayers }
      : {}),
  };

  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? MAP_Z_INDEX.vector,
    maxDpr,
    interactionMaxDpr: Math.min(maxDpr, options.interactionMaxDpr ?? 0.45),
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, state, _cam, isInteracting) => {
      if (fillLayers.length === 0 && strokeLayers.length === 0) return;
      drawOpts.isInteracting = isInteracting;
      drawOpts.projection = viewport.getProjection();
      drawVectorLayers(ctx, state, fillLayers, strokeLayers, handles, drawOpts);
    },
  });

  const uploadOpts = {
    ...(options.resetOnUpload !== undefined
      ? { reset: options.resetOnUpload }
      : {}),
    precision,
  };

  const applyLayers = (next: ParsedGeobuf) => {
    fillLayers = next.fillLayers;
    strokeLayers = next.strokeLayers;
    handles = uploadVectorLayers(fillLayers, strokeLayers, uploadOpts);
    renderer.render(viewport.getState());
  };

  if (fillLayers.length > 0 || strokeLayers.length > 0) {
    handles = uploadVectorLayers(fillLayers, strokeLayers, uploadOpts);
  } else if (options.data) {
    try {
      applyLayers(parseGeobufInput(options.data));
    } catch (err) {
      options.onError?.(toMapError(err, 'GEOBUF_DECODE_ERROR'));
    }
  }

  const unmount = renderer.mount(container, viewport);
  let abortController: AbortController | null = null;
  if (!options.fillLayers && !options.data && options.src) {
    abortController = new AbortController();
    void loadGeobuf(options.src, { signal: abortController.signal })
      .then((parsed) => {
        if (abortController?.signal.aborted) return;
        applyLayers(parsed);
        options.onLoad?.(parsed);
      })
      .catch((err: unknown) => {
        if (abortController?.signal.aborted) return;
        options.onError?.(toMapError(err, 'GEOBUF_DECODE_ERROR'));
      });
  }

  return () => {
    abortController?.abort();
    unmount();
    handles = new WeakMap();
  };
}

function mountPointLayer(
  container: HTMLElement,
  viewport: Viewport,
  options: AddPointLayerOptions,
  subscribeClick: (listener: (event: MapPointerEvent) => void) => () => void
): { cleanup: () => void } & PointLayerHandle {
  const precision = options.precision ?? 32;
  const hitRadiusPx = options.hitRadiusPx ?? 18;
  const marginPx = options.marginPx ?? 30;
  const spatial = packPoints(options.points, precision);

  const drawOpts = {
    margin: marginPx,
    ...(options.strokeColor !== undefined
      ? { strokeColor: options.strokeColor }
      : {}),
    ...(options.strokeWidth !== undefined
      ? { strokeWidth: options.strokeWidth }
      : {}),
  };

  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? MAP_Z_INDEX.point,
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, _state, cam) => {
      if (spatial.count === 0) return;
      drawBatchPoints(ctx, cam, options.points, spatial, drawOpts);
    },
  });

  const unmountCanvas = renderer.mount(container, viewport);
  const unsubClick =
    options.onPointClick && options.points.length > 0
      ? subscribeClick(({ x, y }) => {
          const hit = hitTestPointBuffers(
            x,
            y,
            options.points,
            spatial,
            viewport,
            hitRadiusPx
          );
          if (hit) {
            options.onPointClick?.(hit.point, hit.index);
          }
        })
      : () => {};

  const unsubHover =
    options.onPointClick || options.onPointHover
      ? attachPointHover(container, viewport, spatial, hitRadiusPx, (idx) => {
          options.onPointHover?.(idx >= 0 ? options.points[idx] : null, idx);
        })
      : () => {};

  return {
    cleanup: () => {
      unsubClick();
      unsubHover();
      unmountCanvas();
    },
    ...createPointLayerHandle(options.points, spatial, viewport, hitRadiusPx),
  };
}

function mountImageLayer(
  container: HTMLElement,
  viewport: Viewport,
  options: AddImageLayerOptions
): () => void {
  let activeImg: CanvasImageSource | null = options.image ?? null;
  let disposed = false;
  const bounds = options.bounds ?? DEFAULT_WORLD_BOUNDS;

  const drawOpts = {
    ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
    ...(options.imageSmoothingEnabled !== undefined
      ? { imageSmoothingEnabled: options.imageSmoothingEnabled }
      : {}),
  };

  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? MAP_Z_INDEX.image,
    maxDpr: options.maxDpr ?? 2,
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, _state, cam) => {
      if (!activeImg) return;
      drawImage(ctx, activeImg, bounds, cam, drawOpts);
    },
  });

  const unmount = renderer.mount(container, viewport);
  if (!activeImg && options.src) {
    void loadImage(options.src)
      .then((img) => {
        if (disposed) return;
        activeImg = img;
        renderer.render(viewport.getState());
        options.onLoad?.();
      })
      .catch((err: unknown) => {
        if (disposed) return;
        options.onError?.(toMapError(err, 'IMAGE_DECODE_ERROR'));
      });
  }

  return () => {
    disposed = true;
    unmount();
  };
}

function mountTrajectoryLayer(
  container: HTMLElement,
  viewport: Viewport,
  items: readonly TrajectoryItem[],
  options: AddTrajectoryLayerOptions = {}
): () => void {
  const buffers = packTrajectories(items, options.precision ?? 32);
  const color = options.color ?? '#0ebf9c';
  const sprite = createGlowDotSprite(color, options.dotSize ?? 10);

  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? MAP_Z_INDEX.trajectory,
    maxDpr: options.maxDpr ?? 2,
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, _state, cam) => {
      if (buffers.count === 0) return;
      drawBatchTrajectories(ctx, cam, buffers, { color, sprite });
    },
  });

  return renderer.mount(container, viewport);
}

function mountHeatmapLayer(
  container: HTMLElement,
  viewport: Viewport,
  options: AddHeatmapLayerOptions
): () => void {
  const buffers = packHeatmapPoints(options.points, options.precision ?? 32);
  const palette = options.colorStops
    ? buildHeatmapPalette(options.colorStops)
    : undefined;
  const scratch: HeatmapScratch = {};
  const drawOpts = {
    ...(options.radiusPx !== undefined ? { radiusPx: options.radiusPx } : {}),
    ...(options.gridScale !== undefined
      ? { gridScale: options.gridScale }
      : {}),
    ...(options.maxIntensity !== undefined
      ? { maxIntensity: options.maxIntensity }
      : {}),
    ...(options.intensityMode !== undefined
      ? { intensityMode: options.intensityMode }
      : {}),
    ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
    ...(options.timeRange ? { timeRange: options.timeRange } : {}),
    ...(palette ? { palette } : {}),
  };
  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? MAP_Z_INDEX.heatmap,
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, _state, cam) => {
      drawHeatmap(ctx, buffers, cam, drawOpts, scratch);
    },
  });
  return renderer.mount(container, viewport);
}

function mountOverlay(
  container: HTMLElement,
  viewport: Viewport,
  element: HTMLElement,
  position: LatLon,
  options: AddOverlayOptions = {}
): () => void {
  const anchor = options.anchor ?? [0.5, 0.5];
  element.style.position = 'absolute';
  element.style.top = '0';
  element.style.left = '0';
  element.style.zIndex = String(options.zIndex ?? MAP_Z_INDEX.overlay);
  container.appendChild(element);

  const pt: Point2D = { x: 0, y: 0 };
  const update = () => {
    viewport.projectInto(position[0], position[1], pt);
    const x = Math.round(pt.x - anchor[0] * element.offsetWidth);
    const y = Math.round(pt.y - anchor[1] * element.offsetHeight);
    element.style.transform = `translate3d(${x}px,${y}px,0)`;
  };
  update();
  const unsub = viewport.subscribe(update);
  return () => {
    unsub();
    element.remove();
  };
}

/**
 * Framework-agnostic map facade that wires Viewport, interactions, gamepad, zoom controls,
 * and layers behind a single lifecycle-managed instance.
 */
export function createMap(
  containerOrSelector: HTMLElement | string,
  options: CreateMapOptions = {}
): MapInstance {
  const container =
    typeof containerOrSelector === 'string'
      ? document.querySelector<HTMLElement>(containerOrSelector)
      : containerOrSelector;
  if (!container) {
    throw new Error(`Map container not found: ${String(containerOrSelector)}`);
  }
  const prevCursor = container.style.cursor;
  const interactive = options.interactive ?? true;
  container.style.cursor =
    options.cursor ??
    `var(--map543-cursor, ${interactive ? 'grab' : 'default'})`;
  const viewport = new Viewport(options);
  const controlSlots = createControlSlots(container);
  const pointerEmitter = createEmitter<{
    click: MapPointerEvent;
    mousemove: MapPointerEvent;
    contextmenu: MapPointerEvent;
  }>();
  const cleanups = new Set<() => void>();
  let destroyed = false;

  const bindEvent = <K extends keyof MapEventMap>(
    method: 'on' | 'once',
    type: K,
    listener: (payload: MapEventMap[K]) => void
  ): Unsubscribe => {
    if (type !== 'click' && type !== 'mousemove' && type !== 'contextmenu') {
      return viewport[method](
        type,
        listener as (payload: ViewportEventMap[typeof type]) => void
      );
    }
    return pointerEmitter[method](
      type,
      listener as (payload: MapPointerEvent) => void
    );
  };

  const on = <K extends keyof MapEventMap>(
    type: K,
    listener: (payload: MapEventMap[K]) => void
  ): Unsubscribe => bindEvent('on', type, listener);

  const once = <K extends keyof MapEventMap>(
    type: K,
    listener: (payload: MapEventMap[K]) => void
  ): Unsubscribe => bindEvent('once', type, listener);

  const subscribeClick = (listener: (event: MapPointerEvent) => void) =>
    pointerEmitter.on('click', listener);

  const detachInteractions = attachInteractions(container, viewport, {
    interactive: options.interactive ?? true,
    keyboard: options.keyboard ?? true,
    observeResize: true,
    ...(options.zoomDelta !== undefined
      ? { zoomDelta: options.zoomDelta }
      : {}),
    ...(options.moveEndDelayMs !== undefined
      ? { moveEndDelayMs: options.moveEndDelayMs }
      : {}),
    onMoveEnd: () => options.onMoveEnd?.(viewport.getState()),
    onClick: (event) => {
      options.onClick?.(event);
      pointerEmitter.emit('click', event);
    },
    hasMouseMoveListener: () => pointerEmitter.hasListeners('mousemove'),
    onMouseMove: (event) => pointerEmitter.emit('mousemove', event),
    onContextMenu: (event) => pointerEmitter.emit('contextmenu', event),
  });

  const detachMove = options.onMove
    ? viewport.subscribe((state) => options.onMove?.(state))
    : () => {};

  const detachGamepad =
    options.gamepad && (options.interactive ?? true)
      ? attachGamepad(
          viewport,
          typeof options.gamepad === 'object' ? options.gamepad : undefined
        )
      : () => {};

  const detachZoomControls =
    options.zoomControls && (options.interactive ?? true)
      ? createZoomControlsElement(
          controlSlots,
          viewport,
          typeof options.zoomControls === 'object' ? options.zoomControls : {}
        )
      : () => {};

  const track = (cleanup: () => void): (() => void) => {
    if (destroyed) {
      cleanup();
      return () => {};
    }
    cleanups.add(cleanup);
    return () => {
      cleanups.delete(cleanup);
      cleanup();
    };
  };

  return {
    viewport,
    setView: (center, zoom) => viewport.setView(center, zoom),
    flyTo: (targetCenter, targetZoom, durationMs) =>
      viewport.flyTo(targetCenter, targetZoom, durationMs),
    fitBounds: (bounds, paddingPx, durationMs) =>
      viewport.fitBounds(bounds, paddingPx, durationMs),
    getState: () => viewport.getState(),
    subscribe: (listener) => viewport.subscribe(listener),
    on,
    once,
    addControl: (element, position = 'top-right') =>
      track(controlSlots.mountControl(element, position)),
    addLayer: (renderer) => {
      renderer.onAttach(viewport);
      return track(() => renderer.onDetach());
    },
    addCanvasLayer: (opts) => {
      const renderer = new CanvasRenderer(opts);
      return track(renderer.mount(container, viewport));
    },
    addVectorLayer: (opts) =>
      track(mountVectorLayer(container, viewport, opts)),
    addPointLayer: (opts) => {
      const mounted = mountPointLayer(
        container,
        viewport,
        opts,
        subscribeClick
      );
      const remove = track(mounted.cleanup);
      return Object.assign(remove, {
        hitTest: mounted.hitTest,
        hitTestCenter: mounted.hitTestCenter,
      });
    },
    addImageLayer: (opts) => track(mountImageLayer(container, viewport, opts)),
    addTrajectoryLayer: (items, opts) =>
      track(mountTrajectoryLayer(container, viewport, items, opts)),
    addHeatmapLayer: (opts) =>
      track(mountHeatmapLayer(container, viewport, opts)),
    addOverlay: (el, pos, opts) =>
      track(mountOverlay(container, viewport, el, pos, opts)),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const cleanup of Array.from(cleanups)) {
        cleanup();
      }
      cleanups.clear();
      pointerEmitter.clear();
      detachZoomControls();
      controlSlots.destroy();
      detachGamepad();
      detachMove();
      detachInteractions();
      viewport.cancelAnimation();
      container.style.cursor = prevCursor;
    },
  };
}

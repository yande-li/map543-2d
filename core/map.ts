import {
  Viewport,
  type ViewportConstraints,
  type ViewportListener,
  type ViewportState,
} from './viewport';
import { CanvasRenderer, type CanvasRendererOptions } from './canvasRenderer';
import { createGlowDotSprite, drawTrajectories } from './canvasTrajectory';
import { toMapError, type MapError } from './errors';
import { type GamepadOptions } from './gamepad';
import { hitTestPoints } from './hitTest';
import { drawImage, loadImage } from './imageLayer';
import { attachInteractions, type MapClickEvent } from './interactions';
import {
  attachPointHover,
  drawBatchPoints,
  packPoints,
  type PointItem,
} from './pointLayer';
import { type GeoBounds, type LatLon, type Point2D } from './projection';
import { type MapLayerRenderer } from './renderer';
import { prepareArcs, type TrajectoryItem } from './trajectory';
import {
  drawVectorLayers,
  uploadVectorLayers,
  computeVectorMaxDpr,
  type VectorLayerStyle,
} from './vectorLayer';
import { type CoordPrecision, type StaticGeometryHandle } from './batch';

export type ZoomControlPosition =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
import {
  loadGeobuf,
  parseGeobufInput,
  type ParsedGeobuf,
} from '../formats/geobuf';
import { type PreparedFeature, type PreparedLayer } from '../formats/types';
import { getWasmRuntime } from '../wasm/bridge';

export interface ZoomControlsConfig {
  position?: ZoomControlPosition;
  delta?: number;
  inLabel?: string;
  outLabel?: string;
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
  onClick?: (event: MapClickEvent) => void;
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
  lowPower?: boolean;
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
  className?: string;
}

export interface AddOverlayOptions {
  anchor?: [number, number];
  zIndex?: number;
}

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
  onClick: (listener: (event: MapClickEvent) => void) => () => void;
  addLayer: (renderer: MapLayerRenderer) => () => void;
  addCanvasLayer: (options: CanvasRendererOptions) => () => void;
  addVectorLayer: (options: AddVectorLayerOptions) => () => void;
  addPointLayer: (options: AddPointLayerOptions) => () => void;
  addImageLayer: (options: AddImageLayerOptions) => () => void;
  addTrajectoryLayer: (
    items: readonly TrajectoryItem[],
    options?: AddTrajectoryLayerOptions
  ) => () => void;
  addOverlay: (
    element: HTMLElement,
    position: LatLon,
    options?: AddOverlayOptions
  ) => () => void;
  destroy: () => void;
}

const DEFAULT_WORLD_BOUNDS: GeoBounds = [
  [-90, -180],
  [90, 180],
];

function createZoomControlsElement(
  container: HTMLElement,
  viewport: Viewport,
  config: ZoomControlsConfig
): () => void {
  const position = config.position ?? 'bottom-right';
  const delta = config.delta ?? 0.5;
  const inLabel = config.inLabel ?? 'Zoom in';
  const outLabel = config.outLabel ?? 'Zoom out';

  const root = document.createElement('div');
  root.className = `map-zoom-controls ${position}`;
  root.style.position = 'absolute';
  root.style.zIndex = '800';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  if (position.startsWith('top-')) root.style.top = '16px';
  else root.style.bottom = '16px';
  if (position.endsWith('-left')) root.style.left = '16px';
  else root.style.right = '16px';

  const stop = (e: Event) => e.stopPropagation();
  root.addEventListener('pointerdown', stop);
  root.addEventListener('dblclick', stop);

  const btnIn = document.createElement('button');
  btnIn.type = 'button';
  btnIn.className = 'map-zoom-btn map-zoom-in';
  btnIn.setAttribute('aria-label', inLabel);
  btnIn.textContent = '+';
  btnIn.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = viewport.getState();
    viewport.zoomAt(s.zoom + delta, s.width * 0.5, s.height * 0.5);
  });

  const btnOut = document.createElement('button');
  btnOut.type = 'button';
  btnOut.className = 'map-zoom-btn map-zoom-out';
  btnOut.setAttribute('aria-label', outLabel);
  btnOut.textContent = '−';
  btnOut.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = viewport.getState();
    viewport.zoomAt(s.zoom - delta, s.width * 0.5, s.height * 0.5);
  });

  root.appendChild(btnIn);
  root.appendChild(btnOut);
  container.appendChild(root);

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
    root.remove();
  };
}

function createViewportFromOptions(options: CreateMapOptions): Viewport {
  return new Viewport({
    ...(options.center ? { center: options.center } : {}),
    ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
    ...(options.minZoom !== undefined ? { minZoom: options.minZoom } : {}),
    ...(options.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
    ...(options.maxBounds ? { maxBounds: options.maxBounds } : {}),
    ...(options.referenceWidth !== undefined
      ? { referenceWidth: options.referenceWidth }
      : {}),
    ...(options.preserveViewportSpan !== undefined
      ? { preserveViewportSpan: options.preserveViewportSpan }
      : {}),
    ...(options.projection !== undefined
      ? { projection: options.projection }
      : {}),
    ...(options.smooth !== undefined ? { smooth: options.smooth } : {}),
  });
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
  const maxDpr = computeVectorMaxDpr(Boolean(options.lowPower), smoothFactor);

  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? 100,
    maxDpr,
    interactionMaxDpr: Math.min(maxDpr, options.interactionMaxDpr ?? 0.45),
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, state, _cam, isInteracting) => {
      if (fillLayers.length === 0 && strokeLayers.length === 0) return;
      drawVectorLayers(ctx, state, fillLayers, strokeLayers, handles, {
        smoothFactor,
        isInteracting,
        projection: viewport.getProjection(),
        ...(options.styles ? { styles: options.styles } : {}),
        ...(options.skipOnInteractLayers
          ? { skipOnInteractLayers: options.skipOnInteractLayers }
          : {}),
      });
    },
  });

  const applyLayers = (next: ParsedGeobuf) => {
    fillLayers = next.fillLayers;
    strokeLayers = next.strokeLayers;
    handles = uploadVectorLayers(fillLayers, strokeLayers, {
      ...(options.resetOnUpload !== undefined
        ? { reset: options.resetOnUpload }
        : {}),
      precision,
    });
    renderer.render(viewport.getState());
  };

  if (fillLayers.length > 0 || strokeLayers.length > 0) {
    handles = uploadVectorLayers(fillLayers, strokeLayers, {
      ...(options.resetOnUpload !== undefined
        ? { reset: options.resetOnUpload }
        : {}),
      precision,
    });
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
  subscribeClick: (listener: (event: MapClickEvent) => void) => () => void
): () => void {
  const precision = options.precision ?? 32;
  const hitRadiusPx = options.hitRadiusPx ?? 18;
  const marginPx = options.marginPx ?? 30;
  const spatial = packPoints(options.points, precision);
  const outXY = new Float32Array(spatial.count * 2);
  const outIdx = new Int32Array(spatial.count);

  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? 300,
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, _state, cam) => {
      if (spatial.count === 0) return;
      drawBatchPoints(
        ctx,
        cam,
        options.points,
        spatial,
        outXY,
        outIdx,
        marginPx
      );
    },
  });

  const unmountCanvas = renderer.mount(container, viewport);
  const unsubClick =
    options.onPointClick && options.points.length > 0
      ? subscribeClick(({ x, y }) => {
          const rt = getWasmRuntime();
          const sh = spatial.staticHandle;
          const target =
            rt !== null && sh && sh.epoch === rt.arenaEpoch ? sh : spatial;
          const idx = hitTestPoints(x, y, target, viewport, hitRadiusPx);
          if (idx >= 0) {
            options.onPointClick?.(options.points[idx], idx);
          }
        })
      : () => {};

  const unsubHover =
    options.onPointClick || options.onPointHover
      ? attachPointHover(container, viewport, spatial, hitRadiusPx, (idx) => {
          options.onPointHover?.(idx >= 0 ? options.points[idx] : null, idx);
        })
      : () => {};

  return () => {
    unsubClick();
    unsubHover();
    unmountCanvas();
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

  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? 50,
    maxDpr: options.maxDpr ?? 2,
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, _state, cam) => {
      if (!activeImg) return;
      drawImage(ctx, activeImg, bounds, cam, {
        ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
        ...(options.imageSmoothingEnabled !== undefined
          ? { imageSmoothingEnabled: options.imageSmoothingEnabled }
          : {}),
      });
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
  const prepared = prepareArcs(items);
  const count = prepared.items.length;
  const srcXY = new Float32Array(count * 2);
  const dstXY = new Float32Array(count * 2);
  const tmpPt: Point2D = { x: 0, y: 0 };
  const color = options.color ?? '#0ebf9c';
  const sprite = createGlowDotSprite(color, options.dotSize ?? 10);

  const renderer = new CanvasRenderer({
    zIndex: options.zIndex ?? 350,
    maxDpr: options.maxDpr ?? 2,
    ...(options.className ? { className: options.className } : {}),
    onDraw: (ctx, state, cam) => {
      if (count === 0) return;
      for (let i = 0; i < count; i++) {
        const arc = prepared.items[i];
        cam.projectInto(arc.src[0], arc.src[1], tmpPt);
        srcXY[i * 2] = tmpPt.x;
        srcXY[i * 2 + 1] = tmpPt.y;
        cam.projectInto(arc.dst[0], arc.dst[1], tmpPt);
        dstXY[i * 2] = tmpPt.x;
        dstXY[i * 2 + 1] = tmpPt.y;
      }
      drawTrajectories(
        ctx,
        srcXY,
        count,
        dstXY,
        state.width,
        state.height,
        color,
        sprite
      );
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
  element.style.zIndex = String(options.zIndex ?? 500);
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
  const viewport = createViewportFromOptions(options);
  const clickListeners = new Set<(event: MapClickEvent) => void>();
  const cleanups = new Set<() => void>();
  let destroyed = false;

  const subscribeClick = (listener: (event: MapClickEvent) => void) => {
    clickListeners.add(listener);
    return () => {
      clickListeners.delete(listener);
    };
  };

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
      for (const listener of clickListeners) {
        listener(event);
      }
    },
  });

  const detachMove = options.onMove
    ? viewport.subscribe((state) => options.onMove?.(state))
    : () => {};

  let gamepadCleanup: (() => void) | undefined;
  if (options.gamepad && (options.interactive ?? true)) {
    const gpOpts =
      typeof options.gamepad === 'object' ? options.gamepad : undefined;
    void import('./gamepad').then(({ attachGamepad }) => {
      if (!destroyed) {
        gamepadCleanup = attachGamepad(viewport, gpOpts);
      }
    });
  }
  const detachGamepad = () => {
    gamepadCleanup?.();
  };

  const detachZoomControls =
    options.zoomControls && (options.interactive ?? true)
      ? createZoomControlsElement(
          container,
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
    onClick: subscribeClick,
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
    addPointLayer: (opts) =>
      track(mountPointLayer(container, viewport, opts, subscribeClick)),
    addImageLayer: (opts) => track(mountImageLayer(container, viewport, opts)),
    addTrajectoryLayer: (items, opts) =>
      track(mountTrajectoryLayer(container, viewport, items, opts)),
    addOverlay: (el, pos, opts) =>
      track(mountOverlay(container, viewport, el, pos, opts)),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const cleanup of Array.from(cleanups)) {
        cleanup();
      }
      cleanups.clear();
      clickListeners.clear();
      detachZoomControls();
      detachGamepad();
      detachMove();
      detachInteractions();
      viewport.cancelAnimation();
    },
  };
}

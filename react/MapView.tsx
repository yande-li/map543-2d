import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Viewport,
  type ViewportConstraints,
  type ViewportState,
} from '../core/viewport';
import {
  createControlSlots,
  type ControlPosition,
  type ControlSlots,
} from '../core/controls';
import { type MapPointerEvent } from '../core/interactions';
import { type ZoomControlPosition, type ZoomControlsConfig } from '../core/map';
import { Projection, LatLon, ProjectionType } from '../core/projection';
import { attachGamepad } from '../core/gamepad';
import { attachInteractions } from '../core/interactions';
import { MapContextValue, MapProvider, MapClickListener } from './MapContext';
import { MapControl } from './MapControl';

export interface MapViewHandle {
  flyTo: (
    targetCenter: LatLon,
    targetZoom?: number,
    durationMs?: number
  ) => void;
  setView: (center: LatLon, zoom?: number) => void;
  fitBounds: (
    bounds: [LatLon, LatLon],
    paddingPx?: number,
    durationMs?: number
  ) => void;
  getState: () => ViewportState;
  getViewport: () => Viewport;
}

export interface MapViewProps {
  center?: LatLon;
  zoom?: number;
  /** Automatically fit viewport to these geographic bounds on mount and when bounds change. */
  bounds?: [LatLon, LatLon];
  /** Padding in CSS pixels used with `bounds` (default: 0). */
  boundsPaddingPx?: number;
  minZoom?: number;
  maxZoom?: number;
  maxBounds?: [LatLon, LatLon];
  interactive?: boolean;
  /** Enable keyboard pan/zoom when map container is focused (default: false). */
  keyboard?: boolean;
  /** Enable Gamepad API pan/zoom controls when a controller is connected (default: false). */
  gamepad?: boolean;
  /** Unlock flyTo 20 FPS cap for full-framerate viewport animations (default: false). */
  smooth?: boolean;
  /** Accessible label for the interactive map region (default: 'Interactive map'). */
  ariaLabel?: string;
  /** Grouped zoom controls configuration or boolean toggle. */
  zoomControls?: boolean | ZoomControlsConfig;
  zoomDelta?: number;
  /** Optional reference viewport width (CSS px) to scale initial/set zoom proportionally. */
  referenceWidth?: number;
  /** Preserve horizontal geographic span when container width changes on resize. */
  preserveViewportSpan?: boolean;
  /** Map projection ('mercator' | 'equirectangular' | custom Projection). */
  projection?: ProjectionType | Projection;
  className?: string;
  style?: React.CSSProperties;
  /** Callback fired when clicking on the map viewport. */
  onClick?: MapClickListener;
  onMouseMove?: (event: MapPointerEvent) => void;
  onContextMenu?: (event: MapPointerEvent) => void;
  onMoveStart?: (state: ViewportState) => void;
  onMove?: (state: ViewportState) => void;
  /** Debounced callback fired after viewport movement settles. */
  onMoveEnd?: (state: ViewportState) => void;
  onZoomStart?: (state: ViewportState) => void;
  onZoom?: (state: ViewportState) => void;
  onZoomEnd?: (state: ViewportState) => void;
  /** Debounce delay in ms for onMoveEnd (default: 120). */
  moveEndDelayMs?: number;
  /** Sync external center/zoom prop updates to viewport after initial mount. */
  syncViewOnPropsChange?: boolean;
  /** Transition mode when `syncViewOnPropsChange` or `bounds` updates the viewport (default: 'instant'). */
  viewTransition?: 'instant' | 'fly';
  children?: React.ReactNode;
}

interface ZoomControlsProps {
  position: ZoomControlPosition;
  zoomInLabel: string;
  zoomOutLabel: string;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: (e: React.MouseEvent) => void;
  onZoomOut: (e: React.MouseEvent) => void;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({
  position,
  zoomInLabel,
  zoomOutLabel,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
}) => (
  <div
    className={`map-zoom-controls ${position}`}
    onPointerDown={(e) => e.stopPropagation()}
    onDoubleClick={(e) => e.stopPropagation()}
    style={{
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    <button
      type="button"
      className="map-zoom-btn map-zoom-in"
      aria-label={zoomInLabel}
      disabled={!canZoomIn}
      onClick={onZoomIn}
    >
      +
    </button>
    <button
      type="button"
      className="map-zoom-btn map-zoom-out"
      aria-label={zoomOutLabel}
      disabled={!canZoomOut}
      onClick={onZoomOut}
    >
      −
    </button>
  </div>
);

function buildViewportConstraints(opts: {
  minZoom: number;
  maxZoom: number;
  maxBounds: [LatLon, LatLon] | undefined;
  referenceWidth: number | undefined;
  preserveViewportSpan: boolean;
  projection: ProjectionType | Projection | undefined;
  smooth: boolean;
}): ViewportConstraints {
  return {
    minZoom: opts.minZoom,
    maxZoom: opts.maxZoom,
    ...(opts.maxBounds ? { maxBounds: opts.maxBounds } : {}),
    ...(opts.referenceWidth !== undefined
      ? { referenceWidth: opts.referenceWidth }
      : {}),
    preserveViewportSpan: opts.preserveViewportSpan,
    ...(opts.projection !== undefined ? { projection: opts.projection } : {}),
    smooth: opts.smooth,
  };
}

function buildContainerStyle(
  interactive: boolean,
  style?: React.CSSProperties
): React.CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    touchAction: interactive ? 'none' : 'auto',
    userSelect: 'none',
    cursor: interactive ? 'grab' : 'default',
    ...style,
  };
}

function getContainerA11yProps(
  interactive: boolean,
  keyboard: boolean,
  ariaLabel: string
): {
  role?: 'region';
  'aria-label'?: string;
  tabIndex?: number;
} {
  if (!interactive) return {};
  return {
    role: 'region',
    'aria-label': ariaLabel,
    ...(keyboard ? { tabIndex: 0 } : {}),
  };
}

function resolveZoomOpts(
  zoomControls: boolean | ZoomControlsConfig | undefined,
  zoomDelta: number
) {
  const cfg = typeof zoomControls === 'object' ? zoomControls : undefined;
  return {
    enabled: Boolean(zoomControls),
    position: cfg?.position ?? 'bottom-right',
    delta: cfg?.delta ?? zoomDelta,
    inLabel: cfg?.inLabel ?? 'Zoom in',
    outLabel: cfg?.outLabel ?? 'Zoom out',
  };
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(
  (
    {
      center = [0, 0],
      zoom = 3,
      bounds,
      boundsPaddingPx = 0,
      minZoom = 0,
      maxZoom = 10,
      maxBounds,
      interactive = true,
      keyboard = true,
      gamepad = false,
      smooth = false,
      ariaLabel = 'Interactive map',
      zoomControls,
      zoomDelta = 0.5,
      referenceWidth,
      preserveViewportSpan = false,
      projection,
      className = '',
      style,
      onClick,
      onMouseMove,
      onContextMenu,
      onMoveStart,
      onMove,
      onMoveEnd,
      onZoomStart,
      onZoom,
      onZoomEnd,
      moveEndDelayMs = 120,
      syncViewOnPropsChange = false,
      viewTransition = 'instant',
      children,
    },
    ref
  ) => {
    const {
      enabled: resolvedZoomControls,
      position: resolvedPosition,
      delta: resolvedZoomDelta,
      inLabel: resolvedZoomInLabel,
      outLabel: resolvedZoomOutLabel,
    } = resolveZoomOpts(zoomControls, zoomDelta);
    const containerRef = useRef<HTMLDivElement>(null);
    const controlSlotsRef = useRef<ControlSlots | null>(null);
    const clickListenersRef = useRef(new Set<MapClickListener>());
    const cbRef = useRef({
      onClick,
      onMouseMove,
      onContextMenu,
      onMoveStart,
      onMove,
      onMoveEnd,
      onZoomStart,
      onZoom,
      onZoomEnd,
    });
    cbRef.current = {
      onClick,
      onMouseMove,
      onContextMenu,
      onMoveStart,
      onMove,
      onMoveEnd,
      onZoomStart,
      onZoom,
      onZoomEnd,
    };
    const lastSyncedViewRef = useRef<{
      lat: number;
      lon: number;
      zoom: number;
    }>({ lat: center[0], lon: center[1], zoom });

    const [viewport] = useState(
      () =>
        new Viewport({
          center,
          zoom,
          ...buildViewportConstraints({
            minZoom,
            maxZoom,
            maxBounds,
            referenceWidth,
            preserveViewportSpan,
            projection,
            smooth,
          }),
        })
    );

    const isFirstConstraintsMountRef = useRef(true);

    useEffect(() => {
      if (isFirstConstraintsMountRef.current) {
        isFirstConstraintsMountRef.current = false;
        return;
      }
      viewport.setConstraints(
        buildViewportConstraints({
          minZoom,
          maxZoom,
          maxBounds,
          referenceWidth,
          preserveViewportSpan,
          projection,
          smooth,
        })
      );
    }, [
      viewport,
      minZoom,
      maxZoom,
      maxBounds,
      referenceWidth,
      preserveViewportSpan,
      projection,
      smooth,
    ]);

    const [zoomLimits, setZoomLimits] = useState({
      canZoomIn: true,
      canZoomOut: true,
    });

    useImperativeHandle(
      ref,
      () => ({
        flyTo: (targetCenter, targetZoom, durationMs) =>
          viewport.flyTo(targetCenter, targetZoom, durationMs),
        setView: (nextCenter, nextZoom) =>
          viewport.setView(nextCenter, nextZoom),
        fitBounds: (nextBounds, paddingPx, durationMs) =>
          viewport.fitBounds(nextBounds, paddingPx, durationMs),
        getState: () => viewport.getState(),
        getViewport: () => viewport,
      }),
      [viewport]
    );

    useEffect(() => {
      if (!bounds) return;
      viewport.fitBounds(
        bounds,
        boundsPaddingPx,
        viewTransition === 'fly' ? 1500 : 0
      );
    }, [viewport, bounds, boundsPaddingPx, viewTransition]);

    useEffect(() => {
      if (!syncViewOnPropsChange) return;
      if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
      const last = lastSyncedViewRef.current;
      if (
        last.lat === center[0] &&
        last.lon === center[1] &&
        last.zoom === zoom
      ) {
        return;
      }
      lastSyncedViewRef.current = { lat: center[0], lon: center[1], zoom };
      const nextZoom = viewport.getResponsiveZoom(zoom);
      if (viewTransition === 'fly') {
        viewport.flyTo(center, nextZoom);
      } else {
        viewport.setView(center, nextZoom);
      }
    }, [viewport, syncViewOnPropsChange, center, zoom, viewTransition]);

    useEffect(() => {
      const syncZoomLimits = () => {
        if (!resolvedZoomControls || !interactive) return;
        const s = viewport.getState();
        const effectiveMin = viewport.getEffectiveMinZoom();
        const canIn = s.zoom < s.maxZoom - 1e-4;
        const canOut = s.zoom > effectiveMin + 1e-4;
        setZoomLimits((prev) =>
          prev.canZoomIn === canIn && prev.canZoomOut === canOut
            ? prev
            : { canZoomIn: canIn, canZoomOut: canOut }
        );
      };
      if (resolvedZoomControls && interactive) {
        syncZoomLimits();
      }
      const unsubMove = viewport.subscribe((state) => {
        if (resolvedZoomControls && interactive) {
          syncZoomLimits();
        }
        cbRef.current.onMove?.(state);
      });
      const unsubs = [
        unsubMove,
        viewport.on('movestart', (s) => cbRef.current.onMoveStart?.(s)),
        viewport.on('zoomstart', (s) => cbRef.current.onZoomStart?.(s)),
        viewport.on('zoom', (s) => cbRef.current.onZoom?.(s)),
        viewport.on('zoomend', (s) => cbRef.current.onZoomEnd?.(s)),
      ];
      return () => {
        for (const fn of unsubs) fn();
      };
    }, [viewport, resolvedZoomControls, interactive]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      return attachInteractions(el, viewport, {
        interactive,
        keyboard,
        zoomDelta: resolvedZoomDelta,
        observeResize: true,
        moveEndDelayMs,
        onMoveEnd: () => cbRef.current.onMoveEnd?.(viewport.getState()),
        onClick: (event) => {
          cbRef.current.onClick?.(event);
          for (const listener of clickListenersRef.current) {
            listener(event);
          }
        },
        hasMouseMoveListener: () => Boolean(cbRef.current.onMouseMove),
        onMouseMove: (event) => cbRef.current.onMouseMove?.(event),
        onContextMenu: (event) => cbRef.current.onContextMenu?.(event),
      });
    }, [viewport, interactive, keyboard, resolvedZoomDelta, moveEndDelayMs]);

    useEffect(() => {
      if (!gamepad || !interactive) return;
      return attachGamepad(viewport);
    }, [viewport, gamepad, interactive]);

    const subscribeClick = useCallback((listener: MapClickListener) => {
      clickListenersRef.current.add(listener);
      return () => {
        clickListenersRef.current.delete(listener);
      };
    }, []);

    useEffect(() => {
      return () => {
        controlSlotsRef.current?.destroy();
        controlSlotsRef.current = null;
      };
    }, []);

    const getControlSlot = useCallback((position: ControlPosition) => {
      const el = containerRef.current;
      if (!el) return null;
      controlSlotsRef.current ??= createControlSlots(el);
      return controlSlotsRef.current.getSlot(position);
    }, []);

    const releaseControlSlot = useCallback((position: ControlPosition) => {
      controlSlotsRef.current?.releaseSlotIfEmpty(position);
    }, []);

    const contextValue = useMemo<MapContextValue>(
      () => ({
        viewport,
        getContainer: () => containerRef.current,
        subscribeClick,
        getControlSlot,
        releaseControlSlot,
      }),
      [viewport, subscribeClick, getControlSlot, releaseControlSlot]
    );

    const handleZoomIn = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        const s = viewport.getState();
        viewport.zoomAt(
          s.zoom + resolvedZoomDelta,
          s.width * 0.5,
          s.height * 0.5
        );
      },
      [viewport, resolvedZoomDelta]
    );

    const handleZoomOut = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        const s = viewport.getState();
        viewport.zoomAt(
          s.zoom - resolvedZoomDelta,
          s.width * 0.5,
          s.height * 0.5
        );
      },
      [viewport, resolvedZoomDelta]
    );

    return (
      <MapProvider value={contextValue}>
        <div
          ref={containerRef}
          {...getContainerA11yProps(interactive, keyboard, ariaLabel)}
          className={`map-container ${interactive ? 'is-interactive' : 'is-static'} ${className}`.trim()}
          style={buildContainerStyle(interactive, style)}
        >
          {children}
          {resolvedZoomControls && interactive && (
            <MapControl position={resolvedPosition}>
              <ZoomControls
                position={resolvedPosition}
                zoomInLabel={resolvedZoomInLabel}
                zoomOutLabel={resolvedZoomOutLabel}
                canZoomIn={zoomLimits.canZoomIn}
                canZoomOut={zoomLimits.canZoomOut}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
              />
            </MapControl>
          )}
        </div>
      </MapProvider>
    );
  }
);
MapView.displayName = 'MapView';

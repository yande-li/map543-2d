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
import { type ZoomControlPosition, type ZoomControlsConfig } from '../core/map';
import { Projection, LatLon, ProjectionType } from '../core/projection';
import { attachInteractions } from '../core/interactions';
import { MapContextValue, MapProvider, MapClickListener } from './MapContext';

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
  showZoomControls?: boolean;
  zoomControlPosition?: ZoomControlPosition;
  zoomDelta?: number;
  zoomInLabel?: string;
  zoomOutLabel?: string;
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
  onMove?: (state: ViewportState) => void;
  /** Debounced callback fired after viewport movement settles. */
  onMoveEnd?: (state: ViewportState) => void;
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
      position: 'absolute',
      ...(position.startsWith('top-') ? { top: '16px' } : { bottom: '16px' }),
      ...(position.endsWith('-left') ? { left: '16px' } : { right: '16px' }),
      zIndex: 800,
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

function resolveZoomControlsConfig(
  zoomControls: boolean | ZoomControlsConfig | undefined,
  showZoomControls: boolean,
  zoomControlPosition: ZoomControlPosition,
  zoomDelta: number,
  zoomInLabel: string,
  zoomOutLabel: string
) {
  const cfg = typeof zoomControls === 'object' ? zoomControls : undefined;
  return {
    enabled:
      zoomControls !== undefined ? Boolean(zoomControls) : showZoomControls,
    position: cfg?.position ?? zoomControlPosition,
    delta: cfg?.delta ?? zoomDelta,
    inLabel: cfg?.inLabel ?? zoomInLabel,
    outLabel: cfg?.outLabel ?? zoomOutLabel,
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
      keyboard = false,
      gamepad = false,
      smooth = false,
      ariaLabel = 'Interactive map',
      zoomControls,
      showZoomControls = false,
      zoomControlPosition = 'bottom-right',
      zoomDelta = 0.5,
      zoomInLabel = 'Zoom in',
      zoomOutLabel = 'Zoom out',
      referenceWidth,
      preserveViewportSpan = false,
      projection,
      className = '',
      style,
      onClick,
      onMove,
      onMoveEnd,
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
    } = resolveZoomControlsConfig(
      zoomControls,
      showZoomControls,
      zoomControlPosition,
      zoomDelta,
      zoomInLabel,
      zoomOutLabel
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const clickListenersRef = useRef(new Set<MapClickListener>());
    const onClickRef = useRef(onClick);
    const onMoveRef = useRef(onMove);
    const onMoveEndRef = useRef(onMoveEnd);
    onClickRef.current = onClick;
    onMoveRef.current = onMove;
    onMoveEndRef.current = onMoveEnd;
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
      return viewport.subscribe((state) => {
        if (resolvedZoomControls && interactive) {
          syncZoomLimits();
        }
        onMoveRef.current?.(state);
      });
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
        onMoveEnd: () => onMoveEndRef.current?.(viewport.getState()),
        onClick: (event) => {
          onClickRef.current?.(event);
          for (const listener of clickListenersRef.current) {
            listener(event);
          }
        },
      });
    }, [viewport, interactive, keyboard, resolvedZoomDelta, moveEndDelayMs]);

    useEffect(() => {
      if (!gamepad || !interactive) return;
      let cleanup: (() => void) | undefined;
      let unmounted = false;

      import('../core/gamepad').then(({ attachGamepad }) => {
        if (!unmounted) {
          cleanup = attachGamepad(viewport);
        }
      });

      return () => {
        unmounted = true;
        cleanup?.();
      };
    }, [viewport, gamepad, interactive]);

    const subscribeClick = useCallback((listener: MapClickListener) => {
      clickListenersRef.current.add(listener);
      return () => {
        clickListenersRef.current.delete(listener);
      };
    }, []);

    const contextValue = useMemo<MapContextValue>(
      () => ({
        viewport,
        getContainer: () => containerRef.current,
        subscribeClick,
      }),
      [viewport, subscribeClick]
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
            <ZoomControls
              position={resolvedPosition}
              zoomInLabel={resolvedZoomInLabel}
              zoomOutLabel={resolvedZoomOutLabel}
              canZoomIn={zoomLimits.canZoomIn}
              canZoomOut={zoomLimits.canZoomOut}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
            />
          )}
        </div>
      </MapProvider>
    );
  }
);
MapView.displayName = 'MapView';

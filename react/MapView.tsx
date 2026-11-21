import React, {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
} from 'react';
import { Camera, type CameraConstraints } from '../core/camera';
import { Projection, LatLng, ProjectionType } from '../core/projection';
import { ZoomControlPosition } from '../core/vectorLod';
import { attachInteractions } from '../core/interactions';
import { MapContextValue, MapProvider, MapClickListener } from './MapContext';

export interface MapViewProps {
  center?: LatLng;
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  maxBounds?: [LatLng, LatLng];
  interactive?: boolean;
  /** Enable keyboard pan/zoom when map container is focused (default: true). */
  keyboard?: boolean;
  /** Enable Gamepad API pan/zoom controls when a controller is connected (default: false). */
  gamepad?: boolean;
  /** Unlock flyTo 20 FPS cap for full-framerate camera animations (default: false). */
  smooth?: boolean;
  /** Accessible label for the interactive map region (default: 'Interactive map'). */
  ariaLabel?: string;
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
  onMove?: () => void;
  /** Debounced callback fired after camera movement settles. */
  onMoveEnd?: () => void;
  /** Debounce delay in ms for onMoveEnd (default: 120). */
  moveEndDelayMs?: number;
  /** Sync external center/zoom prop updates to camera after initial mount. */
  syncViewOnPropsChange?: boolean;
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
    className={`geo-zoom-controls ${position}`}
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
      className="geo-zoom-btn geo-zoom-in"
      aria-label={zoomInLabel}
      disabled={!canZoomIn}
      onClick={onZoomIn}
    >
      +
    </button>
    <button
      type="button"
      className="geo-zoom-btn geo-zoom-out"
      aria-label={zoomOutLabel}
      disabled={!canZoomOut}
      onClick={onZoomOut}
    >
      −
    </button>
  </div>
);

function buildCameraConstraints(opts: {
  minZoom: number;
  maxZoom: number;
  maxBounds: [LatLng, LatLng] | undefined;
  referenceWidth: number | undefined;
  preserveViewportSpan: boolean;
  projection: ProjectionType | Projection | undefined;
  smooth: boolean;
}): CameraConstraints {
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

export const MapView: React.FC<MapViewProps> = ({
  center = [0, 0],
  zoom = 3,
  minZoom = 0,
  maxZoom = 10,
  maxBounds,
  interactive = true,
  keyboard = true,
  gamepad = false,
  smooth = false,
  ariaLabel = 'Interactive map',
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
  children,
}) => {
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

  const [camera] = useState(
    () =>
      new Camera({
        center,
        zoom,
        ...buildCameraConstraints({
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
    camera.setConstraints(
      buildCameraConstraints({
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
    camera,
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
    camera.setView(center, camera.getResponsiveZoom(zoom));
  }, [camera, syncViewOnPropsChange, center, zoom]);

  useEffect(() => {
    const syncZoomLimits = () => {
      if (!showZoomControls || !interactive) return;
      const s = camera.getState();
      const effectiveMin = camera.getEffectiveMinZoom();
      const canIn = s.zoom < s.maxZoom - 1e-4;
      const canOut = s.zoom > effectiveMin + 1e-4;
      setZoomLimits((prev) =>
        prev.canZoomIn === canIn && prev.canZoomOut === canOut
          ? prev
          : { canZoomIn: canIn, canZoomOut: canOut }
      );
    };
    if (showZoomControls && interactive) {
      syncZoomLimits();
    }
    return camera.subscribe(() => {
      if (showZoomControls && interactive) {
        syncZoomLimits();
      }
      onMoveRef.current?.();
    });
  }, [camera, showZoomControls, interactive]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return attachInteractions(el, camera, {
      interactive,
      keyboard,
      zoomDelta,
      observeResize: true,
      moveEndDelayMs,
      onMoveEnd: () => onMoveEndRef.current?.(),
      onClick: (event) => {
        onClickRef.current?.(event);
        for (const listener of clickListenersRef.current) {
          listener(event);
        }
      },
    });
  }, [camera, interactive, keyboard, zoomDelta, moveEndDelayMs]);

  useEffect(() => {
    if (!gamepad || !interactive) return;
    let cleanup: (() => void) | undefined;
    let unmounted = false;

    import('../core/gamepad').then(({ attachGamepad }) => {
      if (!unmounted) {
        cleanup = attachGamepad(camera);
      }
    });

    return () => {
      unmounted = true;
      cleanup?.();
    };
  }, [camera, gamepad, interactive]);

  const subscribeClick = useCallback((listener: MapClickListener) => {
    clickListenersRef.current.add(listener);
    return () => {
      clickListenersRef.current.delete(listener);
    };
  }, []);

  const contextValue = useMemo<MapContextValue>(
    () => ({
      camera,
      getContainer: () => containerRef.current,
      subscribeClick,
    }),
    [camera, subscribeClick]
  );

  const handleZoomIn = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const s = camera.getState();
      camera.zoomAt(s.zoom + zoomDelta, s.width * 0.5, s.height * 0.5);
    },
    [camera, zoomDelta]
  );

  const handleZoomOut = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const s = camera.getState();
      camera.zoomAt(s.zoom - zoomDelta, s.width * 0.5, s.height * 0.5);
    },
    [camera, zoomDelta]
  );

  return (
    <MapProvider value={contextValue}>
      <div
        ref={containerRef}
        {...getContainerA11yProps(interactive, keyboard, ariaLabel)}
        className={`geo-map-container ${interactive ? 'is-interactive' : 'is-static'} ${className}`.trim()}
        style={buildContainerStyle(interactive, style)}
      >
        {children}
        {showZoomControls && interactive && (
          <ZoomControls
            position={zoomControlPosition}
            zoomInLabel={zoomInLabel}
            zoomOutLabel={zoomOutLabel}
            canZoomIn={zoomLimits.canZoomIn}
            canZoomOut={zoomLimits.canZoomOut}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
          />
        )}
      </div>
    </MapProvider>
  );
};

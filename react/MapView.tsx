import React, {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
} from 'react';
import { Camera } from '../core/camera';
import {
  Projection,
  LatLng,
  ProjectionType,
} from '../core/projection';
import { ZoomControlPosition } from '../core/vectorLod';
import { attachViewportInteractions } from '../core/interactions';
import {
  MapContextValue,
  MapProvider,
  MapClickListener,
} from './MapContext';

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
  /** Unlock flyTo 20 FPS cap for smooth 60/120Hz camera animations (default: false). */
  unlockFps?: boolean;
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
  onMove?: () => void;
  /** Debounced callback fired after camera movement settles. */
  onMoveEnd?: () => void;
  /** Debounce delay in ms for onMoveEnd (default: 120). */
  moveEndDelayMs?: number;
  /** Sync external center/zoom prop updates to camera after initial mount. */
  syncViewOnPropsChange?: boolean;
  children?: React.ReactNode;
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
  unlockFps = false,
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
  onMove,
  onMoveEnd,
  moveEndDelayMs = 120,
  syncViewOnPropsChange = false,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const clickListenersRef = useRef(new Set<MapClickListener>());
  const onMoveRef = useRef(onMove);
  const onMoveEndRef = useRef(onMoveEnd);
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
        minZoom,
        maxZoom,
        ...(maxBounds ? { maxBounds } : {}),
        ...(referenceWidth !== undefined ? { referenceWidth } : {}),
        preserveViewportSpan,
        ...(projection !== undefined ? { projection } : {}),
        unlockFps,
      })
  );

  // Sync constraints without recreating camera
  useEffect(() => {
    camera.setConstraints({
      minZoom,
      maxZoom,
      ...(maxBounds ? { maxBounds } : {}),
      ...(referenceWidth !== undefined ? { referenceWidth } : {}),
      preserveViewportSpan,
      ...(projection !== undefined ? { projection } : {}),
      unlockFps,
    });
  }, [
    camera,
    minZoom,
    maxZoom,
    maxBounds,
    referenceWidth,
    preserveViewportSpan,
    projection,
    unlockFps,
  ]);

  const [zoomLimits, setZoomLimits] = useState({
    canZoomIn: true,
    canZoomOut: true,
  });

  // Optional controlled center/zoom prop synchronization
  useEffect(() => {
    if (!syncViewOnPropsChange) return;
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
    const last = lastSyncedViewRef.current;
    if (last.lat === center[0] && last.lon === center[1] && last.zoom === zoom) {
      return;
    }
    lastSyncedViewRef.current = { lat: center[0], lon: center[1], zoom };
    camera.setView(center, camera.getResponsiveZoom(zoom));
  }, [camera, syncViewOnPropsChange, center, zoom]);

  // Subscribe onMove / onMoveEnd callbacks & zoom button disabled state (skip zoom-limit work when controls are disabled)
  useEffect(() => {
    let moveEndTimer: ReturnType<typeof setTimeout> | null = null;
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
    const unsubscribe = camera.subscribe(() => {
      if (showZoomControls && interactive) {
        syncZoomLimits();
      }
      onMoveRef.current?.();
      if (onMoveEndRef.current) {
        if (moveEndTimer !== null) clearTimeout(moveEndTimer);
        moveEndTimer = setTimeout(() => {
          moveEndTimer = null;
          onMoveEndRef.current?.();
        }, moveEndDelayMs);
      }
    });
    return () => {
      unsubscribe();
      if (moveEndTimer !== null) clearTimeout(moveEndTimer);
    };
  }, [camera, showZoomControls, interactive, moveEndDelayMs]);

  // Attach framework-agnostic DOM viewport interactions (ResizeObserver, wheel, drag, pinch, dblclick, click)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return attachViewportInteractions(el, camera, {
      interactive,
      keyboard,
      zoomDelta,
      observeResize: true,
      onClick: (px, py, latLng) => {
        for (const listener of clickListenersRef.current) {
          listener(px, py, latLng);
        }
      },
    });
  }, [camera, interactive, keyboard, zoomDelta]);

  useEffect(() => {
    if (!gamepad || !interactive) return;
    let cleanup: (() => void) | undefined;
    let unmounted = false;

    import('../core/gamepad').then(({ attachGamepadControls }) => {
      if (!unmounted) {
        cleanup = attachGamepadControls(camera);
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
        role={interactive ? 'region' : undefined}
        aria-label={interactive ? ariaLabel : undefined}
        tabIndex={interactive && keyboard ? 0 : undefined}
        className={`geo-map-container ${interactive ? 'is-interactive' : 'is-static'} ${className}`}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          touchAction: interactive ? 'none' : 'auto',
          userSelect: 'none',
          cursor: interactive ? 'grab' : 'default',
          ...style,
        }}
      >
        {children}
        {showZoomControls && interactive && (
          <div
            className={`geo-zoom-controls ${zoomControlPosition}`}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              ...(zoomControlPosition.startsWith('top-')
                ? { top: '16px' }
                : { bottom: '16px' }),
              ...(zoomControlPosition.endsWith('-left')
                ? { left: '16px' }
                : { right: '16px' }),
              zIndex: 800,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <button
              type="button"
              className="geo-zoom-btn geo-zoom-in"
              aria-label={zoomInLabel}
              disabled={!zoomLimits.canZoomIn}
              onClick={handleZoomIn}
            >
              +
            </button>
            <button
              type="button"
              className="geo-zoom-btn geo-zoom-out"
              aria-label={zoomOutLabel}
              disabled={!zoomLimits.canZoomOut}
              onClick={handleZoomOut}
            >
              −
            </button>
          </div>
        )}
      </div>
    </MapProvider>
  );
};

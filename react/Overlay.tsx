import React, { useEffect, useRef, useState } from 'react';
import { MAP_Z_INDEX } from '../core/controls';
import { type LatLon } from '../core/projection';
import { resolveLatLon, useMap } from './MapContext';

export interface OverlayProps {
  /** Geographic position as [lat, lon] tuple (or pass `lat` and `lon`). */
  position?: LatLon;
  lat?: number;
  lon?: number;
  zIndex?: number;
  anchor?: [number, number]; // [0.5, 0.5] = center, [0.5, 1] = bottom-center
  /** Optional known [width, height] in CSS pixels for fixed-size markers. */
  fixedSize?: [number, number];
  /** Hide DOM overlay when outside the viewport (default: true). */
  cullOffscreen?: boolean;
  /** Extra margin in CSS pixels around viewport edges before culling (default: 64). */
  cullMarginPx?: number;
  className?: string;
  interactive?: boolean;
  cursor?: React.CSSProperties['cursor'];
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}

/**
 * Positions React UI at [lat, lon] using CSS transforms synchronized with Viewport.
 */
export const Overlay: React.FC<OverlayProps> = ({
  position,
  lat,
  lon,
  zIndex = MAP_Z_INDEX.overlay,
  anchor = [0.5, 0.5],
  fixedSize,
  cullOffscreen = true,
  cullMarginPx = 64,
  className = '',
  interactive = false,
  cursor,
  onClick,
  children,
}) => {
  const { viewport } = useMap();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [resolvedLat, resolvedLon] = resolveLatLon(position, lat, lon);
  const anchorX = anchor[0];
  const anchorY = anchor[1];
  const fixedW = fixedSize?.[0];
  const fixedH = fixedSize?.[1];

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const hasFixedSize = fixedW !== undefined && fixedH !== undefined;
    let cachedWidth = hasFixedSize ? fixedW : el.offsetWidth;
    let cachedHeight = hasFixedSize ? fixedH : el.offsetHeight;
    const pt = { x: 0, y: 0 };
    let lastDisplay = '';
    let lastX = Number.NaN;
    let lastY = Number.NaN;

    const setHidden = () => {
      if (lastDisplay !== 'none') {
        lastDisplay = 'none';
        el.style.display = 'none';
      }
    };

    const updatePosition = () => {
      if (!Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLon)) {
        setHidden();
        return;
      }
      viewport.projectInto(resolvedLat, resolvedLon, pt);
      const ox = Math.round(-anchorX * cachedWidth);
      const oy = Math.round(-anchorY * cachedHeight);
      const x = Math.round(pt.x) + ox;
      const y = Math.round(pt.y) + oy;
      if (cullOffscreen) {
        const s = viewport.getState();
        if (
          s.width > 0 &&
          s.height > 0 &&
          (x + cachedWidth < -cullMarginPx ||
            x > s.width + cullMarginPx ||
            y + cachedHeight < -cullMarginPx ||
            y > s.height + cullMarginPx)
        ) {
          setHidden();
          return;
        }
      }
      if (lastDisplay !== 'block') {
        lastDisplay = 'block';
        el.style.display = 'block';
      }
      if (x !== lastX || y !== lastY) {
        lastX = x;
        lastY = y;
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
    };

    updatePosition();
    const unsubscribe = viewport.subscribe(updatePosition);
    const resizeObserver =
      !hasFixedSize && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            cachedWidth = el.offsetWidth;
            cachedHeight = el.offsetHeight;
            updatePosition();
          })
        : null;
    if (resizeObserver) {
      resizeObserver.observe(el);
    }

    return () => {
      unsubscribe();
      resizeObserver?.disconnect();
    };
  }, [
    viewport,
    resolvedLat,
    resolvedLon,
    anchorX,
    anchorY,
    fixedW,
    fixedH,
    cullOffscreen,
    cullMarginPx,
  ]);

  return (
    <div
      ref={wrapperRef}
      className={className}
      onClick={onClick}
      onPointerDown={interactive ? (e) => e.stopPropagation() : undefined}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        ...(fixedW !== undefined && fixedH !== undefined
          ? { width: `${fixedW}px`, height: `${fixedH}px` }
          : {}),
        zIndex,
        contain: 'layout style',
        pointerEvents: interactive ? 'auto' : 'none',
        ...(cursor !== undefined
          ? { cursor }
          : interactive
            ? { cursor: 'var(--map543-overlay-cursor, pointer)' }
            : {}),
      }}
    >
      {children}
    </div>
  );
};

export interface PopupProps {
  /** Geographic position as [lat, lon] tuple (or pass `lat` and `lon`). */
  position?: LatLon;
  lat?: number;
  lon?: number;
  maxWidth?: number;
  zIndex?: number;
  className?: string;
  style?: React.CSSProperties;
  onClose?: () => void;
  children?: React.ReactNode;
}

/**
 * Lightweight popup anchored above [lat, lon] (auto-flips below near top edge).
 */
export const Popup: React.FC<PopupProps> = ({
  position,
  lat,
  lon,
  maxWidth = 260,
  zIndex = MAP_Z_INDEX.popup,
  className = '',
  style,
  onClose,
  children,
}) => {
  const { viewport } = useMap();
  const [flipped, setFlipped] = useState(false);
  const [resolvedLat, resolvedLon] = resolveLatLon(position, lat, lon);

  useEffect(() => {
    if (!onClose || typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const pt = { x: 0, y: 0 };
    const checkFlip = () => {
      if (!Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLon)) {
        return;
      }
      const state = viewport.getState();
      if (state.height <= 0) return;
      viewport.projectInto(resolvedLat, resolvedLon, pt);
      const shouldFlip = pt.y < 140 && state.height - pt.y > pt.y;
      setFlipped((prev) => (prev === shouldFlip ? prev : shouldFlip));
    };

    checkFlip();
    return viewport.subscribe(checkFlip);
  }, [viewport, resolvedLat, resolvedLon]);

  return (
    <Overlay
      lat={resolvedLat}
      lon={resolvedLon}
      zIndex={zIndex}
      anchor={flipped ? [0.5, 0] : [0.5, 1]}
      interactive={true}
    >
      <div
        className={`map-popup-wrapper ${flipped ? 'is-flipped' : ''}`}
        style={{
          position: 'relative',
          ...(flipped ? { paddingTop: '7px' } : { paddingBottom: '7px' }),
        }}
      >
        <div
          className={`map-popup ${className}`.trim()}
          style={{
            width: 'max-content',
            minWidth: `${Math.min(180, maxWidth)}px`,
            maxWidth: `${maxWidth}px`,
            maxHeight: '260px',
            overflowY: 'auto',
            boxSizing: 'border-box',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(18, 22, 30, 0.96)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            color: '#f1f5f9',
            fontSize: '12.5px',
            lineHeight: 1.35,
            position: 'relative',
            zIndex: 2,
            ...style,
          }}
        >
          {children}
        </div>
        <div
          className="map-popup-tip"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            ...(flipped
              ? {
                  top: '2px',
                  borderLeft: '1px solid rgba(255, 255, 255, 0.16)',
                  borderTop: '1px solid rgba(255, 255, 255, 0.16)',
                }
              : {
                  bottom: '2px',
                  borderRight: '1px solid rgba(255, 255, 255, 0.16)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.16)',
                }),
            width: '10px',
            height: '10px',
            background: 'rgba(18, 22, 30, 0.96)',
            transform: 'translateX(-50%) rotate(45deg)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      </div>
    </Overlay>
  );
};

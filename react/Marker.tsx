import React, { memo, useEffect, useState } from 'react';
import { resolveAnimationEasing } from '../core/animation';
import { MAP_Z_INDEX } from '../core/controls';
import {
  type MarkerPulse,
  type MarkerVariant,
  ensureMarkerStyles,
  normalizePulseMode,
  resolveMarkerGeometry,
} from '../core/marker';
import { type LatLon } from '../core/projection';
import { Overlay, Popup } from './Overlay';

export type { MarkerVariant, MarkerPulse };

export interface MarkerProps {
  /** Geographic position as [lat, lon] tuple (or pass `lat` and `lon`). */
  position?: LatLon;
  lat?: number;
  lon?: number;
  variant?: MarkerVariant;
  size?: number;
  color?: string;
  borderColor?: string;
  iconColor?: string;
  pulse?: MarkerPulse;
  pulseColor?: string;
  /** Repeat pulse animation continuously instead of playing a finite number of times (default: false). */
  pulseLoop?: boolean;
  glow?: boolean;
  intensity?: number;
  delayMs?: number;
  fadeMs?: number;
  dropIn?: boolean;
  /** Target frame rate in FPS for stepped marker animations (default: unthrottled; e.g. 15 for stepped). */
  fps?: number;
  zIndex?: number;
  interactive?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  title?: string;
  /** Optional popup content toggled automatically when clicking the marker. */
  popup?: React.ReactNode;
  defaultPopupOpen?: boolean;
  children?: React.ReactNode;
}

const FLEX_CENTER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function makeGlowShadow(
  glow: boolean,
  quantizedIntensity: number,
  resolvedColor: string,
  fallback?: string
): string | undefined {
  return glow
    ? `0 0 ${Math.round(5 * quantizedIntensity)}px ${Math.round(2 * quantizedIntensity)}px ${resolvedColor}`
    : fallback;
}

interface ResolvedMarker {
  variant: MarkerVariant;
  isPin: boolean;
  lat: number;
  lon: number;
  geom: ReturnType<typeof resolveMarkerGeometry>;
  color: string;
  borderColor: string;
  iconColor: string;
  glow: boolean;
  quantizedIntensity: number;
  dropIn: boolean;
  fps: number | undefined;
  zIndex: number;
  isInteractive: boolean;
  wrapperStyle: React.CSSProperties;
  pulseClassName: string;
  pulseCssVars: React.CSSProperties | undefined;
}

function renderPinMarker(
  m: ResolvedMarker,
  children: React.ReactNode
): React.ReactNode {
  const iconSize = Math.round(m.geom.size * 0.67);
  return (
    <div
      className={m.pulseClassName || undefined}
      style={{
        ...FLEX_CENTER,
        width: `${m.geom.size}px`,
        height: `${m.geom.size}px`,
        boxSizing: 'border-box',
        pointerEvents: m.isInteractive ? 'auto' : 'none',
        background: m.color,
        border: `2px solid ${m.borderColor}`,
        boxShadow: makeGlowShadow(
          m.glow,
          m.quantizedIntensity,
          m.color,
          '0 2px 6px rgba(0, 0, 0, 0.35)'
        ),
        borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)',
        color: m.iconColor,
        zIndex: 2,
        ...m.pulseCssVars,
      }}
    >
      <div
        style={{
          ...FLEX_CENTER,
          transform: 'rotate(45deg)',
          backfaceVisibility: 'hidden',
        }}
      >
        {children ?? (
          <svg
            width={iconSize}
            height={iconSize}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
          </svg>
        )}
      </div>
    </div>
  );
}

function renderCircleMarker(m: ResolvedMarker): React.ReactNode {
  const border =
    m.variant === 'ring'
      ? `2px solid ${m.color}`
      : m.borderColor !== 'none'
        ? `1.5px solid ${m.borderColor}`
        : undefined;
  return (
    <div
      className={m.pulseClassName || undefined}
      style={{
        position: 'relative',
        width: `${m.geom.size}px`,
        height: `${m.geom.size}px`,
        borderRadius: '50%',
        boxSizing: 'border-box',
        background: m.variant === 'ring' ? 'transparent' : m.color,
        border,
        boxShadow: makeGlowShadow(m.glow, m.quantizedIntensity, m.color),
        transform:
          m.quantizedIntensity !== 1
            ? `scale(${m.quantizedIntensity})`
            : undefined,
        pointerEvents: m.isInteractive ? 'auto' : 'none',
        ...m.pulseCssVars,
      }}
    />
  );
}

function buildMarkerVisuals(
  props: MarkerProps,
  isPin: boolean,
  geom: ReturnType<typeof resolveMarkerGeometry>,
  color: string
): Pick<ResolvedMarker, 'wrapperStyle' | 'pulseClassName' | 'pulseCssVars'> {
  const pulseMode = normalizePulseMode(props.pulse ?? false);
  const fadeAnimation = props.fadeMs
    ? `map-marker-fade ${props.fadeMs}ms ${resolveAnimationEasing(props.fadeMs, props.fps, 'linear')} forwards`
    : undefined;

  const wrapperStyle: React.CSSProperties = {
    width: `${geom.boxSize}px`,
    height: `${geom.boxSize}px`,
    display: 'flex',
    alignItems: isPin ? 'flex-end' : 'center',
    justifyContent: 'center',
    paddingBottom:
      geom.pinPaddingBottom > 0 ? `${geom.pinPaddingBottom}px` : undefined,
    boxSizing: 'border-box',
    position: 'relative',
    ...(fadeAnimation ? { animation: fadeAnimation } : {}),
  };

  if (!pulseMode) {
    return { wrapperStyle, pulseClassName: '', pulseCssVars: undefined };
  }

  const pulseDurationMs = pulseMode === 'ripple' ? 2400 : 1800;
  const pulseEasing = resolveAnimationEasing(
    pulseDurationMs,
    props.fps,
    'ease-out'
  );

  return {
    wrapperStyle,
    pulseClassName: `map-marker-pulse map-marker-pulse--${pulseMode}${props.pulseLoop ? ' map-marker-pulse--loop' : ''}`,
    pulseCssVars: {
      '--map-pulse-color': props.pulseColor ?? color,
      '--map-pulse-delay': `${props.delayMs ?? 0}ms`,
      '--map-pulse-easing': pulseEasing,
    } as React.CSSProperties,
  };
}

function resolveMarkerConfig(props: MarkerProps): ResolvedMarker {
  const variant = props.variant ?? 'pin';
  const isPin = variant === 'pin';
  const geom = resolveMarkerGeometry(variant, props.size);
  const color = props.color ?? (isPin ? '#007aff' : '#0ebf9c');
  const borderColor =
    props.borderColor ?? (variant === 'ring' ? color : '#ffffff');

  return {
    variant,
    isPin,
    lat: props.position?.[0] ?? props.lat ?? Number.NaN,
    lon: props.position?.[1] ?? props.lon ?? Number.NaN,
    geom,
    color,
    borderColor,
    iconColor: props.iconColor ?? '#ffffff',
    glow: props.glow ?? false,
    quantizedIntensity: Math.max(
      0.5,
      Math.round((props.intensity ?? 1) * 10) / 10
    ),
    dropIn: props.dropIn ?? false,
    fps: props.fps,
    zIndex: props.zIndex ?? MAP_Z_INDEX.overlay,
    isInteractive: Boolean(props.interactive) || props.popup !== undefined,
    ...buildMarkerVisuals(props, isPin, geom, color),
  };
}

/**
 * React wrapper around core marker geometry and Overlay.
 */
export const Marker: React.FC<MarkerProps> = memo((props) => {
  const {
    onClick,
    className,
    title,
    popup,
    defaultPopupOpen = false,
    children,
  } = props;
  const [popupOpen, setPopupOpen] = useState(defaultPopupOpen);
  useEffect(() => {
    ensureMarkerStyles();
  }, []);

  const hasPopup = popup !== undefined;
  const m = resolveMarkerConfig(props);
  const handleClick =
    onClick || hasPopup
      ? (e: React.MouseEvent<HTMLDivElement>) => {
          if (hasPopup) setPopupOpen((prev) => !prev);
          onClick?.(e);
        }
      : undefined;

  const coreNode = m.isPin
    ? renderPinMarker(m, children)
    : renderCircleMarker(m);

  return (
    <>
      <Overlay
        lat={m.lat}
        lon={m.lon}
        zIndex={m.zIndex}
        anchor={m.geom.anchor}
        fixedSize={[m.geom.boxSize, m.geom.boxSize]}
        interactive={m.isInteractive}
        {...(className ? { className } : {})}
        {...(handleClick ? { onClick: handleClick } : {})}
      >
        <div style={m.wrapperStyle} title={title}>
          {m.dropIn ? (
            <div
              style={{
                animation: `map-marker-drop 0.8s ${resolveAnimationEasing(800, m.fps, 'cubic-bezier(0.3, 0, 0.2, 1)')} forwards`,
              }}
            >
              {coreNode}
            </div>
          ) : (
            coreNode
          )}
        </div>
      </Overlay>
      {hasPopup && popupOpen && (
        <Popup lat={m.lat} lon={m.lon} onClose={() => setPopupOpen(false)}>
          {popup}
        </Popup>
      )}
    </>
  );
});
Marker.displayName = 'Marker';

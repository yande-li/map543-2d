import React, { memo, useEffect, useState } from 'react';
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
  lowPower?: boolean;
  /** Unlock 8fps/15fps stepped easing for full-framerate smooth marker animations (default: false). */
  smooth?: boolean;
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

function renderPinMarker(
  resolvedSize: number,
  resolvedColor: string,
  resolvedBorder: string,
  iconColor: string,
  interactive: boolean,
  glow: boolean,
  quantizedIntensity: number,
  pulseClassName: string,
  pulseCssVars: React.CSSProperties | undefined,
  children: React.ReactNode
): React.ReactNode {
  const iconSize = Math.round(resolvedSize * 0.67);
  return (
    <div
      className={pulseClassName || undefined}
      style={{
        ...FLEX_CENTER,
        width: `${resolvedSize}px`,
        height: `${resolvedSize}px`,
        boxSizing: 'border-box',
        pointerEvents: interactive ? 'auto' : 'none',
        background: resolvedColor,
        border: `2px solid ${resolvedBorder}`,
        boxShadow: makeGlowShadow(
          glow,
          quantizedIntensity,
          resolvedColor,
          '0 2px 6px rgba(0, 0, 0, 0.35)'
        ),
        borderRadius: '50% 50% 50% 0',
        transform: 'rotate(-45deg)',
        color: iconColor,
        zIndex: 2,
        ...pulseCssVars,
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

function renderCircleMarker(
  variant: MarkerVariant,
  resolvedSize: number,
  resolvedColor: string,
  resolvedBorder: string,
  interactive: boolean,
  glow: boolean,
  quantizedIntensity: number,
  pulseClassName: string,
  pulseCssVars: React.CSSProperties | undefined
): React.ReactNode {
  const border =
    variant === 'ring'
      ? `2px solid ${resolvedColor}`
      : resolvedBorder !== 'none'
        ? `1.5px solid ${resolvedBorder}`
        : undefined;
  return (
    <div
      className={pulseClassName || undefined}
      style={{
        position: 'relative',
        width: `${resolvedSize}px`,
        height: `${resolvedSize}px`,
        borderRadius: '50%',
        boxSizing: 'border-box',
        background: variant === 'ring' ? 'transparent' : resolvedColor,
        border,
        boxShadow: makeGlowShadow(glow, quantizedIntensity, resolvedColor),
        transform:
          quantizedIntensity !== 1 ? `scale(${quantizedIntensity})` : undefined,
        pointerEvents: interactive ? 'auto' : 'none',
        ...pulseCssVars,
      }}
    />
  );
}

function buildMarkerStyleProps(
  variant: MarkerVariant,
  geom: ReturnType<typeof resolveMarkerGeometry>,
  color: string | undefined,
  borderColor: string | undefined,
  pulse: MarkerPulse,
  pulseColor: string | undefined,
  pulseLoop: boolean,
  delayMs: number,
  fadeMs: number | undefined,
  lowPower: boolean,
  smooth: boolean
) {
  const isPin = variant === 'pin';
  const resolvedColor = color ?? (isPin ? '#007aff' : '#0ebf9c');
  const resolvedBorder =
    borderColor ?? (variant === 'ring' ? resolvedColor : '#ffffff');
  const pulseMode = normalizePulseMode(pulse);
  const showPulse = Boolean(pulseMode && !lowPower);

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
    ...(fadeMs && !lowPower
      ? {
          animation: `map-marker-fade ${fadeMs}ms ${smooth ? 'linear' : 'steps(8, end)'} forwards`,
        }
      : {}),
  };

  const pulseClassName = showPulse
    ? `map-marker-pulse map-marker-pulse--${pulseMode}${pulseLoop ? ' map-marker-pulse--loop' : ''}${smooth ? ' map-marker-pulse--smooth' : ''}`
    : '';
  const pulseCssVars = showPulse
    ? ({
        '--map-pulse-color': pulseColor ?? resolvedColor,
        '--map-pulse-delay': `${delayMs}ms`,
      } as React.CSSProperties)
    : undefined;

  return {
    isPin,
    resolvedColor,
    resolvedBorder,
    wrapperStyle,
    pulseClassName,
    pulseCssVars,
  };
}

function renderMarkerCore(
  isPin: boolean,
  variant: MarkerVariant,
  resolvedSize: number,
  resolvedColor: string,
  resolvedBorder: string,
  iconColor: string,
  isInteractive: boolean,
  glow: boolean,
  quantizedIntensity: number,
  pulseClassName: string,
  pulseCssVars: React.CSSProperties | undefined,
  children: React.ReactNode
): React.ReactNode {
  if (isPin) {
    return renderPinMarker(
      resolvedSize,
      resolvedColor,
      resolvedBorder,
      iconColor,
      isInteractive,
      glow,
      quantizedIntensity,
      pulseClassName,
      pulseCssVars,
      children
    );
  }
  return renderCircleMarker(
    variant,
    resolvedSize,
    resolvedColor,
    resolvedBorder,
    isInteractive,
    glow,
    quantizedIntensity,
    pulseClassName,
    pulseCssVars
  );
}

function renderMarkerWrapper(
  dropIn: boolean,
  lowPower: boolean,
  smooth: boolean,
  coreNode: React.ReactNode
): React.ReactNode {
  if (!dropIn || lowPower) return coreNode;
  return (
    <div
      style={{
        animation: smooth
          ? 'map-marker-drop 0.8s cubic-bezier(0.3, 0, 0.2, 1) forwards'
          : 'map-marker-drop 0.8s steps(12, end) forwards',
      }}
    >
      {coreNode}
    </div>
  );
}

function resolveMarkerDefaults(props: MarkerProps) {
  const variant = props.variant ?? 'pin';
  const resolvedLat = props.position?.[0] ?? props.lat ?? Number.NaN;
  const resolvedLon = props.position?.[1] ?? props.lon ?? Number.NaN;
  const geom = resolveMarkerGeometry(variant, props.size);
  const quantizedIntensity = Math.max(
    0.5,
    Math.round((props.intensity ?? 1) * 10) / 10
  );
  const styleProps = buildMarkerStyleProps(
    variant,
    geom,
    props.color,
    props.borderColor,
    props.pulse ?? false,
    props.pulseColor,
    props.pulseLoop ?? false,
    props.delayMs ?? 0,
    props.fadeMs,
    props.lowPower ?? false,
    props.smooth ?? false
  );
  return {
    variant,
    resolvedLat,
    resolvedLon,
    geom,
    quantizedIntensity,
    iconColor: props.iconColor ?? '#ffffff',
    dropIn: props.dropIn ?? false,
    lowPower: props.lowPower ?? false,
    smooth: props.smooth ?? false,
    zIndex: props.zIndex ?? 500,
    isInteractive: Boolean(props.interactive) || props.popup !== undefined,
    ...styleProps,
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
  const m = resolveMarkerDefaults(props);
  const handleClick =
    onClick || hasPopup
      ? (e: React.MouseEvent<HTMLDivElement>) => {
          if (hasPopup) setPopupOpen((prev) => !prev);
          onClick?.(e);
        }
      : undefined;

  const coreNode = renderMarkerCore(
    m.isPin,
    m.variant,
    m.geom.size,
    m.resolvedColor,
    m.resolvedBorder,
    m.iconColor,
    m.isInteractive,
    props.glow ?? false,
    m.quantizedIntensity,
    m.pulseClassName,
    m.pulseCssVars,
    children
  );

  return (
    <>
      <Overlay
        lat={m.resolvedLat}
        lon={m.resolvedLon}
        zIndex={m.zIndex}
        anchor={m.geom.anchor}
        fixedSize={[m.geom.boxSize, m.geom.boxSize]}
        interactive={m.isInteractive}
        {...(className ? { className } : {})}
        {...(handleClick ? { onClick: handleClick } : {})}
      >
        <div style={m.wrapperStyle} title={title}>
          {renderMarkerWrapper(m.dropIn, m.lowPower, m.smooth, coreNode)}
        </div>
      </Overlay>
      {hasPopup && popupOpen && (
        <Popup
          lat={m.resolvedLat}
          lon={m.resolvedLon}
          onClose={() => setPopupOpen(false)}
        >
          {popup}
        </Popup>
      )}
    </>
  );
});
Marker.displayName = 'Marker';

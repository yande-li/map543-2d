import React, { memo, useEffect } from 'react';
import {
  type MarkerPulse,
  type MarkerVariant,
  ensureMarkerStyles,
  normalizePulseMode,
  resolveMarkerGeometry,
} from '../core/marker';
import { type LatLng } from '../core/projection';
import { Overlay } from './Overlay';

export type { MarkerVariant, MarkerPulse };

export interface MarkerProps {
  /** Geographic position as [lat, lon] tuple (or pass `lat` and `lon`). */
  position?: LatLng;
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
          animation: `ll-marker-fade ${fadeMs}ms ${smooth ? 'linear' : 'steps(8, end)'} forwards`,
        }
      : {}),
  };

  const pulseClassName = showPulse
    ? `ll-marker-pulse ll-marker-pulse--${pulseMode}${pulseLoop ? ' ll-marker-pulse--loop' : ''}${smooth ? ' ll-marker-pulse--smooth' : ''}`
    : '';
  const pulseCssVars = showPulse
    ? ({
        '--ll-pulse-color': pulseColor ?? resolvedColor,
        '--ll-pulse-delay': `${delayMs}ms`,
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

/**
 * React wrapper around core marker geometry and Overlay.
 */
export const Marker: React.FC<MarkerProps> = memo(
  ({
    position,
    lat,
    lon,
    variant = 'pin',
    size,
    color,
    borderColor,
    iconColor = '#ffffff',
    pulse = false,
    pulseColor,
    pulseLoop = false,
    glow = false,
    intensity = 1,
    delayMs = 0,
    fadeMs,
    dropIn = false,
    lowPower = false,
    smooth = false,
    zIndex = 500,
    interactive = false,
    onClick,
    className,
    title,
    children,
  }) => {
    useEffect(() => {
      ensureMarkerStyles();
    }, []);

    const resolvedLat = position?.[0] ?? lat ?? Number.NaN;
    const resolvedLon = position?.[1] ?? lon ?? Number.NaN;
    const geom = resolveMarkerGeometry(variant, size);
    const resolvedSize = geom.size;
    const quantizedIntensity = Math.max(0.5, Math.round(intensity * 10) / 10);
    const {
      isPin,
      resolvedColor,
      resolvedBorder,
      wrapperStyle,
      pulseClassName,
      pulseCssVars,
    } = buildMarkerStyleProps(
      variant,
      geom,
      color,
      borderColor,
      pulse,
      pulseColor,
      pulseLoop,
      delayMs,
      fadeMs,
      lowPower,
      smooth
    );

    const renderCore = () =>
      isPin
        ? renderPinMarker(
            resolvedSize,
            resolvedColor,
            resolvedBorder,
            iconColor,
            interactive,
            glow,
            quantizedIntensity,
            pulseClassName,
            pulseCssVars,
            children
          )
        : renderCircleMarker(
            variant,
            resolvedSize,
            resolvedColor,
            resolvedBorder,
            interactive,
            glow,
            quantizedIntensity,
            pulseClassName,
            pulseCssVars
          );

    return (
      <Overlay
        lat={resolvedLat}
        lon={resolvedLon}
        zIndex={zIndex}
        anchor={geom.anchor}
        fixedSize={[geom.boxSize, geom.boxSize]}
        interactive={interactive}
        {...(className ? { className } : {})}
        {...(onClick ? { onClick } : {})}
      >
        <div style={wrapperStyle} title={title}>
          {dropIn && !lowPower ? (
            <div
              style={{
                animation: smooth
                  ? 'll-marker-drop 0.8s cubic-bezier(0.3, 0, 0.2, 1) forwards'
                  : 'll-marker-drop 0.8s steps(12, end) forwards',
              }}
            >
              {renderCore()}
            </div>
          ) : (
            renderCore()
          )}
        </div>
      </Overlay>
    );
  }
);
Marker.displayName = 'Marker';

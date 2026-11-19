import React, { memo, useEffect } from 'react';
import {
  type MarkerPulse,
  type MarkerVariant,
  ensureMarkerStyles,
  normalizePulseMode,
  resolveMarkerGeometry,
} from '../core/marker';
import { Overlay } from './Overlay';

export type { MarkerVariant, MarkerPulse };

export interface MarkerProps {
  lat: number;
  lon: number;
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

/**
 * Thin React wrapper around core marker geometry and Overlay.
 */
export const Marker: React.FC<MarkerProps> = memo(({
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

  const geom = resolveMarkerGeometry(variant, size);
  const resolvedSize = geom.size;
  const resolvedColor =
    color ?? (variant === 'pin' ? '#007aff' : '#0ebf9c');
  const resolvedBorder =
    borderColor ?? (variant === 'ring' ? resolvedColor : '#ffffff');
  const resolvedPulseColor = pulseColor ?? resolvedColor;
  const pulseMode = normalizePulseMode(pulse);
  const isPin = variant === 'pin';
  const quantizedIntensity = Math.max(0.5, Math.round(intensity * 10) / 10);

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

  const pulseClassName =
    pulseMode && !lowPower
      ? `ll-marker-pulse ll-marker-pulse--${pulseMode}${pulseLoop ? ' ll-marker-pulse--loop' : ''}${smooth ? ' ll-marker-pulse--smooth' : ''}`
      : '';
  const pulseCssVars =
    pulseMode && !lowPower
      ? ({
          '--ll-pulse-color': resolvedPulseColor,
          '--ll-pulse-delay': `${delayMs}ms`,
        } as React.CSSProperties)
      : undefined;

  const renderCore = () => {
    if (isPin) {
      const iconSize = Math.round(resolvedSize * 0.67);
      return (
        <div
          style={{
            width: `${resolvedSize}px`,
            height: `${resolvedSize}px`,
            boxSizing: 'border-box',
            pointerEvents: interactive ? 'auto' : 'none',
            background: resolvedColor,
            border: `2px solid ${resolvedBorder}`,
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35)',
            borderRadius: '50% 50% 50% 0',
            transform: 'rotate(-45deg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor,
            zIndex: 2,
          }}
        >
          <div
            style={{
              transform: 'rotate(45deg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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
          border:
            variant === 'ring'
              ? `2px solid ${resolvedColor}`
              : resolvedBorder !== 'none'
                ? `1.5px solid ${resolvedBorder}`
                : undefined,
          boxShadow: glow
            ? `0 0 ${Math.round(5 * quantizedIntensity)}px ${Math.round(2 * quantizedIntensity)}px ${resolvedColor}`
            : undefined,
          transform:
            quantizedIntensity !== 1
              ? `scale(${quantizedIntensity})`
              : undefined,
          pointerEvents: interactive ? 'auto' : 'none',
          ...pulseCssVars,
        }}
      />
    );
  };

  return (
    <Overlay
      lat={lat}
      lon={lon}
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
});
Marker.displayName = 'Marker';

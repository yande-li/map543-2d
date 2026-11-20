export type MarkerVariant = 'pin' | 'dot' | 'ring';
export type MarkerPulse = boolean | 'radar' | 'expand' | 'ripple';
export type MarkerPulseMode = 'radar' | 'expand' | 'ripple' | null;

const MARKER_STYLE_ID = 'map543-marker-styles';

export interface MarkerStyleOptions {
  target?: Document | ShadowRoot;
  nonce?: string;
}

/**
 * Injects self-contained marker keyframe animations once into document.head (or a ShadowRoot).
 * Safe to call in non-DOM/SSR environments (no-op).
 */
export function ensureMarkerStyles(options: MarkerStyleOptions = {}): void {
  if (typeof document === 'undefined') return;
  const root = options.target ?? document;
  const existing =
    root instanceof Document
      ? root.getElementById(MARKER_STYLE_ID)
      : root.querySelector(`#${MARKER_STYLE_ID}`);
  if (existing) return;

  const style = document.createElement('style');
  style.id = MARKER_STYLE_ID;
  if (options.nonce) {
    style.nonce = options.nonce;
  }
  style.textContent = `
@keyframes ll-marker-drop {
  0% { transform: translateY(-200px); opacity: 0; }
  40% { transform: translateY(0); opacity: 1; }
  55% { transform: translateY(-20px); }
  70% { transform: translateY(0); }
  85% { transform: translateY(-5px); }
  100% { transform: translateY(0); }
}
@keyframes ll-marker-expand {
  0% { transform: scale(0); opacity: 1; }
  100% { transform: scale(3.5); opacity: 0; }
}
@keyframes ll-marker-ripple {
  0% { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(5); opacity: 0; }
}
@keyframes ll-marker-fade {
  0%, 80% { opacity: 1; }
  100% { opacity: 0; }
}
.ll-marker-pulse {
  position: relative;
  isolation: isolate;
  backface-visibility: hidden;
  contain: layout style;
}
.ll-marker-pulse::before,
.ll-marker-pulse--ripple::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  box-sizing: border-box;
  z-index: -1;
  will-change: transform, opacity;
}
.ll-marker-pulse--radar::before,
.ll-marker-pulse--expand::before {
  background: var(--ll-pulse-color, currentColor);
  opacity: 0;
  animation: ll-marker-expand 1.8s infinite ease-out;
  animation-delay: var(--ll-pulse-delay, 0ms);
}
.ll-marker-pulse--ripple::before {
  border: 1.5px solid var(--ll-pulse-color, currentColor);
  opacity: 0;
  animation: ll-marker-ripple 2.4s 1 ease-out forwards;
  animation-delay: var(--ll-pulse-delay, 0ms);
}
.ll-marker-pulse--ripple::after {
  border: 1.5px solid var(--ll-pulse-color, currentColor);
  opacity: 0;
  animation: ll-marker-ripple 2.4s 1 ease-out forwards;
  animation-delay: calc(var(--ll-pulse-delay, 0ms) + 800ms);
}
.ll-marker-pulse--loop.ll-marker-pulse--expand::before,
.ll-marker-pulse--loop.ll-marker-pulse--radar::before,
.ll-marker-pulse--loop.ll-marker-pulse--ripple::before,
.ll-marker-pulse--loop.ll-marker-pulse--ripple::after {
  animation-iteration-count: infinite;
}
.ll-marker-pulse--smooth.ll-marker-pulse--radar::before,
.ll-marker-pulse--smooth.ll-marker-pulse--expand::before,
.ll-marker-pulse--smooth.ll-marker-pulse--ripple::before,
.ll-marker-pulse--smooth.ll-marker-pulse--ripple::after {
  animation-timing-function: ease-out;
}`;
  if (root instanceof Document) {
    root.head.appendChild(style);
  } else {
    root.appendChild(style);
  }
}

export function normalizePulseMode(pulse: MarkerPulse): MarkerPulseMode {
  if (pulse === true) return 'radar';
  if (pulse === false) return null;
  return pulse;
}

export interface MarkerGeometry {
  size: number;
  boxSize: number;
  anchor: [number, number];
  pinPaddingBottom: number;
}

/**
 * Computes framework-agnostic marker dimensions and anchor offsets so pin tips
 * and dot/ring centers align cleanly with projected coordinates.
 */
export function resolveMarkerGeometry(
  variant: MarkerVariant,
  size?: number
): MarkerGeometry {
  const resolvedSize =
    size ?? (variant === 'pin' ? 24 : variant === 'ring' ? 16 : 10);
  const isPin = variant === 'pin';
  const boxSize = isPin
    ? resolvedSize * 2
    : Math.max(20, Math.round(resolvedSize * 2));
  const pinPaddingBottom = isPin
    ? Math.round((resolvedSize * (Math.SQRT2 - 1)) / 2)
    : 0;

  return {
    size: resolvedSize,
    boxSize,
    anchor: isPin ? [0.5, 1] : [0.5, 0.5],
    pinPaddingBottom,
  };
}

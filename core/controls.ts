export type ControlPosition =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface ZoomControlsConfig {
  position?: ControlPosition;
  delta?: number;
  inLabel?: string;
  outLabel?: string;
}

export function resolveZoomControlsConfig(
  zoomControls: boolean | ZoomControlsConfig | undefined,
  defaultDelta = 0.5
): {
  enabled: boolean;
  position: ControlPosition;
  delta: number;
  inLabel: string;
  outLabel: string;
} {
  const cfg = typeof zoomControls === 'object' ? zoomControls : undefined;
  return {
    enabled: Boolean(zoomControls),
    position: cfg?.position ?? 'bottom-right',
    delta: cfg?.delta ?? defaultDelta,
    inLabel: cfg?.inLabel ?? 'Zoom in',
    outLabel: cfg?.outLabel ?? 'Zoom out',
  };
}

/**
 * Observes container bounding rect updates via ResizeObserver and window scroll.
 */
export function observeElementRect(
  el: HTMLElement,
  onSync: (rect: DOMRect) => void,
  observeResize = true
): () => void {
  const sync = () => onSync(el.getBoundingClientRect());
  sync();
  const observer =
    observeResize && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(sync)
      : null;
  observer?.observe(el);
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', sync, { passive: true, capture: true });
  }
  return () => {
    observer?.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', sync, { capture: true });
    }
  };
}

export const MAP_Z_INDEX = {
  base: 0,
  image: 50,
  vector: 100,
  heatmap: 250,
  point: 300,
  trajectory: 350,
  overlay: 500,
  control: 800,
  tooltip: 2000,
  popup: 3000,
} as const;

export interface ControlSlots {
  getSlot: (position: ControlPosition) => HTMLElement;
  mountControl: (
    element: HTMLElement,
    position?: ControlPosition
  ) => () => void;
  releaseSlotIfEmpty: (position: ControlPosition) => void;
  destroy: () => void;
}

function applySlotPositionStyles(
  slot: HTMLElement,
  position: ControlPosition
): void {
  const isTop = position.startsWith('top-');
  const isLeft = position.endsWith('-left');
  Object.assign(slot.style, {
    position: 'absolute',
    zIndex: String(MAP_Z_INDEX.control),
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    pointerEvents: 'none',
    [isTop ? 'top' : 'bottom']: '16px',
    [isLeft ? 'left' : 'right']: '16px',
    alignItems: isLeft ? 'flex-start' : 'flex-end',
  });
}

/**
 * Manages lazy 4-corner flex slots inside a map container so controls stack without overlapping.
 */
export function createControlSlots(container: HTMLElement): ControlSlots {
  const slots = new Map<ControlPosition, HTMLElement>();

  const getSlot = (position: ControlPosition): HTMLElement => {
    const existing = slots.get(position);
    if (existing) return existing;
    const slot = document.createElement('div');
    slot.className = `map-control-slot ${position}`;
    applySlotPositionStyles(slot, position);
    container.appendChild(slot);
    slots.set(position, slot);
    return slot;
  };

  const releaseSlotIfEmpty = (position: ControlPosition): void => {
    const slot = slots.get(position);
    if (slot && slot.childElementCount === 0) {
      slot.remove();
      slots.delete(position);
    }
  };

  const mountControl = (
    element: HTMLElement,
    position: ControlPosition = 'top-right'
  ): (() => void) => {
    const slot = getSlot(position);
    const prevPointerEvents = element.style.pointerEvents;
    element.style.pointerEvents = 'auto';
    slot.appendChild(element);

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      element.style.pointerEvents = prevPointerEvents;
      element.remove();
      releaseSlotIfEmpty(position);
    };
  };

  const destroy = (): void => {
    for (const slot of slots.values()) {
      slot.remove();
    }
    slots.clear();
  };

  return { getSlot, mountControl, releaseSlotIfEmpty, destroy };
}

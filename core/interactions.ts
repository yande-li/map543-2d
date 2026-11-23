import { Viewport } from './viewport';
import { LatLon } from './projection';

export interface MapClickEvent {
  latLon: LatLon;
  x: number;
  y: number;
}

export interface InteractionOptions {
  /** Enable drag, pinch, wheel, double-click, and click events (default: true). */
  interactive?: boolean;
  /** Enable keyboard navigation (Arrow keys to pan, +/- to zoom) when focused (default: true). */
  keyboard?: boolean;
  /** Pan distance in CSS pixels per arrow key press (default: 64). */
  keyboardPanStepPx?: number;
  /** Zoom step per wheel tick or zoom button; double-click uses zoomDelta * 2 (default: 0.5). */
  zoomDelta?: number;
  /** Automatically sync container dimensions via ResizeObserver (default: true). */
  observeResize?: boolean;
  /** Callback invoked on pointerup when movement stayed within the 5px click threshold. */
  onClick?: (event: MapClickEvent) => void;
  /** Callback invoked on pointer move when listeners are attached. */
  onMouseMove?: (event: MapClickEvent) => void;
  /** Optional fast check to skip unproject() on pointer move when no listeners exist. */
  hasMouseMoveListener?: () => boolean;
  /** Callback invoked on contextmenu (right-click) inside the map container. */
  onContextMenu?: (event: MapClickEvent) => void;
  /** Debounced callback invoked after viewport movement settles. */
  onMoveEnd?: () => void;
  /** Debounce delay in ms for onMoveEnd (default: 120). */
  moveEndDelayMs?: number;
  /** Coalesce high-frequency pointermove/wheel events per animation frame (default: true). */
  coalesceFrame?: boolean;
}

interface ActivePointer {
  x: number;
  y: number;
}

const CLICK_SLOP_SQ = 25; // 5px

const KEY_PAN: Record<string, readonly [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
};

const KEY_ZOOM: Record<string, number> = {
  '+': 1,
  '=': 1,
  '-': -1,
  _: -1,
};

/**
 * Attaches DOM viewport interactions (resize, drag, pinch, wheel, double-click, keyboard, and click)
 * to an HTMLElement and returns a cleanup function.
 */
export function attachInteractions(
  el: HTMLElement,
  viewport: Viewport,
  options: InteractionOptions = {}
): () => void {
  const {
    interactive = true,
    keyboard = true,
    keyboardPanStepPx = 64,
    zoomDelta = 0.5,
    observeResize = true,
    onClick,
    onMouseMove,
    hasMouseMoveListener,
    onContextMenu,
    onMoveEnd,
    moveEndDelayMs = 120,
    coalesceFrame = true,
  } = options;

  const cleanups: Array<() => void> = [];
  let rectLeft = 0;
  let rectTop = 0;

  const syncRect = () => {
    const rect = el.getBoundingClientRect();
    rectLeft = rect.left;
    rectTop = rect.top;
    if (observeResize && rect.width > 0 && rect.height > 0) {
      viewport.setSize(rect.width, rect.height);
    }
  };

  syncRect();

  if (observeResize && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(syncRect);
    observer.observe(el);
    cleanups.push(() => observer.disconnect());
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', syncRect, {
      passive: true,
      capture: true,
    });
    cleanups.push(() =>
      window.removeEventListener('scroll', syncRect, { capture: true })
    );
  }

  if (onMoveEnd) {
    cleanups.push(viewport.on('moveend', onMoveEnd));
  }

  if (interactive) {
    const prevTouchAction = el.style.touchAction;
    el.style.touchAction = 'none';
    const addedTabIndex = keyboard && el.getAttribute('tabindex') === null;
    if (addedTabIndex) {
      el.tabIndex = 0;
    }

    const pointers = new Map<number, ActivePointer>();
    let dragOrigin: { x: number; y: number; moved: boolean } | null = null;
    let lastPinchDist: number | null = null;
    let dragGestureActive = false;
    let pinchGestureActive = false;
    let wheelGestureActive = false;
    let wheelEndTimer: ReturnType<typeof setTimeout> | null = null;
    let keyGestureCount = 0;
    let keyPanActive = false;
    let keyZoomActive = false;

    const endKeyGesture = () => {
      while (keyGestureCount > 0) {
        keyGestureCount -= 1;
        viewport.endGesture();
      }
      keyPanActive = false;
      keyZoomActive = false;
    };

    const useRaf = coalesceFrame && typeof requestAnimationFrame === 'function';
    let rafId = 0;
    let pendingPanX = 0;
    let pendingPanY = 0;
    let pendingWheelDelta = 0;
    let wheelAnchorX = 0;
    let wheelAnchorY = 0;

    const flushPending = () => {
      rafId = 0;
      if (pendingPanX !== 0 || pendingPanY !== 0) {
        const dx = pendingPanX;
        const dy = pendingPanY;
        pendingPanX = 0;
        pendingPanY = 0;
        viewport.panBy(dx, dy);
      }
      if (pendingWheelDelta !== 0) {
        const delta = pendingWheelDelta;
        pendingWheelDelta = 0;
        viewport.zoomAt(
          viewport.getState().zoom + delta,
          wheelAnchorX,
          wheelAnchorY
        );
      }
    };

    const scheduleFlush = () => {
      if (rafId === 0) {
        rafId = requestAnimationFrame(flushPending);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!wheelGestureActive) {
        wheelGestureActive = true;
        viewport.beginGesture(true);
      }
      if (wheelEndTimer !== null) clearTimeout(wheelEndTimer);
      wheelEndTimer = setTimeout(() => {
        wheelEndTimer = null;
        if (wheelGestureActive) {
          wheelGestureActive = false;
          viewport.endGesture();
        }
      }, moveEndDelayMs);

      const anchorX = e.clientX - rectLeft;
      const anchorY = e.clientY - rectTop;
      const step = e.deltaY < 0 ? zoomDelta : -zoomDelta;
      if (useRaf) {
        pendingWheelDelta += step;
        wheelAnchorX = anchorX;
        wheelAnchorY = anchorY;
        scheduleFlush();
      } else {
        viewport.zoomAt(viewport.getState().zoom + step, anchorX, anchorY);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      el.setPointerCapture?.(e.pointerId);
      if (pointers.size === 0) {
        syncRect();
      }

      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragOrigin = { x: e.clientX, y: e.clientY, moved: false };
        lastPinchDist = null;
      } else if (pointers.size === 2) {
        const iter = pointers.values();
        const p0 = iter.next().value;
        const p1 = iter.next().value;
        if (p0 && p1) {
          lastPinchDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        }
        if (dragOrigin) {
          dragOrigin.moved = true;
        }
        if (!pinchGestureActive) {
          pinchGestureActive = true;
          viewport.beginGesture(true);
        }
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (onMouseMove && (!hasMouseMoveListener || hasMouseMoveListener())) {
        const px = e.clientX - rectLeft;
        const py = e.clientY - rectTop;
        onMouseMove({ latLon: viewport.unproject(px, py), x: px, y: py });
      }
      const prev = pointers.get(e.pointerId);
      if (!prev) return;

      if (pointers.size === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (dragOrigin) {
          const totalDx = e.clientX - dragOrigin.x;
          const totalDy = e.clientY - dragOrigin.y;
          if (totalDx * totalDx + totalDy * totalDy > CLICK_SLOP_SQ) {
            dragOrigin.moved = true;
          }
        }
        if (dragOrigin?.moved) {
          if (!dragGestureActive) {
            dragGestureActive = true;
            viewport.beginGesture(false);
          }
          if (useRaf) {
            pendingPanX += dx;
            pendingPanY += dy;
            scheduleFlush();
          } else {
            viewport.panBy(dx, dy);
          }
        }
      } else if (pointers.size === 2) {
        if (rafId !== 0) {
          cancelAnimationFrame(rafId);
          flushPending();
        }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const iter = pointers.values();
        const p0 = iter.next().value;
        const p1 = iter.next().value;
        if (p0 && p1) {
          const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          if (lastPinchDist && lastPinchDist > 0 && dist > 0) {
            const midX = (p0.x + p1.x) * 0.5 - rectLeft;
            const midY = (p0.y + p1.y) * 0.5 - rectTop;
            const zoomDiff = Math.log2(dist / lastPinchDist);
            viewport.zoomAt(viewport.getState().zoom + zoomDiff, midX, midY);
          }
          lastPinchDist = dist;
        }
      }
    };

    const endPointer = (e: PointerEvent) => {
      const wasTracked = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) {
        lastPinchDist = null;
        if (pinchGestureActive) {
          pinchGestureActive = false;
          viewport.endGesture();
        }
      }

      if (
        wasTracked &&
        pointers.size === 0 &&
        dragOrigin &&
        !dragOrigin.moved &&
        e.type === 'pointerup' &&
        onClick
      ) {
        const px = e.clientX - rectLeft;
        const py = e.clientY - rectTop;
        onClick({ latLon: viewport.unproject(px, py), x: px, y: py });
      }

      if (pointers.size === 0) {
        dragOrigin = null;
        if (dragGestureActive) {
          dragGestureActive = false;
          viewport.endGesture();
        }
      }
    };

    const clearPointers = () => {
      pointers.clear();
      dragOrigin = null;
      lastPinchDist = null;
      if (pinchGestureActive) {
        pinchGestureActive = false;
        viewport.endGesture();
      }
      if (dragGestureActive) {
        dragGestureActive = false;
        viewport.endGesture();
      }
      endKeyGesture();
    };

    const bind = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (ev: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions
    ) => {
      el.addEventListener(type, fn, opts);
      cleanups.push(() => el.removeEventListener(type, fn, opts));
    };

    const zoomCenter = (delta: number) => {
      const s = viewport.getState();
      viewport.zoomAt(s.zoom + delta, s.width * 0.5, s.height * 0.5);
    };

    const handleDoubleClick = (e: MouseEvent) => {
      viewport.zoomAt(
        viewport.getState().zoom + zoomDelta * 2,
        e.clientX - rectLeft,
        e.clientY - rectTop
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!keyboard) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const pan = KEY_PAN[e.key];
      if (pan) {
        e.preventDefault();
        if (!keyPanActive) {
          keyPanActive = true;
          keyGestureCount += 1;
          viewport.beginGesture(false);
        }
        viewport.panBy(pan[0] * keyboardPanStepPx, pan[1] * keyboardPanStepPx);
        return;
      }
      const zoomDir = KEY_ZOOM[e.key];
      if (zoomDir !== undefined) {
        e.preventDefault();
        if (!keyZoomActive) {
          keyZoomActive = true;
          keyGestureCount += 1;
          viewport.beginGesture(true);
        }
        zoomCenter(zoomDir * zoomDelta);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        keyboard &&
        keyGestureCount > 0 &&
        (e.key in KEY_PAN || e.key in KEY_ZOOM)
      ) {
        endKeyGesture();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (!onContextMenu) return;
      const px = e.clientX - rectLeft;
      const py = e.clientY - rectTop;
      onContextMenu({ latLon: viewport.unproject(px, py), x: px, y: py });
    };

    bind('wheel', handleWheel, { passive: false });
    bind('pointerdown', handlePointerDown);
    bind('pointermove', handlePointerMove);
    bind('pointerup', endPointer);
    bind('pointercancel', endPointer);
    bind('lostpointercapture', endPointer);
    bind('dblclick', handleDoubleClick);
    if (onContextMenu) {
      bind('contextmenu', handleContextMenu);
    }
    if (keyboard) {
      bind('keydown', handleKeyDown);
      bind('keyup', handleKeyUp);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', clearPointers);
      cleanups.push(() => window.removeEventListener('blur', clearPointers));
    }

    cleanups.push(() => {
      el.style.touchAction = prevTouchAction;
      if (addedTabIndex) {
        el.removeAttribute('tabindex');
      }
      endKeyGesture();
      if (wheelEndTimer !== null) {
        clearTimeout(wheelEndTimer);
        wheelEndTimer = null;
      }
      if (wheelGestureActive) {
        wheelGestureActive = false;
        viewport.endGesture();
      }
      if (rafId !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    });
  }

  return () => {
    for (const fn of cleanups) {
      fn();
    }
  };
}

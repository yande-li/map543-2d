import { Camera } from './camera';
import { LatLng } from './projection';

export interface ViewportInteractionsOptions {
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
  onClick?: (x: number, y: number, latLng: LatLng) => void;
  /** Debounced callback invoked after camera movement settles. */
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

const CLICK_MOVE_THRESHOLD_SQ = 25; // 5px

/**
 * Attaches framework-agnostic DOM viewport interactions (ResizeObserver, pointer drag,
 * two-finger pinch, wheel zoom, double-click zoom, and click detection) to an HTMLElement.
 * Suitable for Vue, Svelte, or Vanilla JS integrations. Returns a cleanup function.
 */
export function attachViewportInteractions(
  el: HTMLElement,
  camera: Camera,
  options: ViewportInteractionsOptions = {}
): () => void {
  const {
    interactive = true,
    keyboard = true,
    keyboardPanStepPx = 64,
    zoomDelta = 0.5,
    observeResize = true,
    onClick,
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
      camera.setSize(rect.width, rect.height);
    }
  };

  syncRect();

  if (observeResize && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(syncRect);
    observer.observe(el);
    cleanups.push(() => observer.disconnect());
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', syncRect, { passive: true, capture: true });
    cleanups.push(() =>
      window.removeEventListener('scroll', syncRect, { capture: true })
    );
  }

  if (onMoveEnd) {
    let moveEndTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = camera.subscribe(() => {
      if (moveEndTimer !== null) clearTimeout(moveEndTimer);
      moveEndTimer = setTimeout(() => {
        moveEndTimer = null;
        onMoveEnd();
      }, moveEndDelayMs);
    });
    cleanups.push(() => {
      unsubscribe();
      if (moveEndTimer !== null) clearTimeout(moveEndTimer);
    });
  }

  if (interactive) {
    const prevTouchAction = el.style.touchAction;
    el.style.touchAction = 'none';

    const pointers = new Map<number, ActivePointer>();
    let dragOrigin: { x: number; y: number; moved: boolean } | null = null;
    let lastPinchDist: number | null = null;

    const useRaf =
      coalesceFrame && typeof requestAnimationFrame === 'function';
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
        camera.panBy(dx, dy);
      }
      if (pendingWheelDelta !== 0) {
        const delta = pendingWheelDelta;
        pendingWheelDelta = 0;
        camera.zoomAt(
          camera.getState().zoom + delta,
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
      const anchorX = e.clientX - rectLeft;
      const anchorY = e.clientY - rectTop;
      const step = e.deltaY < 0 ? zoomDelta : -zoomDelta;
      if (useRaf) {
        pendingWheelDelta += step;
        wheelAnchorX = anchorX;
        wheelAnchorY = anchorY;
        scheduleFlush();
      } else {
        camera.zoomAt(camera.getState().zoom + step, anchorX, anchorY);
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
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;

      if (pointers.size === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (dragOrigin) {
          const totalDx = e.clientX - dragOrigin.x;
          const totalDy = e.clientY - dragOrigin.y;
          if (totalDx * totalDx + totalDy * totalDy > CLICK_MOVE_THRESHOLD_SQ) {
            dragOrigin.moved = true;
          }
        }
        if (dragOrigin?.moved) {
          if (useRaf) {
            pendingPanX += dx;
            pendingPanY += dy;
            scheduleFlush();
          } else {
            camera.panBy(dx, dy);
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
            camera.zoomAt(camera.getState().zoom + zoomDiff, midX, midY);
          }
          lastPinchDist = dist;
        }
      }
    };

    const handlePointerUpOrCancel = (e: PointerEvent) => {
      const wasTracked = pointers.has(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) {
        lastPinchDist = null;
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
        onClick(px, py, camera.unproject(px, py));
      }

      if (pointers.size === 0) {
        dragOrigin = null;
      }
    };

    const clearPointers = () => {
      pointers.clear();
      dragOrigin = null;
      lastPinchDist = null;
    };

    const handleDoubleClick = (e: MouseEvent) => {
      const anchorX = e.clientX - rectLeft;
      const anchorY = e.clientY - rectTop;
      camera.zoomAt(camera.getState().zoom + zoomDelta * 2, anchorX, anchorY);
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
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          camera.panBy(0, keyboardPanStepPx);
          break;
        case 'ArrowDown':
          e.preventDefault();
          camera.panBy(0, -keyboardPanStepPx);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          camera.panBy(keyboardPanStepPx, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          camera.panBy(-keyboardPanStepPx, 0);
          break;
        case '+':
        case '=': {
          e.preventDefault();
          const s = camera.getState();
          camera.zoomAt(s.zoom + zoomDelta, s.width * 0.5, s.height * 0.5);
          break;
        }
        case '-':
        case '_': {
          e.preventDefault();
          const s = camera.getState();
          camera.zoomAt(s.zoom - zoomDelta, s.width * 0.5, s.height * 0.5);
          break;
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUpOrCancel);
    el.addEventListener('pointercancel', handlePointerUpOrCancel);
    el.addEventListener('lostpointercapture', handlePointerUpOrCancel);
    el.addEventListener('dblclick', handleDoubleClick);
    if (keyboard) {
      el.addEventListener('keydown', handleKeyDown);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', clearPointers);
    }

    cleanups.push(() => {
      el.style.touchAction = prevTouchAction;
      if (rafId !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUpOrCancel);
      el.removeEventListener('pointercancel', handlePointerUpOrCancel);
      el.removeEventListener('lostpointercapture', handlePointerUpOrCancel);
      el.removeEventListener('dblclick', handleDoubleClick);
      if (keyboard) {
        el.removeEventListener('keydown', handleKeyDown);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', clearPointers);
      }
    });
  }

  return () => {
    for (const fn of cleanups) {
      fn();
    }
  };
}

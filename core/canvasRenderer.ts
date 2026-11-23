import { Viewport, ViewportState } from './viewport';
import { MapLayerRenderer } from './renderer';

export type CanvasDrawCallback = (
  ctx: CanvasRenderingContext2D,
  state: ViewportState,
  viewport: Viewport,
  isInteracting: boolean
) => void;

export interface CanvasRendererOptions {
  zIndex?: number;
  maxDpr?: number;
  interactionMaxDpr?: number;
  interactionIdleDelayMs?: number;
  className?: string;
  onDraw: CanvasDrawCallback;
}

const IDLE_DELAY_MS = 140;

function syncCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): void {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

/**
 * 2D canvas layer renderer managing a DPR-aware `<canvas>`, rAF redraw coalescing,
 * and optional interaction downsampling.
 */
export class CanvasRenderer implements MapLayerRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private viewport: Viewport | null = null;
  private unsubscribes: Array<() => void> = [];
  private ownsCanvas = false;

  private zIndex: number;
  private maxDpr: number;
  private interactionMaxDpr: number | undefined;
  private interactionIdleDelayMs: number;
  private className: string;
  private onDraw: CanvasDrawCallback;

  private rafId = 0;
  private isInteracting = false;
  private renderedDuringInteraction = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lowResCanvas: HTMLCanvasElement | null = null;
  private lowResCtx: CanvasRenderingContext2D | null = null;

  constructor(options: CanvasRendererOptions) {
    this.zIndex = options.zIndex ?? 100;
    this.maxDpr = options.maxDpr ?? 2;
    this.interactionMaxDpr = options.interactionMaxDpr;
    this.interactionIdleDelayMs =
      options.interactionIdleDelayMs ?? IDLE_DELAY_MS;
    this.className = options.className ?? '';
    this.onDraw = options.onDraw;
  }

  /**
   * Attaches the renderer to an existing `<canvas>` element.
   */
  attachCanvas(canvas: HTMLCanvasElement, viewport: Viewport): void {
    this.onDetach();
    this.canvas = canvas;
    this.ownsCanvas = false;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.onAttach(viewport);
  }

  /**
   * Creates and mounts a managed `<canvas>` into a container element.
   */
  mount(container: HTMLElement, viewport: Viewport): () => void {
    this.onDetach();
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = String(this.zIndex);
    if (this.className) {
      canvas.className = this.className;
    }
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ownsCanvas = true;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.onAttach(viewport);
    return () => this.onDetach();
  }

  onAttach(viewport: Viewport): void {
    this.viewport = viewport;
    this.unsubscribes = [
      viewport.on('movestart', () => this.onMoveStart()),
      viewport.on('move', () => this.onMove()),
      viewport.on('moveend', () => this.onMoveEnd()),
    ];
    this.scheduleRedraw();
  }

  render(_state: ViewportState): void {
    this.renderFrame();
  }

  setOptions(partial: Partial<CanvasRendererOptions>): void {
    if (partial.onDraw !== undefined) this.onDraw = partial.onDraw;
    if (partial.maxDpr !== undefined) this.maxDpr = partial.maxDpr;
    if ('interactionMaxDpr' in partial) {
      this.interactionMaxDpr = partial.interactionMaxDpr;
    }
    if (partial.interactionIdleDelayMs !== undefined) {
      this.interactionIdleDelayMs = partial.interactionIdleDelayMs;
    }
    if (partial.zIndex !== undefined) {
      this.zIndex = partial.zIndex;
      if (this.canvas && this.ownsCanvas) {
        this.canvas.style.zIndex = String(this.zIndex);
      }
    }
    if (partial.className !== undefined) {
      this.className = partial.className;
      if (this.canvas && this.ownsCanvas) {
        this.canvas.className = this.className;
      }
    }
    this.scheduleRedraw();
  }

  scheduleRedraw(): void {
    if (this.rafId === 0 && typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => this.renderFrame());
    }
  }

  onDetach(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.clearIdleTimer();
    if (this.rafId !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.releaseLowResCanvas();
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
      if (this.ownsCanvas) {
        this.canvas.remove();
      }
      this.canvas = null;
    }
    this.ctx = null;
    this.viewport = null;
    this.ownsCanvas = false;
    this.isInteracting = false;
    this.renderedDuringInteraction = false;
  }

  private releaseLowResCanvas(): void {
    if (this.lowResCanvas) {
      this.lowResCanvas.width = 0;
      this.lowResCanvas.height = 0;
      this.lowResCanvas = null;
      this.lowResCtx = null;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private onMoveStart(): void {
    if (!this.viewport) return;
    if (!this.viewport.isLastChangeInteractive()) return;
    this.clearIdleTimer();
    this.isInteracting = true;
  }

  private onMove(): void {
    if (!this.viewport) return;
    this.clearIdleTimer();
    if (this.viewport.isLastChangeInteractive()) {
      this.isInteracting = true;
    } else {
      this.isInteracting = false;
      this.renderedDuringInteraction = false;
      this.releaseLowResCanvas();
    }
    this.scheduleRedraw();
  }

  private onMoveEnd(): void {
    if (!this.viewport) return;
    if (!this.viewport.isLastChangeInteractive() && !this.isInteracting) {
      return;
    }
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.isInteracting = false;
      this.releaseLowResCanvas();
      if (this.renderedDuringInteraction) {
        this.renderedDuringInteraction = false;
        this.scheduleRedraw();
      }
    }, this.interactionIdleDelayMs);
  }

  private drawLayerPass(
    ctx: CanvasRenderingContext2D,
    dpr: number,
    state: ViewportState,
    isInteracting: boolean
  ): void {
    if (!this.viewport) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);
    this.onDraw(ctx, state, this.viewport, isInteracting);
    ctx.restore();
  }

  private renderFrame(): void {
    this.rafId = 0;
    if (!this.canvas || !this.ctx || !this.viewport) return;
    const state = this.viewport.getState();
    if (state.width <= 0 || state.height <= 0) return;

    const deviceDpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const fullDpr = Math.min(deviceDpr, this.maxDpr);
    const targetW = Math.max(1, Math.round(state.width * fullDpr));
    const targetH = Math.max(1, Math.round(state.height * fullDpr));
    syncCanvasSize(this.canvas, targetW, targetH);

    const useLowResBuffer =
      this.isInteracting &&
      this.interactionMaxDpr !== undefined &&
      this.interactionMaxDpr < fullDpr;

    if (useLowResBuffer) {
      const lowDpr = Math.max(0.2, Math.min(fullDpr, this.interactionMaxDpr!));
      const lowW = Math.max(1, Math.round(state.width * lowDpr));
      const lowH = Math.max(1, Math.round(state.height * lowDpr));
      if (!this.lowResCanvas) {
        this.lowResCanvas = document.createElement('canvas');
        this.lowResCtx = this.lowResCanvas.getContext('2d', { alpha: true });
      }
      if (this.lowResCanvas && this.lowResCtx) {
        syncCanvasSize(this.lowResCanvas, lowW, lowH);
        this.drawLayerPass(this.lowResCtx, lowDpr, state, true);

        this.ctx.save();
        this.ctx.setTransform(fullDpr, 0, 0, fullDpr, 0, 0);
        this.ctx.clearRect(0, 0, state.width, state.height);
        this.ctx.drawImage(this.lowResCanvas, 0, 0, state.width, state.height);
        this.ctx.restore();
        this.renderedDuringInteraction = true;
        return;
      }
    }

    this.drawLayerPass(this.ctx, fullDpr, state, this.isInteracting);
    this.renderedDuringInteraction = this.isInteracting;
  }
}

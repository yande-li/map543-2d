import { Camera, ViewportState } from './camera';
import { MapLayerRenderer } from './renderer';

export type BlanketDrawCallback = (
  ctx: CanvasRenderingContext2D,
  state: ViewportState,
  camera: Camera,
  isInteracting: boolean
) => void;

export interface BlanketLayerOptions {
  zIndex?: number;
  maxDpr?: number;
  interactionMaxDpr?: number;
  interactionIdleDelayMs?: number;
  className?: string;
  onDraw: BlanketDrawCallback;
}

const IDLE_DELAY_MS = 140;

/**
 * Framework-agnostic 2D canvas layer renderer managing a DPR-aware `<canvas>`,
 * rAF redraw coalescing, and optional interaction downsampling.
 */
export class BlanketCanvasLayer implements MapLayerRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private camera: Camera | null = null;
  private unsubscribe: (() => void) | null = null;
  private ownsCanvas = false;

  private zIndex: number;
  private maxDpr: number;
  private interactionMaxDpr: number | undefined;
  private interactionIdleDelayMs: number;
  private className: string;
  private onDraw: BlanketDrawCallback;

  private rafId = 0;
  private isInteracting = false;
  private renderedDuringInteraction = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInteractionAt = 0;
  private lowResCanvas: HTMLCanvasElement | null = null;
  private lowResCtx: CanvasRenderingContext2D | null = null;

  constructor(options: BlanketLayerOptions) {
    this.zIndex = options.zIndex ?? 100;
    this.maxDpr = options.maxDpr ?? 2;
    this.interactionMaxDpr = options.interactionMaxDpr;
    this.interactionIdleDelayMs =
      options.interactionIdleDelayMs ?? IDLE_DELAY_MS;
    this.className = options.className ?? '';
    this.onDraw = options.onDraw;
  }

  /**
   * Attaches the layer to an existing <canvas> element (used by React wrapper).
   */
  attachCanvas(canvas: HTMLCanvasElement, camera: Camera): void {
    this.onDetach();
    this.canvas = canvas;
    this.ownsCanvas = false;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.onAttach(camera);
  }

  /**
   * Creates and mounts a managed <canvas> into a container element (framework-agnostic).
   */
  mount(container: HTMLElement, camera: Camera): () => void {
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
    this.onAttach(camera);
    return () => this.onDetach();
  }

  onAttach(camera: Camera): void {
    this.camera = camera;
    this.unsubscribe = camera.subscribe(() => this.onCameraChange());
    this.scheduleRedraw();
  }

  render(_state: ViewportState): void {
    this.renderFrame();
  }

  setOptions(partial: Partial<BlanketLayerOptions>): void {
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
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
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
    this.camera = null;
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

  private onCameraChange(): void {
    if (!this.camera) return;
    if (!this.camera.isLastChangeInteractive()) {
      if (this.idleTimer !== null) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      this.isInteracting = false;
      this.renderedDuringInteraction = false;
      this.releaseLowResCanvas();
      this.scheduleRedraw();
      return;
    }
    this.isInteracting = true;
    this.lastInteractionAt = performance.now();
    this.idleTimer ??= setTimeout(
      () => this.onIdleTimeout(),
      this.interactionIdleDelayMs
    );
    this.scheduleRedraw();
  }

  private onIdleTimeout(): void {
    const elapsed = performance.now() - this.lastInteractionAt;
    const remaining = this.interactionIdleDelayMs - elapsed;
    if (remaining > 1) {
      this.idleTimer = setTimeout(() => this.onIdleTimeout(), remaining);
      return;
    }
    this.idleTimer = null;
    this.isInteracting = false;
    this.releaseLowResCanvas();
    if (this.renderedDuringInteraction) {
      this.renderedDuringInteraction = false;
      this.scheduleRedraw();
    }
  }

  private renderFrame(): void {
    this.rafId = 0;
    if (!this.canvas || !this.ctx || !this.camera) return;
    const state = this.camera.getState();
    if (state.width <= 0 || state.height <= 0) return;

    const deviceDpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const fullDpr = Math.min(deviceDpr, this.maxDpr);
    const targetW = Math.max(1, Math.round(state.width * fullDpr));
    const targetH = Math.max(1, Math.round(state.height * fullDpr));

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

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
        if (
          this.lowResCanvas.width !== lowW ||
          this.lowResCanvas.height !== lowH
        ) {
          this.lowResCanvas.width = lowW;
          this.lowResCanvas.height = lowH;
        }
        this.lowResCtx.save();
        this.lowResCtx.setTransform(lowDpr, 0, 0, lowDpr, 0, 0);
        this.lowResCtx.clearRect(0, 0, state.width, state.height);
        this.onDraw(this.lowResCtx, state, this.camera, true);
        this.lowResCtx.restore();

        this.ctx.save();
        this.ctx.setTransform(fullDpr, 0, 0, fullDpr, 0, 0);
        this.ctx.clearRect(0, 0, state.width, state.height);
        this.ctx.drawImage(this.lowResCanvas, 0, 0, state.width, state.height);
        this.ctx.restore();
        this.renderedDuringInteraction = true;
        return;
      }
    }

    this.ctx.save();
    this.ctx.setTransform(fullDpr, 0, 0, fullDpr, 0, 0);
    this.ctx.clearRect(0, 0, state.width, state.height);
    this.onDraw(this.ctx, state, this.camera, this.isInteracting);
    this.ctx.restore();
    this.renderedDuringInteraction = this.isInteracting;
  }
}

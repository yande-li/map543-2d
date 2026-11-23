import { createEmitter, type Unsubscribe } from './events';
import {
  Projection,
  LatLon,
  LatLonBounds,
  NormalizedBounds,
  Point2D,
  ProjectionType,
  TILE_SIZE,
  clampCenterToBounds,
  getMinZoom,
  getNormBounds,
  getResponsiveZoom,
  computeZoomForBounds,
  getViewportBounds,
  resolveProjection,
  pxToLatLon,
} from './projection';

export interface ViewportEventMap extends Record<string, unknown> {
  movestart: ViewportState;
  move: ViewportState;
  moveend: ViewportState;
  zoomstart: ViewportState;
  zoom: ViewportState;
  zoomend: ViewportState;
}

export interface ViewportState {
  center: LatLon;
  zoom: number;
  width: number;
  height: number;
  minZoom: number;
  maxZoom: number;
  maxBounds?: [LatLon, LatLon];
  referenceWidth?: number;
  preserveViewportSpan?: boolean;
  projection?: ProjectionType | Projection;
  smooth?: boolean;
}

export interface ViewportConstraints {
  minZoom?: number;
  maxZoom?: number;
  maxBounds?: [LatLon, LatLon];
  referenceWidth?: number;
  preserveViewportSpan?: boolean;
  projection?: ProjectionType | Projection;
  smooth?: boolean;
}

export type ViewportListener = (state: ViewportState) => void;

export interface ProjectionParams {
  centerNormX: number;
  centerNormY: number;
  worldSize: number;
  halfW: number;
  halfH: number;
}

/**
 * Framework-agnostic viewport viewport controller managing pan, zoom, bounds clamping, and flyTo.
 */
export class Viewport {
  private state: ViewportState;
  private emitter = createEmitter<ViewportEventMap>();
  private flyRafId = 0;
  private activeGestureCount = 0;
  private moving = false;
  private zooming = false;
  private lastChangeInteractive = false;
  private cachedWorldSize = TILE_SIZE;
  private cachedCenterNormX = 0.5;
  private cachedCenterNormY = 0.5;
  private cachedHalfW = 0;
  private cachedHalfH = 0;
  private cachedNormBounds: NormalizedBounds;
  private projectionObj: Projection;
  private readonly tmpNorm: Point2D = { x: 0, y: 0 };
  private readonly cachedParams: ProjectionParams = {
    centerNormX: 0.5,
    centerNormY: 0.5,
    worldSize: TILE_SIZE,
    halfW: 0,
    halfH: 0,
  };

  constructor(initial: Partial<ViewportState> = {}) {
    this.projectionObj = resolveProjection(initial.projection);
    this.state = {
      center: initial.center ?? [0, 0],
      zoom: initial.zoom ?? 3,
      width: initial.width ?? 0,
      height: initial.height ?? 0,
      minZoom: initial.minZoom ?? 0,
      maxZoom: initial.maxZoom ?? 10,
      ...(initial.maxBounds ? { maxBounds: initial.maxBounds } : {}),
      ...(initial.referenceWidth !== undefined
        ? { referenceWidth: initial.referenceWidth }
        : {}),
      ...(initial.preserveViewportSpan !== undefined
        ? { preserveViewportSpan: initial.preserveViewportSpan }
        : {}),
      ...(initial.projection !== undefined
        ? { projection: initial.projection }
        : {}),
      ...(initial.smooth !== undefined ? { smooth: initial.smooth } : {}),
    };
    this.cachedNormBounds = getNormBounds(
      this.state.maxBounds,
      this.projectionObj
    );
    if (this.state.width > 0 && this.state.height > 0) {
      const clampedZoom = this.clampZoom(this.state.zoom);
      const clampedCenter = this.clampStateCenter(
        this.state.center,
        clampedZoom
      );
      this.state = { ...this.state, zoom: clampedZoom, center: clampedCenter };
    }
    this.updateProjectionCache();
  }

  private clampStateCenter(center: LatLon, zoom: number): LatLon {
    return clampCenterToBounds(
      center,
      zoom,
      this.state.width,
      this.state.height,
      this.state.maxBounds,
      this.cachedNormBounds,
      this.projectionObj
    );
  }

  getProjection(): Projection {
    return this.projectionObj;
  }

  isLastChangeInteractive(): boolean {
    return this.lastChangeInteractive;
  }

  private updateProjectionCache(): void {
    this.cachedWorldSize = TILE_SIZE * Math.pow(2, this.state.zoom);
    this.projectionObj.latLonToNorm(
      this.state.center[0],
      this.state.center[1],
      this.tmpNorm
    );
    this.cachedCenterNormX = this.tmpNorm.x;
    this.cachedCenterNormY = this.tmpNorm.y;
    this.cachedHalfW = this.state.width * 0.5;
    this.cachedHalfH = this.state.height * 0.5;
    this.cachedParams.centerNormX = this.cachedCenterNormX;
    this.cachedParams.centerNormY = this.cachedCenterNormY;
    this.cachedParams.worldSize = this.cachedWorldSize;
    this.cachedParams.halfW = this.cachedHalfW;
    this.cachedParams.halfH = this.cachedHalfH;
  }

  getState(): ViewportState {
    return this.state;
  }

  subscribe(listener: ViewportListener): () => void {
    return this.emitter.on('move', listener);
  }

  on<K extends keyof ViewportEventMap>(
    type: K,
    listener: (payload: ViewportEventMap[K]) => void
  ): Unsubscribe {
    return this.emitter.on(type, listener);
  }

  once<K extends keyof ViewportEventMap>(
    type: K,
    listener: (payload: ViewportEventMap[K]) => void
  ): Unsubscribe {
    return this.emitter.once(type, listener);
  }

  private startMotion(withZoom: boolean): void {
    if (!this.moving) {
      this.moving = true;
      this.emitter.emit('movestart', this.state);
    }
    if (withZoom && !this.zooming) {
      this.zooming = true;
      this.emitter.emit('zoomstart', this.state);
    }
  }

  beginGesture(zooming = false): void {
    this.activeGestureCount += 1;
    this.startMotion(zooming);
  }

  endGesture(): void {
    if (this.activeGestureCount > 0) {
      this.activeGestureCount -= 1;
    }
    this.finishMotionIfIdle();
  }

  private finishMotionIfIdle(): void {
    if (this.activeGestureCount > 0 || this.flyRafId !== 0) return;
    if (this.zooming) {
      this.zooming = false;
      this.emitter.emit('zoomend', this.state);
    }
    if (this.moving) {
      this.moving = false;
      this.emitter.emit('moveend', this.state);
    }
  }

  private emit(zoomChanged = false): void {
    this.updateProjectionCache();
    this.emitter.emit('move', this.state);
    if (zoomChanged) {
      this.emitter.emit('zoom', this.state);
    }
  }

  getEffectiveMinZoom(): number {
    const dynamicMin = getMinZoom(
      this.state.width,
      this.state.height,
      this.state.maxBounds,
      this.cachedNormBounds,
      this.projectionObj
    );
    return Math.max(this.state.minZoom, dynamicMin);
  }

  private clampZoom(zoom: number): number {
    const effectiveMin = this.getEffectiveMinZoom();
    return Math.max(effectiveMin, Math.min(this.state.maxZoom, zoom));
  }

  cancelAnimation(): void {
    if (this.flyRafId !== 0) {
      cancelAnimationFrame(this.flyRafId);
      this.flyRafId = 0;
      this.finishMotionIfIdle();
    }
  }

  setSize(width: number, height: number): void {
    if (width === this.state.width && height === this.state.height) return;
    const prevWidth = this.state.width;
    let targetZoom = this.state.zoom;
    if (width > 0) {
      if (
        prevWidth <= 0 &&
        this.state.referenceWidth !== undefined &&
        this.state.referenceWidth > 0
      ) {
        targetZoom = getResponsiveZoom(
          this.state.zoom,
          width,
          this.state.referenceWidth
        );
      } else if (prevWidth > 0 && this.state.preserveViewportSpan) {
        targetZoom = this.state.zoom + Math.log2(width / prevWidth);
      }
    }
    const nextState: ViewportState = { ...this.state, width, height };
    this.state = nextState;
    const nextZoom = this.clampZoom(targetZoom);
    const nextCenter = this.clampStateCenter(nextState.center, nextZoom);
    this.state = { ...nextState, zoom: nextZoom, center: nextCenter };
    this.emit();
  }

  getResponsiveZoom(baseZoom: number): number {
    if (
      this.state.width > 0 &&
      this.state.referenceWidth !== undefined &&
      this.state.referenceWidth > 0
    ) {
      return getResponsiveZoom(
        baseZoom,
        this.state.width,
        this.state.referenceWidth
      );
    }
    return baseZoom;
  }

  fitBounds(bounds: [LatLon, LatLon], paddingPx = 0, durationMs = 0): void {
    const { center, zoom } = computeZoomForBounds(
      bounds,
      this.state.width,
      this.state.height,
      paddingPx,
      this.projectionObj
    );
    if (durationMs > 0) {
      this.flyTo(center, zoom, durationMs);
    } else {
      this.setView(center, zoom);
    }
  }

  setConstraints(constraints: ViewportConstraints): void {
    const nextMinZoom = constraints.minZoom ?? this.state.minZoom;
    const nextMaxZoom = constraints.maxZoom ?? this.state.maxZoom;
    const nextMaxBounds =
      'maxBounds' in constraints ? constraints.maxBounds : this.state.maxBounds;
    const nextRefWidth =
      'referenceWidth' in constraints
        ? constraints.referenceWidth
        : this.state.referenceWidth;
    const nextPreserveSpan =
      'preserveViewportSpan' in constraints
        ? constraints.preserveViewportSpan
        : this.state.preserveViewportSpan;

    this.state = {
      ...this.state,
      minZoom: nextMinZoom,
      maxZoom: nextMaxZoom,
      ...(nextMaxBounds ? { maxBounds: nextMaxBounds } : {}),
      ...(nextRefWidth !== undefined ? { referenceWidth: nextRefWidth } : {}),
      ...(nextPreserveSpan !== undefined
        ? { preserveViewportSpan: nextPreserveSpan }
        : {}),
      ...(constraints.smooth !== undefined
        ? { smooth: constraints.smooth }
        : {}),
    };
    if ('maxBounds' in constraints && !constraints.maxBounds) {
      delete this.state.maxBounds;
    }
    if ('projection' in constraints) {
      this.projectionObj = resolveProjection(constraints.projection);
      if (constraints.projection !== undefined) {
        this.state.projection = constraints.projection;
      } else {
        delete this.state.projection;
      }
    }
    this.cachedNormBounds = getNormBounds(
      this.state.maxBounds,
      this.projectionObj
    );
    if (
      'referenceWidth' in constraints &&
      constraints.referenceWidth === undefined
    ) {
      delete this.state.referenceWidth;
    }
    if (
      'preserveViewportSpan' in constraints &&
      constraints.preserveViewportSpan === undefined
    ) {
      delete this.state.preserveViewportSpan;
    }
    if ('smooth' in constraints && constraints.smooth === undefined) {
      delete this.state.smooth;
    }

    const clampedZoom = this.clampZoom(this.state.zoom);
    const clampedCenter = this.clampStateCenter(this.state.center, clampedZoom);
    this.state = { ...this.state, zoom: clampedZoom, center: clampedCenter };
    this.emit();
  }

  private commitClampedView(
    center: LatLon,
    zoom: number,
    interactive: boolean
  ): void {
    const prevZoom = this.state.zoom;
    const clampedZoom = this.clampZoom(zoom);
    const clampedCenter = this.clampStateCenter(center, clampedZoom);
    const zoomChanged = Math.abs(clampedZoom - prevZoom) > 1e-6;
    this.startMotion(zoomChanged);
    this.state = {
      ...this.state,
      center: clampedCenter,
      zoom: clampedZoom,
    };
    this.lastChangeInteractive = interactive;
    this.emit(zoomChanged);
    this.finishMotionIfIdle();
  }

  setView(center: LatLon, zoom = this.state.zoom): void {
    this.cancelAnimation();
    this.commitClampedView(center, zoom, false);
  }

  panBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.cancelAnimation();
    this.startMotion(false);
    const worldSize = TILE_SIZE * Math.pow(2, this.state.zoom);
    const centerNorm = this.projectionObj.latLonToNorm(
      this.state.center[0],
      this.state.center[1],
      this.tmpNorm
    );
    const nextCenter = this.projectionObj.normToLatLon(
      centerNorm.x - dx / worldSize,
      centerNorm.y - dy / worldSize
    );
    const clamped = this.clampStateCenter(nextCenter, this.state.zoom);
    this.state = { ...this.state, center: clamped };
    this.lastChangeInteractive = true;
    this.emit(false);
    this.finishMotionIfIdle();
  }

  zoomAt(targetZoom: number, anchorX: number, anchorY: number): void {
    this.cancelAnimation();
    const nextZoom = this.clampZoom(targetZoom);
    if (Math.abs(nextZoom - this.state.zoom) < 1e-5) return;

    this.startMotion(true);

    const anchorLatLon = pxToLatLon(
      anchorX,
      anchorY,
      this.state,
      this.projectionObj
    );
    const nextWorldSize = TILE_SIZE * Math.pow(2, nextZoom);
    const anchorNorm = this.projectionObj.latLonToNorm(
      anchorLatLon[0],
      anchorLatLon[1],
      this.tmpNorm
    );
    const nextCenterNormX =
      anchorNorm.x - (anchorX - this.state.width * 0.5) / nextWorldSize;
    const nextCenterNormY =
      anchorNorm.y - (anchorY - this.state.height * 0.5) / nextWorldSize;

    const rawCenter = this.projectionObj.normToLatLon(
      nextCenterNormX,
      nextCenterNormY
    );
    const clampedCenter = this.clampStateCenter(rawCenter, nextZoom);
    this.state = { ...this.state, center: clampedCenter, zoom: nextZoom };
    this.lastChangeInteractive = true;
    this.emit(true);
    this.finishMotionIfIdle();
  }

  flyTo(
    targetCenter: LatLon,
    targetZoom = this.state.zoom,
    durationMs = 1500
  ): void {
    this.cancelAnimation();
    const startCenter = this.state.center;
    const startZoom = this.state.zoom;
    const endZoom = this.clampZoom(targetZoom);
    const endCenter = this.clampStateCenter(targetCenter, endZoom);

    if (durationMs <= 0 || typeof requestAnimationFrame === 'undefined') {
      this.setView(endCenter, endZoom);
      return;
    }

    const startTime = performance.now();
    let lastEmitTime = 0;
    const FLY_FRAME_INTERVAL_MS = 50; // Cap flyTo updates to 20 FPS unless unlocked
    const tmpFlyCenter: LatLon = [0, 0];
    const hasZoomDelta = Math.abs(endZoom - startZoom) > 1e-6;
    this.startMotion(hasZoomDelta);

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      if (
        !this.state.smooth &&
        t < 1 &&
        lastEmitTime !== 0 &&
        now - lastEmitTime < FLY_FRAME_INTERVAL_MS
      ) {
        this.flyRafId = requestAnimationFrame(tick);
        return;
      }
      lastEmitTime = now;
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);

      tmpFlyCenter[0] =
        startCenter[0] + (endCenter[0] - startCenter[0]) * eased;
      tmpFlyCenter[1] =
        startCenter[1] + (endCenter[1] - startCenter[1]) * eased;
      const zoom = startZoom + (endZoom - startZoom) * eased;

      const clampedCenter = this.clampStateCenter(tmpFlyCenter, zoom);
      this.state = { ...this.state, center: clampedCenter, zoom };
      this.lastChangeInteractive = true;
      if (t >= 1) {
        this.flyRafId = 0;
        this.emit(hasZoomDelta);
        this.finishMotionIfIdle();
      } else {
        this.emit(hasZoomDelta);
        this.flyRafId = requestAnimationFrame(tick);
      }
    };

    this.flyRafId = requestAnimationFrame(tick);
  }

  project(lat: number, lon: number): Point2D {
    return this.projectInto(lat, lon, { x: 0, y: 0 });
  }

  /**
   * Zero-allocation projection using cached center/worldSize state.
   */
  projectInto(lat: number, lon: number, out: Point2D): Point2D {
    this.projectionObj.latLonToNorm(lat, lon, this.tmpNorm);
    out.x =
      this.cachedHalfW +
      (this.tmpNorm.x - this.cachedCenterNormX) * this.cachedWorldSize;
    out.y =
      this.cachedHalfH +
      (this.tmpNorm.y - this.cachedCenterNormY) * this.cachedWorldSize;
    return out;
  }

  unproject(px: number, py: number): LatLon {
    return pxToLatLon(px, py, this.state, this.projectionObj);
  }

  getBounds(): LatLonBounds {
    return getViewportBounds(this.state, this.projectionObj);
  }

  /**
   * Returns cached normalized projection parameters for batch/WASM kernels.
   */
  getProjectionParams(): ProjectionParams {
    return this.cachedParams;
  }
}

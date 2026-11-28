import { createEmitter, type Unsubscribe } from './events';
import { type LatLon } from './projection';

export interface CruiseTarget {
  setView: (center: LatLon, zoom?: number) => void;
  flyTo: (center: LatLon, zoom?: number, durationMs?: number) => void;
  fitBounds?: (
    bounds: [LatLon, LatLon],
    paddingPx?: number,
    durationMs?: number
  ) => void;
  cancelAnimation?: () => void;
  getResponsiveZoom?: (baseZoom: number) => number;
  on?: (type: 'movestart', listener: () => void) => Unsubscribe;
}

export interface CruiseWaypoint<T = unknown> {
  center?: LatLon;
  bounds?: [LatLon, LatLon];
  paddingPx?: number;
  zoom?: number;
  durationMs?: number;
  dwellMs?: number;
  label?: string;
  data?: T;
}

export interface CruiseOverview {
  center?: LatLon;
  bounds?: [LatLon, LatLon];
  paddingPx?: number;
  zoom?: number;
  durationMs?: number;
  dwellMs?: number;
}

export type CruiseUserInteractAction = 'stop' | 'pause' | 'ignore';

export interface CruiseOptions<T = unknown> {
  /** Optional overview step executed at the start of each cycle. */
  overview?: CruiseOverview;
  /** Default flyTo/fitBounds duration in ms (default: 1500). */
  durationMs?: number;
  /** Default dwell time at each waypoint in ms (default: 2000). */
  dwellMs?: number;
  /** Use instant transitions (setView / 0ms fitBounds) when lowPower is true (default: false). */
  lowPower?: boolean;
  /** Scale waypoint/overview zoom via `target.getResponsiveZoom` (default: false). */
  responsiveZoom?: boolean;
  /** Loop continuously across cycles (default: true). */
  loop?: boolean;
  /** Behavior when user manually pans/zooms (default: 'stop'). */
  onUserInteract?: CruiseUserInteractAction;
  /** Delay in ms before auto-resuming when `onUserInteract === 'pause'`. */
  resumeAfterMs?: number;
  /** Called when arriving at a waypoint (e.g. select target). */
  onEnterWaypoint?: (waypoint: CruiseWaypoint<T>, index: number) => void;
  /** Called when leaving a waypoint (e.g. deselect target). */
  onLeaveWaypoint?: (waypoint: CruiseWaypoint<T>, index: number) => void;
}

export interface CruiseState {
  playing: boolean;
  paused: boolean;
  phase: 'idle' | 'overview' | 'waypoint';
  currentIndex: number;
  total: number;
  cycle: number;
}

export interface CruiseEventMap<T = unknown> extends Record<string, unknown> {
  start: CruiseState;
  stop: CruiseState;
  pause: CruiseState;
  resume: CruiseState;
  waypoint: {
    waypoint: CruiseWaypoint<T>;
    index: number;
    state: CruiseState;
  };
  complete: CruiseState;
}

export type WaypointSource<T = unknown> =
  readonly CruiseWaypoint<T>[] | (() => readonly CruiseWaypoint<T>[]);

export interface CruiseController<T = unknown> {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  setWaypoints: (waypoints: WaypointSource<T>) => void;
  setOptions: (partial: Partial<CruiseOptions<T>>) => void;
  getState: () => CruiseState;
  on: <K extends keyof CruiseEventMap<T>>(
    type: K,
    listener: (payload: CruiseEventMap<T>[K]) => void
  ) => Unsubscribe;
  destroy: () => void;
}

function navigateTarget(
  target: CruiseTarget,
  step: {
    center?: LatLon;
    bounds?: [LatLon, LatLon];
    paddingPx?: number;
    zoom?: number;
  },
  durationMs: number,
  responsiveZoom: boolean,
  lowPower: boolean
): void {
  const dur = lowPower ? 0 : durationMs;
  if (step.bounds && target.fitBounds) {
    target.fitBounds(step.bounds, step.paddingPx, dur);
    return;
  }
  if (!step.center) return;
  const z =
    step.zoom !== undefined && responsiveZoom && target.getResponsiveZoom
      ? target.getResponsiveZoom(step.zoom)
      : step.zoom;
  if (lowPower || dur <= 0) {
    target.setView(step.center, z);
    return;
  }
  target.flyTo(step.center, z, dur);
}

/**
 * Target-agnostic auto-cruise / guided tour controller compatible with Viewport,
 * MapInstance (`createMap`), or any custom CruiseTarget adapter.
 */
export function createCruiseController<T = unknown>(
  target: CruiseTarget,
  initialWaypoints: WaypointSource<T>,
  initialOptions: CruiseOptions<T> = {}
): CruiseController<T> {
  let source: WaypointSource<T> = initialWaypoints;
  let opts: CruiseOptions<T> = { ...initialOptions };
  let activeWaypoints: readonly CruiseWaypoint<T>[] = [];
  let destroyed = false;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEnteredIdx = -1;
  let navigatingInternal = false;

  const emitter = createEmitter<CruiseEventMap<T>>();
  const state: CruiseState = {
    playing: false,
    paused: false,
    phase: 'idle',
    currentIndex: -1,
    total: 0,
    cycle: 0,
  };

  const clearTimers = () => {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
    if (resumeTimer !== null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };

  const leaveActiveWaypoint = () => {
    if (lastEnteredIdx >= 0 && lastEnteredIdx < activeWaypoints.length) {
      opts.onLeaveWaypoint?.(activeWaypoints[lastEnteredIdx], lastEnteredIdx);
    }
    lastEnteredIdx = -1;
  };

  const performNavigate = (
    step: CruiseWaypoint<T> | CruiseOverview,
    defaultDuration: number
  ): number => {
    const lowPower = Boolean(opts.lowPower);
    const dur = lowPower
      ? 0
      : (step.durationMs ?? opts.durationMs ?? defaultDuration);
    navigatingInternal = true;
    try {
      navigateTarget(target, step, dur, Boolean(opts.responsiveZoom), lowPower);
    } finally {
      navigatingInternal = false;
    }
    return dur;
  };

  const scheduleNext = (delayMs: number, fn: () => void) => {
    clearTimers();
    dwellTimer = setTimeout(
      () => {
        dwellTimer = null;
        if (!state.playing || state.paused || destroyed) return;
        fn();
      },
      Math.max(0, delayMs)
    );
  };

  const stopInternal = (completed: boolean) => {
    clearTimers();
    leaveActiveWaypoint();
    target.cancelAnimation?.();
    state.playing = false;
    state.paused = false;
    state.phase = 'idle';
    state.currentIndex = -1;
    emitter.emit(completed ? 'complete' : 'stop', { ...state });
  };

  const runWaypoint = (idx: number) => {
    if (destroyed || !state.playing || state.paused) return;
    if (idx < 0 || idx >= activeWaypoints.length) {
      leaveActiveWaypoint();
      if (opts.loop ?? true) {
        startCycle(state.cycle + 1);
      } else {
        stopInternal(true);
      }
      return;
    }
    leaveActiveWaypoint();
    state.phase = 'waypoint';
    state.currentIndex = idx;
    const wp = activeWaypoints[idx];
    const dur = performNavigate(wp, 1500);
    const dwell = wp.dwellMs ?? opts.dwellMs ?? 2000;
    lastEnteredIdx = idx;
    opts.onEnterWaypoint?.(wp, idx);
    emitter.emit('waypoint', {
      waypoint: wp,
      index: idx,
      state: { ...state },
    });
    scheduleNext(dur + dwell, () => runWaypoint(idx + 1));
  };

  const resolveWaypoints = () => {
    activeWaypoints = typeof source === 'function' ? source() : source;
    state.total = activeWaypoints.length;
  };

  const runOverview = () => {
    if (!opts.overview) {
      runWaypoint(0);
      return;
    }
    state.phase = 'overview';
    state.currentIndex = -1;
    const dur = performNavigate(opts.overview, 1200);
    const dwell = opts.overview.dwellMs ?? opts.dwellMs ?? 2000;
    scheduleNext(dur + dwell, () => runWaypoint(0));
  };

  const startCycle = (cycleNum: number) => {
    if (destroyed || !state.playing || state.paused) return;
    resolveWaypoints();
    state.cycle = cycleNum;
    if (state.total === 0 && !opts.overview) {
      stopInternal(true);
      return;
    }
    if (opts.overview) {
      runOverview();
      return;
    }
    runWaypoint(0);
  };

  const pause = () => {
    if (!state.playing || state.paused || destroyed) return;
    clearTimers();
    target.cancelAnimation?.();
    state.paused = true;
    emitter.emit('pause', { ...state });
  };

  const resume = () => {
    if (!state.playing || !state.paused || destroyed) return;
    clearTimers();
    state.paused = false;
    emitter.emit('resume', { ...state });
    if (state.phase === 'overview' && opts.overview) {
      runOverview();
      return;
    }
    runWaypoint(Math.max(0, state.currentIndex));
  };

  const unsubMoveStart =
    target.on?.('movestart', () => {
      if (!state.playing || state.paused || navigatingInternal) return;
      const action = opts.onUserInteract ?? 'stop';
      if (action === 'ignore') return;
      if (action === 'stop') {
        stopInternal(false);
        return;
      }
      pause();
      if (opts.resumeAfterMs !== undefined && opts.resumeAfterMs > 0) {
        resumeTimer = setTimeout(() => {
          resumeTimer = null;
          if (!destroyed && state.playing && state.paused) resume();
        }, opts.resumeAfterMs);
      }
    }) ?? (() => {});

  const jumpTo = (calcIndex: (len: number) => number) => {
    if (destroyed) return;
    if (activeWaypoints.length === 0) resolveWaypoints();
    if (activeWaypoints.length === 0) return;
    state.playing = true;
    state.paused = false;
    runWaypoint(calcIndex(activeWaypoints.length));
  };

  return {
    start: () => {
      if (destroyed) return;
      clearTimers();
      leaveActiveWaypoint();
      state.playing = true;
      state.paused = false;
      emitter.emit('start', { ...state });
      startCycle(0);
    },
    stop: () => {
      if (!state.playing && state.phase === 'idle') return;
      stopInternal(false);
    },
    pause,
    resume,
    next: () => jumpTo((len) => (state.currentIndex + 1) % len),
    prev: () => jumpTo((len) => (state.currentIndex - 1 + len) % len),
    goTo: (index: number) =>
      jumpTo((len) => Math.max(0, Math.min(len - 1, index))),
    setWaypoints: (nextSource) => {
      source = nextSource;
      if (typeof nextSource !== 'function') {
        activeWaypoints = nextSource;
        state.total = activeWaypoints.length;
      }
    },
    setOptions: (partial) => {
      opts = { ...opts, ...partial };
    },
    getState: () => ({ ...state }),
    on: (type, listener) => emitter.on(type, listener),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      stopInternal(false);
      unsubMoveStart();
      emitter.clear();
    },
  };
}

import { type RefObject, useContext, useEffect, useRef, useState } from 'react';
import {
  createCruiseController,
  type CruiseController,
  type CruiseOptions,
  type CruiseState,
  type CruiseTarget,
  type WaypointSource,
} from '../core/cruise';
import { MapContext } from './MapContext';

export interface UseCruiseOptions<T = unknown> extends CruiseOptions<T> {
  autoStart?: boolean;
  target?: CruiseTarget;
}

export interface UseCruiseResult<T = unknown> {
  state: CruiseState;
  controller: CruiseController<T>;
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
}

function withLatestCallbacks<T>(
  base: UseCruiseOptions<T>,
  optionsRef: RefObject<UseCruiseOptions<T>>
): CruiseOptions<T> {
  return {
    ...base,
    onEnterWaypoint: (wp, idx) => optionsRef.current.onEnterWaypoint?.(wp, idx),
    onLeaveWaypoint: (wp, idx) => optionsRef.current.onLeaveWaypoint?.(wp, idx),
  };
}

/**
 * Manages a lifecycle-bound generic auto-cruise controller for `<MapView>` or any custom `CruiseTarget`.
 */
export function useCruise<T = unknown>(
  waypoints: WaypointSource<T>,
  options: UseCruiseOptions<T> = {}
): UseCruiseResult<T> {
  const mapCtx = useContext(MapContext);
  const resolvedTarget = options.target ?? mapCtx?.viewport;
  if (!resolvedTarget) {
    throw new Error(
      'useCruise requires a `target` option or must be used within a <MapView>'
    );
  }

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const waypointsRef = useRef(waypoints);
  waypointsRef.current = waypoints;

  const createCtrl = (target: CruiseTarget) =>
    createCruiseController<T>(
      target,
      waypointsRef.current,
      withLatestCallbacks(optionsRef.current, optionsRef)
    );

  const [controller, setController] = useState<CruiseController<T>>(() =>
    createCtrl(resolvedTarget)
  );
  const controllerTargetRef = useRef(resolvedTarget);
  const destroyedControllerRef = useRef<CruiseController<T> | null>(null);

  useEffect(() => {
    if (controllerTargetRef.current !== resolvedTarget) {
      controllerTargetRef.current = resolvedTarget;
      setController(createCtrl(resolvedTarget));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- createCtrl reads latest refs
  }, [resolvedTarget]);

  const [state, setState] = useState<CruiseState>(() => controller.getState());

  useEffect(() => {
    controller.setWaypoints(waypoints);
  }, [controller, waypoints]);

  useEffect(() => {
    controller.setOptions(withLatestCallbacks(options, optionsRef));
  }, [controller, options]);

  useEffect(() => {
    if (destroyedControllerRef.current === controller) {
      setController(createCtrl(controllerTargetRef.current));
      return;
    }

    const sync = () => {
      const next = controller.getState();
      setState((prev) =>
        prev.playing === next.playing &&
        prev.paused === next.paused &&
        prev.phase === next.phase &&
        prev.currentIndex === next.currentIndex &&
        prev.total === next.total &&
        prev.cycle === next.cycle
          ? prev
          : next
      );
    };
    const unsubs = [
      controller.on('start', sync),
      controller.on('stop', sync),
      controller.on('pause', sync),
      controller.on('resume', sync),
      controller.on('waypoint', sync),
      controller.on('complete', sync),
    ];
    sync();
    if (optionsRef.current.autoStart) {
      controller.start();
    }
    return () => {
      for (const unsub of unsubs) unsub();
      destroyedControllerRef.current = controller;
      controller.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- createCtrl reads latest refs
  }, [controller]);

  return {
    state,
    controller,
    start: controller.start,
    stop: controller.stop,
    pause: controller.pause,
    resume: controller.resume,
    next: controller.next,
    prev: controller.prev,
    goTo: controller.goTo,
  };
}

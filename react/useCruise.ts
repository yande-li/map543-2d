import { useContext, useEffect, useMemo, useRef, useState } from 'react';
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

  const controller = useMemo(
    () =>
      createCruiseController<T>(resolvedTarget, waypoints, {
        ...optionsRef.current,
        onEnterWaypoint: (wp, idx) =>
          optionsRef.current.onEnterWaypoint?.(wp, idx),
        onLeaveWaypoint: (wp, idx) =>
          optionsRef.current.onLeaveWaypoint?.(wp, idx),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- controller lifecycle is bound to resolvedTarget; waypoints & options synced below
    [resolvedTarget]
  );

  const [state, setState] = useState<CruiseState>(() => controller.getState());

  useEffect(() => {
    controller.setWaypoints(waypoints);
  }, [controller, waypoints]);

  useEffect(() => {
    controller.setOptions({
      ...options,
      onEnterWaypoint: (wp, idx) =>
        optionsRef.current.onEnterWaypoint?.(wp, idx),
      onLeaveWaypoint: (wp, idx) =>
        optionsRef.current.onLeaveWaypoint?.(wp, idx),
    });
  }, [controller, options]);

  useEffect(() => {
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
    if (optionsRef.current.autoStart) {
      controller.start();
    }
    return () => {
      for (const unsub of unsubs) unsub();
      controller.destroy();
    };
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

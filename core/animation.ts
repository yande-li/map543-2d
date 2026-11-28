/**
 * Converts a target FPS into a minimum frame interval in ms.
 * Returns `0` when unthrottled (`defaultFps = 0`, `fps <= 0`, or non-finite).
 */
export function resolveFrameIntervalMs(
  fps: number | undefined,
  defaultFps = 0
): number {
  const resolved = fps ?? defaultFps;
  if (!Number.isFinite(resolved) || resolved <= 0) return 0;
  return 1000 / resolved;
}

/**
 * Zero-allocation rAF frame-pacing gate.
 */
export function shouldAdvanceFrame(
  now: number,
  lastTime: number,
  minIntervalMs: number
): boolean {
  return (
    minIntervalMs <= 0 || lastTime === 0 || now - lastTime >= minIntervalMs
  );
}

/**
 * Computes a stepped `steps(N, end)` easing string from duration & target FPS,
 * or returns `smoothEasing` when unthrottled (`defaultFps = 0`, `fps <= 0`, or non-finite).
 */
export function resolveAnimationEasing(
  durationMs: number,
  fps: number | undefined,
  smoothEasing: string,
  defaultFps = 0,
  minSteps = 4
): string {
  const resolved = fps ?? defaultFps;
  if (!Number.isFinite(resolved) || resolved <= 0) return smoothEasing;
  const steps = Math.max(
    minSteps,
    Math.round((Math.max(0, durationMs) / 1000) * resolved)
  );
  return `steps(${steps}, end)`;
}

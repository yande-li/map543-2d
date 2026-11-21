import { Camera } from './camera';

export interface GamepadOptions {
  /** Maximum pan speed in CSS px/sec at full stick deflection (default: 700). */
  panSpeedPxPerSec?: number;
  /** Maximum zoom speed in zoom-levels/sec at full stick/trigger deflection (default: 2.2). */
  zoomSpeedPerSec?: number;
  /** Analog stick deadzone in [0..1] (default: 0.15). */
  deadzone?: number;
  /** Pan step in CSS px per D-pad tick (default: 18). */
  dpadStepPx?: number;
  /** Discrete zoom step when pressing LB/RB (default: 0.5). */
  zoomStep?: number;
}

function applyDeadzoneCurve(raw: number, deadzone: number): number {
  const abs = Math.abs(raw);
  if (abs <= deadzone) return 0;
  const norm = (abs - deadzone) / (1 - deadzone);
  return Math.sign(raw) * norm * norm;
}

/**
 * Attaches Gamepad API navigation to a Camera while at least one gamepad is connected.
 */
export function attachGamepad(
  camera: Camera,
  options: GamepadOptions = {}
): () => void {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    typeof navigator.getGamepads !== 'function' ||
    typeof requestAnimationFrame !== 'function'
  ) {
    return () => {};
  }

  const {
    panSpeedPxPerSec = 700,
    zoomSpeedPerSec = 2.2,
    deadzone = 0.15,
    dpadStepPx = 18,
    zoomStep = 0.5,
  } = options;

  const ACTIVE_INTERVAL_MS = 33; // ~30 FPS while actively panning/zooming
  const IDLE_INTERVAL_MS = 100; // 10 FPS when connected but idle

  let rafId = 0;
  let lastTime = 0;
  let lastPollTime = 0;
  let wasActive = false;
  let prevLb = false;
  let prevRb = false;

  const findConnectedGamepad = (): Gamepad | null => {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) return pads[i];
    }
    return null;
  };

  const hasConnectedGamepad = (): boolean => findConnectedGamepad() !== null;

  const stopLoop = () => {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastTime = 0;
    lastPollTime = 0;
    wasActive = false;
    prevLb = false;
    prevRb = false;
  };

  const readPanDelta = (pad: Gamepad, dt: number): [number, number] => {
    const axisX = applyDeadzoneCurve(pad.axes[0] ?? 0, deadzone);
    const axisY = applyDeadzoneCurve(pad.axes[1] ?? 0, deadzone);
    let panDx = -axisX * panSpeedPxPerSec * dt;
    let panDy = -axisY * panSpeedPxPerSec * dt;
    // D-pad (standard mapping: 12=Up, 13=Down, 14=Left, 15=Right)
    if (pad.buttons[12]?.pressed) panDy += dpadStepPx;
    if (pad.buttons[13]?.pressed) panDy -= dpadStepPx;
    if (pad.buttons[14]?.pressed) panDx += dpadStepPx;
    if (pad.buttons[15]?.pressed) panDx -= dpadStepPx;
    return [panDx, panDy];
  };

  const readZoomDelta = (pad: Gamepad, dt: number): number => {
    const rightY = applyDeadzoneCurve(pad.axes[3] ?? 0, deadzone);
    const lt = pad.buttons[6]?.value ?? 0;
    const rt = pad.buttons[7]?.value ?? 0;
    const triggerDelta = (rt > deadzone ? rt : 0) - (lt > deadzone ? lt : 0);
    const lbPressed = Boolean(pad.buttons[4]?.pressed);
    const rbPressed = Boolean(pad.buttons[5]?.pressed);
    let discreteZoom = 0;
    if (rbPressed && !prevRb) discreteZoom += zoomStep;
    if (lbPressed && !prevLb) discreteZoom -= zoomStep;
    prevLb = lbPressed;
    prevRb = rbPressed;
    return (-rightY + triggerDelta) * zoomSpeedPerSec * dt + discreteZoom;
  };

  const tick = (now: number) => {
    rafId = 0;
    const minInterval = wasActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
    if (lastPollTime > 0 && now - lastPollTime < minInterval) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    lastPollTime = now;

    const activePad = findConnectedGamepad();
    if (!activePad) {
      stopLoop();
      return;
    }

    const dt = lastTime > 0 ? Math.min(0.1, (now - lastTime) / 1000) : 1 / 30;
    lastTime = now;

    const [panDx, panDy] = readPanDelta(activePad, dt);
    if (panDx !== 0 || panDy !== 0) {
      camera.panBy(panDx, panDy);
    }

    const totalZoomDelta = readZoomDelta(activePad, dt);
    if (totalZoomDelta !== 0) {
      const s = camera.getState();
      camera.zoomAt(s.zoom + totalZoomDelta, s.width * 0.5, s.height * 0.5);
    }

    wasActive = panDx !== 0 || panDy !== 0 || totalZoomDelta !== 0;
    rafId = requestAnimationFrame(tick);
  };

  const ensureLoop = () => {
    if (rafId === 0 && hasConnectedGamepad()) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  };

  const onDisconnected = () => {
    if (!hasConnectedGamepad()) {
      stopLoop();
    }
  };

  window.addEventListener('gamepadconnected', ensureLoop);
  window.addEventListener('gamepaddisconnected', onDisconnected);
  ensureLoop();

  return () => {
    window.removeEventListener('gamepadconnected', ensureLoop);
    window.removeEventListener('gamepaddisconnected', onDisconnected);
    stopLoop();
  };
}

import { resolveFrameIntervalMs, shouldAdvanceFrame } from './animation';
import { Viewport } from './viewport';

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
  /** Polling rate in FPS while actively panning/zooming (default: 30; 0/Infinity for unthrottled). */
  activeFps?: number;
  /** Polling rate in FPS when connected but idle (default: 10; 0/Infinity for unthrottled). */
  idleFps?: number;
}

function applyDeadzoneCurve(raw: number, deadzone: number): number {
  const abs = Math.abs(raw);
  if (abs <= deadzone) return 0;
  const norm = (abs - deadzone) / (1 - deadzone);
  return Math.sign(raw) * norm * norm;
}

/**
 * Attaches Gamepad API navigation to a Viewport while at least one gamepad is connected.
 */
export function attachGamepad(
  viewport: Viewport,
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
    activeFps,
    idleFps,
  } = options;

  const activeIntervalMs = resolveFrameIntervalMs(activeFps, 30);
  const idleIntervalMs = resolveFrameIntervalMs(idleFps, 10);

  let rafId = 0;
  let lastTime = 0;
  let lastPollTime = 0;
  let gestureMode: 0 | 1 | 2 = 0; // 0 = idle, 1 = pan, 2 = zoom
  let prevLb = false;
  let prevRb = false;

  const endGamepadGesture = () => {
    while (gestureMode > 0) {
      gestureMode -= 1;
      viewport.endGesture();
    }
  };

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
    endGamepadGesture();
    lastTime = 0;
    lastPollTime = 0;
    prevLb = false;
    prevRb = false;
  };

  const readPanX = (pad: Gamepad, dt: number): number => {
    const axisX = applyDeadzoneCurve(pad.axes[0] ?? 0, deadzone);
    let dx = -axisX * panSpeedPxPerSec * dt;
    if (pad.buttons[14]?.pressed) dx += dpadStepPx;
    if (pad.buttons[15]?.pressed) dx -= dpadStepPx;
    return dx;
  };

  const readPanY = (pad: Gamepad, dt: number): number => {
    const axisY = applyDeadzoneCurve(pad.axes[1] ?? 0, deadzone);
    let dy = -axisY * panSpeedPxPerSec * dt;
    if (pad.buttons[12]?.pressed) dy += dpadStepPx;
    if (pad.buttons[13]?.pressed) dy -= dpadStepPx;
    return dy;
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
    const minInterval = gestureMode > 0 ? activeIntervalMs : idleIntervalMs;
    if (!shouldAdvanceFrame(now, lastPollTime, minInterval)) {
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

    const panDx = readPanX(activePad, dt);
    const panDy = readPanY(activePad, dt);
    const totalZoomDelta = readZoomDelta(activePad, dt);
    const hasPan = panDx !== 0 || panDy !== 0;
    const hasZoom = totalZoomDelta !== 0;
    if (hasPan || hasZoom) {
      if (gestureMode === 0) {
        gestureMode = hasZoom ? 2 : 1;
        viewport.beginGesture(hasZoom);
      } else if (hasZoom && gestureMode === 1) {
        gestureMode = 2;
        viewport.beginGesture(true);
      }
      if (hasPan) viewport.panBy(panDx, panDy);
      if (hasZoom) viewport.zoomBy(totalZoomDelta);
    } else if (gestureMode > 0) {
      endGamepadGesture();
    }

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

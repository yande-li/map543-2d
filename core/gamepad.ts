import { Camera } from './camera';

export interface GamepadControlsOptions {
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
 * Attaches tree-shakeable Gamepad API navigation to a Camera.
 * Zero idle overhead: only runs a requestAnimationFrame loop while at least one gamepad is connected.
 */
export function attachGamepadControls(
  camera: Camera,
  options: GamepadControlsOptions = {}
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

  const hasConnectedGamepad = (): boolean => {
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) return true;
    }
    return false;
  };

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

  const tick = (now: number) => {
    rafId = 0;
    const minInterval = wasActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
    if (lastPollTime > 0 && now - lastPollTime < minInterval) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    lastPollTime = now;

    const pads = navigator.getGamepads();
    let activePad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) {
        activePad = pads[i];
        break;
      }
    }
    if (!activePad) {
      stopLoop();
      return;
    }

    const dt = lastTime > 0 ? Math.min(0.1, (now - lastTime) / 1000) : 1 / 30;
    lastTime = now;

    // Left stick: smooth analog pan
    const axisX = applyDeadzoneCurve(activePad.axes[0] ?? 0, deadzone);
    const axisY = applyDeadzoneCurve(activePad.axes[1] ?? 0, deadzone);
    let panDx = -axisX * panSpeedPxPerSec * dt;
    let panDy = -axisY * panSpeedPxPerSec * dt;

    // D-pad (standard mapping: 12=Up, 13=Down, 14=Left, 15=Right)
    if (activePad.buttons[12]?.pressed) panDy += dpadStepPx;
    if (activePad.buttons[13]?.pressed) panDy -= dpadStepPx;
    if (activePad.buttons[14]?.pressed) panDx += dpadStepPx;
    if (activePad.buttons[15]?.pressed) panDx -= dpadStepPx;

    if (panDx !== 0 || panDy !== 0) {
      camera.panBy(panDx, panDy);
    }

    // Right stick Y (axis 3) or triggers (LT=6, RT=7) for continuous zoom
    const rightY = applyDeadzoneCurve(activePad.axes[3] ?? 0, deadzone);
    const lt = activePad.buttons[6]?.value ?? 0;
    const rt = activePad.buttons[7]?.value ?? 0;
    const triggerDelta =
      (rt > deadzone ? rt : 0) - (lt > deadzone ? lt : 0);
    const zoomInput = -rightY + triggerDelta;

    const lbPressed = Boolean(activePad.buttons[4]?.pressed);
    const rbPressed = Boolean(activePad.buttons[5]?.pressed);
    let discreteZoom = 0;
    if (rbPressed && !prevRb) discreteZoom += zoomStep;
    if (lbPressed && !prevLb) discreteZoom -= zoomStep;
    prevLb = lbPressed;
    prevRb = rbPressed;

    const totalZoomDelta = zoomInput * zoomSpeedPerSec * dt + discreteZoom;
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

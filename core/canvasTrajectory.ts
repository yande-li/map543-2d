import { traceArc } from './curves';

/**
 * Creates a small offscreen radial-gradient dot sprite for fast Canvas blitting.
 */
export function createGlowDotSprite(
  color: string,
  size = 10,
  innerColor = '#ffffff'
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const sctx = sprite.getContext('2d');
  if (!sctx) return null;

  const half = size / 2;
  const grad = sctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(0.22, color);
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, 'transparent');

  sctx.fillStyle = grad;
  sctx.beginPath();
  sctx.arc(half, half, half, 0, Math.PI * 2);
  sctx.fill();
  return sprite;
}

interface ParsedTrajectoryArgs {
  dstArray: Float32Array | null;
  singleDstX: number;
  singleDstY: number;
  viewportW: number;
  viewportH: number;
  color: string;
  sprite: HTMLCanvasElement | null;
  margin: number;
  straightLimit: number;
}

function parseTrajectoryArgs(
  dstXOrXY: number | Float32Array,
  dstYOrViewportW: number,
  viewportWOrH: number,
  viewportHOrColor?: number | string,
  colorOrSprite?: string | HTMLCanvasElement | null,
  spriteOrMargin?: HTMLCanvasElement | null | number,
  marginOrStraightThreshold?: number,
  straightThreshold = 100
): ParsedTrajectoryArgs {
  if (typeof dstXOrXY === 'number') {
    return {
      dstArray: null,
      singleDstX: dstXOrXY,
      singleDstY: dstYOrViewportW,
      viewportW: viewportWOrH,
      viewportH: viewportHOrColor as number,
      color: (colorOrSprite as string | undefined) ?? '#0ebf9c',
      sprite: (spriteOrMargin as HTMLCanvasElement | null | undefined) ?? null,
      margin: marginOrStraightThreshold ?? 50,
      straightLimit: straightThreshold,
    };
  }
  return {
    dstArray: dstXOrXY,
    singleDstX: 0,
    singleDstY: 0,
    viewportW: dstYOrViewportW,
    viewportH: viewportWOrH,
    color: (viewportHOrColor as string | undefined) ?? '#0ebf9c',
    sprite: (colorOrSprite as HTMLCanvasElement | null | undefined) ?? null,
    margin: typeof spriteOrMargin === 'number' ? spriteOrMargin : 50,
    straightLimit: marginOrStraightThreshold ?? straightThreshold,
  };
}

function drawTrajectorySourceDots(
  ctx: CanvasRenderingContext2D,
  srcXY: Float32Array,
  count: number,
  color: string,
  sprite: HTMLCanvasElement | null,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): void {
  if (sprite) {
    const half = sprite.width / 2;
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < count; i++) {
      const srcX = srcXY[i * 2];
      const srcY = srcXY[i * 2 + 1];
      if (srcX < minX || srcX > maxX || srcY < minY || srcY > maxY) continue;
      ctx.drawImage(sprite, srcX - half, srcY - half);
    }
    return;
  }

  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  for (let i = 0; i < count; i++) {
    const srcX = srcXY[i * 2];
    const srcY = srcXY[i * 2 + 1];
    if (srcX < minX || srcX > maxX || srcY < minY || srcY > maxY) continue;
    ctx.rect(srcX - 2, srcY - 2, 4, 4);
  }
  ctx.fill();
}

/**
 * Draws a batch of screen-space quadratic Bezier trajectories (with frustum culling,
 * dual-stroke glow without shadowBlur, and optional pre-rendered source dot sprites).
 *
 * Multi-to-one overload (shared destination point).
 */
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  srcXY: Float32Array,
  count: number,
  dstX: number,
  dstY: number,
  viewportW: number,
  viewportH: number,
  color?: string,
  sprite?: HTMLCanvasElement | null,
  margin?: number,
  straightThreshold?: number
): void;
/**
 * Multi-to-multi overload (per-trajectory destination coordinates in `dstXY`).
 */
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  srcXY: Float32Array,
  count: number,
  dstXY: Float32Array,
  viewportW: number,
  viewportH: number,
  color?: string,
  sprite?: HTMLCanvasElement | null,
  margin?: number,
  straightThreshold?: number
): void;
export function drawTrajectories(
  ctx: CanvasRenderingContext2D,
  srcXY: Float32Array,
  count: number,
  dstXOrXY: number | Float32Array,
  dstYOrViewportW: number,
  viewportWOrH: number,
  viewportHOrColor?: number | string,
  colorOrSprite?: string | HTMLCanvasElement | null,
  spriteOrMargin?: HTMLCanvasElement | null | number,
  marginOrStraightThreshold?: number,
  straightThreshold = 100
): void {
  if (count <= 0) return;

  const {
    dstArray,
    singleDstX,
    singleDstY,
    viewportW,
    viewportH,
    color,
    sprite,
    margin,
    straightLimit,
  } = parseTrajectoryArgs(
    dstXOrXY,
    dstYOrViewportW,
    viewportWOrH,
    viewportHOrColor,
    colorOrSprite,
    spriteOrMargin,
    marginOrStraightThreshold,
    straightThreshold
  );

  const minX = -margin;
  const minY = -margin;
  const maxX = viewportW + margin;
  const maxY = viewportH + margin;
  const singleDstIn =
    dstArray === null &&
    singleDstX >= minX &&
    singleDstX <= maxX &&
    singleDstY >= minY &&
    singleDstY <= maxY;

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';

  for (let i = 0; i < count; i++) {
    const srcX = srcXY[i * 2];
    const srcY = srcXY[i * 2 + 1];
    const targetX = dstArray !== null ? dstArray[i * 2] : singleDstX;
    const targetY = dstArray !== null ? dstArray[i * 2 + 1] : singleDstY;

    const srcIn = srcX >= minX && srcX <= maxX && srcY >= minY && srcY <= maxY;
    const dstIn =
      dstArray !== null
        ? targetX >= minX &&
          targetX <= maxX &&
          targetY >= minY &&
          targetY <= maxY
        : singleDstIn;

    if (!srcIn && !dstIn) continue;

    ctx.moveTo(srcX, srcY);
    traceArc(ctx, srcX, srcY, targetX, targetY, straightLimit);
  }

  ctx.lineWidth = 3.5;
  ctx.globalAlpha = 0.14;
  ctx.stroke();

  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.72;
  ctx.stroke();

  drawTrajectorySourceDots(
    ctx,
    srcXY,
    count,
    color,
    sprite,
    minX,
    minY,
    maxX,
    maxY
  );
}

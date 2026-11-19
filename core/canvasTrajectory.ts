import { traceScreenQuadraticArc } from './curves';

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

/**
 * Draws a batch of screen-space quadratic Bezier trajectories (with frustum culling,
 * dual-stroke glow without shadowBlur, and optional pre-rendered source dot sprites).
 *
 * Supports both multi-to-one (scalar dstX, dstY) and multi-to-multi (Float32Array dstXY)
 * with zero heap allocations in the hot rendering loop.
 */
export function drawScreenTrajectoryBatch(
  ctx: CanvasRenderingContext2D,
  srcXY: Float32Array,
  count: number,
  dstXOrXY: number | Float32Array,
  dstYOrViewportW: number,
  viewportWOrH: number,
  viewportHOrColor: number | string,
  colorOrSprite?: string | HTMLCanvasElement | null,
  spriteOrMargin?: HTMLCanvasElement | null | number,
  marginOrStraightThreshold?: number,
  straightThreshold = 100
): void {
  if (count <= 0) return;

  const isMultiDst = typeof dstXOrXY !== 'number';
  const dstArray = isMultiDst ? (dstXOrXY as Float32Array) : null;
  const singleDstX = isMultiDst ? 0 : (dstXOrXY as number);
  const singleDstY = isMultiDst ? 0 : dstYOrViewportW;

  const viewportW = isMultiDst ? dstYOrViewportW : viewportWOrH;
  const viewportH = (isMultiDst ? viewportWOrH : (viewportHOrColor as number));
  const color = (isMultiDst
    ? (viewportHOrColor as string)
    : (colorOrSprite as string)) ?? '#0ebf9c';
  const sprite = (isMultiDst
    ? (colorOrSprite as HTMLCanvasElement | null)
    : (spriteOrMargin as HTMLCanvasElement | null)) ?? null;
  const margin = (isMultiDst
    ? (typeof spriteOrMargin === 'number' ? spriteOrMargin : 50)
    : (typeof marginOrStraightThreshold === 'number'
        ? marginOrStraightThreshold
        : 50));
  const straightLimit = isMultiDst
    ? (typeof marginOrStraightThreshold === 'number'
        ? marginOrStraightThreshold
        : straightThreshold)
    : straightThreshold;

  const minX = -margin;
  const minY = -margin;
  const maxX = viewportW + margin;
  const maxY = viewportH + margin;
  const singleDstIn =
    !isMultiDst &&
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
    traceScreenQuadraticArc(ctx, srcX, srcY, targetX, targetY, straightLimit);
  }

  ctx.lineWidth = 3.5;
  ctx.globalAlpha = 0.14;
  ctx.stroke();

  ctx.lineWidth = 1.4;
  ctx.globalAlpha = 0.72;
  ctx.stroke();

  if (sprite) {
    const half = sprite.width / 2;
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < count; i++) {
      const srcX = srcXY[i * 2];
      const srcY = srcXY[i * 2 + 1];
      if (srcX < minX || srcX > maxX || srcY < minY || srcY > maxY) continue;
      ctx.drawImage(sprite, srcX - half, srcY - half);
    }
  } else {
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
}

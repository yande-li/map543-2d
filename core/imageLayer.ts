import { Camera } from './camera';
import { LatLng, Point2D } from './projection';

const TMP_NW: Point2D = { x: 0, y: 0 };
const TMP_SE: Point2D = { x: 0, y: 0 };

export type ImageBounds = [LatLng, LatLng];

export interface DrawImageOptions {
  opacity?: number;
  imageSmoothingEnabled?: boolean;
}

/**
 * Loads an image (PNG, WebP, SVG, JPEG, data URI, or blob URL) and resolves once decoded.
 */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load geo image: ${src}`));
    img.src = src;
  });

  if (typeof img.decode === 'function') {
    try {
      await img.decode();
    } catch {
      // SVG or already-decoded images may reject decode() in some engines
    }
  }
  return img;
}

/**
 * Draws a georeferenced image onto a 2D canvas using the camera's active projection.
 */
export function drawImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  bounds: ImageBounds,
  camera: Camera,
  options: DrawImageOptions = {}
): void {
  const minLat = Math.min(bounds[0][0], bounds[1][0]);
  const maxLat = Math.max(bounds[0][0], bounds[1][0]);
  const minLon = Math.min(bounds[0][1], bounds[1][1]);
  const maxLon = Math.max(bounds[0][1], bounds[1][1]);

  const nw = camera.projectInto(maxLat, minLon, TMP_NW);
  const se = camera.projectInto(minLat, maxLon, TMP_SE);
  const drawW = se.x - nw.x;
  const drawH = se.y - nw.y;
  if (drawW <= 0 || drawH <= 0) return;

  const { opacity = 1, imageSmoothingEnabled = true } = options;
  ctx.save();
  if (opacity < 1) {
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  }
  ctx.imageSmoothingEnabled = imageSmoothingEnabled;
  ctx.drawImage(img, nw.x, nw.y, drawW, drawH);
  ctx.restore();
}

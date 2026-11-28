import { Viewport } from './viewport';
import { MapError } from './errors';
import {
  getBoundsExtent,
  type BoundsExtent,
  type GeoBounds,
  type Point2D,
} from './projection';

export const DEFAULT_WORLD_BOUNDS: GeoBounds = [
  [-90, -180],
  [90, 180],
];

const TMP_EXTENT: BoundsExtent = { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };

const TMP_NW: Point2D = { x: 0, y: 0 };
const TMP_SE: Point2D = { x: 0, y: 0 };

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
    img.onerror = () =>
      reject(
        new MapError('IMAGE_DECODE_ERROR', `Failed to load geo image: ${src}`)
      );
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
 * Draws a georeferenced image onto a 2D canvas using the viewport's active projection.
 */
export function drawImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  bounds: GeoBounds,
  viewport: Viewport,
  options: DrawImageOptions = {}
): void {
  const { minLat, maxLat, minLon, maxLon } = getBoundsExtent(
    bounds,
    TMP_EXTENT
  );

  const nw = viewport.projectInto(maxLat, minLon, TMP_NW);
  const se = viewport.projectInto(minLat, maxLon, TMP_SE);
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

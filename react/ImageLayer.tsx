import React, { useCallback, useEffect, useState } from 'react';
import { Viewport, ViewportState } from '../core/viewport';
import { drawImage, loadImage } from '../core/imageLayer';
import { type GeoBounds } from '../core/projection';
import { CanvasLayer } from './CanvasLayer';

export interface ImageLayerProps {
  /** Image URL or data URI (supports PNG, WebP, SVG, JPEG). */
  src?: string;
  /** Pre-loaded image source (takes precedence over `src` when provided). */
  image?: CanvasImageSource;
  /** Geographic bounds [[minLat, minLon], [maxLat, maxLon]] (default: [[-90, -180], [90, 180]]). */
  bounds?: GeoBounds;
  zIndex?: number;
  opacity?: number;
  maxDpr?: number;
  imageSmoothingEnabled?: boolean;
  className?: string;
}

const DEFAULT_WORLD_BOUNDS: GeoBounds = [
  [-90, -180],
  [90, 180],
];

/**
 * Renders a georeferenced raster or vector image (PNG, WebP, SVG) synchronized with Viewport.
 */
export const ImageLayer: React.FC<ImageLayerProps> = ({
  src,
  image,
  bounds = DEFAULT_WORLD_BOUNDS,
  zIndex = 50,
  opacity = 1,
  maxDpr = 2,
  imageSmoothingEnabled = true,
  className = '',
}) => {
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null);
  const b0Lat = bounds[0][0];
  const b0Lon = bounds[0][1];
  const b1Lat = bounds[1][0];
  const b1Lon = bounds[1][1];

  useEffect(() => {
    if (image || !src) {
      setLoadedImg(null);
      return;
    }
    let active = true;
    void loadImage(src)
      .then((img) => {
        if (active) setLoadedImg(img);
      })
      .catch(() => {
        if (active) setLoadedImg(null);
      });
    return () => {
      active = false;
    };
  }, [src, image]);

  const activeImg = image ?? loadedImg;

  const onDraw = useCallback(
    (ctx: CanvasRenderingContext2D, _state: ViewportState, cam: Viewport) => {
      if (!activeImg) return;
      drawImage(
        ctx,
        activeImg,
        [
          [b0Lat, b0Lon],
          [b1Lat, b1Lon],
        ],
        cam,
        {
          opacity,
          imageSmoothingEnabled,
        }
      );
    },
    [activeImg, b0Lat, b0Lon, b1Lat, b1Lon, opacity, imageSmoothingEnabled]
  );

  return (
    <CanvasLayer
      zIndex={zIndex}
      maxDpr={maxDpr}
      className={className}
      onDraw={onDraw}
    />
  );
};

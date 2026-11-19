import React, { useCallback, useEffect, useState } from 'react';
import { Camera, ViewportState } from '../core/camera';
import {
  drawImage,
  ImageBounds,
  loadImage,
} from '../core/imageLayer';
import { CanvasLayer } from './CanvasLayer';

export interface ImageLayerProps {
  /** Image URL or data URI (supports PNG, WebP, SVG, JPEG). */
  src: string;
  /** Geographic bounds [[minLat, minLon], [maxLat, maxLon]] (default: [[-90, -180], [90, 180]]). */
  bounds?: ImageBounds;
  zIndex?: number;
  opacity?: number;
  maxDpr?: number;
  imageSmoothingEnabled?: boolean;
  className?: string;
}

const DEFAULT_WORLD_BOUNDS: ImageBounds = [
  [-90, -180],
  [90, 180],
];

/**
 * Renders a georeferenced raster or vector image (PNG, WebP, SVG) synchronized with Camera.
 */
export const ImageLayer: React.FC<ImageLayerProps> = ({
  src,
  bounds = DEFAULT_WORLD_BOUNDS,
  zIndex = 50,
  opacity = 1,
  maxDpr = 2,
  imageSmoothingEnabled = true,
  className = '',
}) => {
  const [loadedImg, setLoadedImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
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
  }, [src]);

  const onDraw = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _state: ViewportState,
      cam: Camera
    ) => {
      if (!loadedImg) return;
      drawImage(ctx, loadedImg, bounds, cam, {
        opacity,
        imageSmoothingEnabled,
      });
    },
    [loadedImg, bounds, opacity, imageSmoothingEnabled]
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

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MAP_Z_INDEX } from '../core/controls';
import { boundsIntersects } from '../core/projection';
import {
  type PreparedArc,
  type TrajectoryCurveMode,
  type TrajectoryItem,
  animateStroke,
  attachSvgSync,
  prepareArcs,
  scheduleAnimation,
} from '../core/trajectory';
import { useMap } from './MapContext';

export type { TrajectoryCurveMode, TrajectoryItem };

export interface TrajectoryLayerProps {
  items: readonly TrajectoryItem[];
  animationKey?: number;
  strokeWidth?: number;
  showBasePath?: boolean;
  baseStrokeWidth?: number;
  baseOpacity?: number;
  zIndex?: number;
  /** Enable dash flight animation (default: true; false renders static strokes). */
  animated?: boolean;
  /** Target frame rate in FPS for stepped stroke animation (default: unthrottled; e.g. 18 for stepped). */
  fps?: number;
  /** Use C1-continuous quadratic Bezier SVG curves instead of polylines (default: false). */
  curveSmooth?: boolean;
  /** Skip creating SVG paths/animations for arcs completely outside viewport bounds (default: true). */
  cullOffscreen?: boolean;
}

interface TrajectoryStrokeProps {
  item: PreparedArc;
  animationKey: number;
  strokeWidth: number;
  animated: boolean;
  fps: number | undefined;
  registerPath: (key: string, el: SVGPathElement | null) => void;
}

const TrajectoryStroke: React.FC<TrajectoryStrokeProps> = memo(
  ({ item, animationKey, strokeWidth, animated, fps, registerPath }) => {
    const pathRef = useRef<SVGPathElement | null>(null);
    const animationRef = useRef<Animation | null>(null);

    const setRef = (el: SVGPathElement | null) => {
      pathRef.current = el;
      registerPath(item.key, el);
    };

    useEffect(() => {
      if (!animated) return;
      const runAnimation = () => {
        const currentEl = pathRef.current;
        if (!currentEl) return;
        if (animationRef.current) {
          animationRef.current.cancel();
          animationRef.current = null;
        }
        animationRef.current = animateStroke(
          currentEl,
          item.dashRatio,
          item.duration,
          fps
        );
      };

      const cancelScheduled = scheduleAnimation(runAnimation);
      return () => {
        cancelScheduled();
        if (animationRef.current) {
          animationRef.current.cancel();
          animationRef.current = null;
        }
      };
    }, [
      item.src,
      item.dst,
      item.isStraight,
      item.dashRatio,
      item.duration,
      animationKey,
      animated,
      fps,
    ]);

    return (
      <path
        ref={setRef}
        className={item.className}
        stroke={item.color}
        strokeWidth={strokeWidth}
        strokeOpacity={animated ? 0 : 0.65}
        strokeLinecap="round"
        fill="none"
      />
    );
  }
);
TrajectoryStroke.displayName = 'TrajectoryStroke';

/**
 * React wrapper around core/trajectory batching and viewport sync.
 */
export const TrajectoryLayer: React.FC<TrajectoryLayerProps> = memo(
  ({
    items,
    animationKey = 0,
    strokeWidth = 2,
    showBasePath = true,
    baseStrokeWidth = 1,
    baseOpacity = 0.14,
    zIndex = MAP_Z_INDEX.trajectory,
    animated = true,
    fps,
    curveSmooth = false,
    cullOffscreen = true,
  }) => {
    const { viewport } = useMap();
    const svgRef = useRef<SVGSVGElement | null>(null);
    const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());
    const basePathRefs = useRef<Map<string, SVGPathElement>>(new Map());
    const [viewBounds, setViewBounds] = useState(() => {
      const s = viewport.getState();
      return s.width > 0 && s.height > 0 ? viewport.getBounds() : null;
    });

    useEffect(() => {
      if (!cullOffscreen) {
        setViewBounds(null);
        return;
      }
      const sync = () => {
        const s = viewport.getState();
        setViewBounds(
          s.width > 0 && s.height > 0 ? viewport.getBounds() : null
        );
      };
      sync();
      return viewport.on('moveend', sync);
    }, [viewport, cullOffscreen]);

    const visibleItems = useMemo(() => {
      if (!cullOffscreen || !viewBounds) return items;
      return items.filter((item) => {
        const sLat = item.src?.[0] ?? item.srcLat ?? 0;
        const sLon = item.src?.[1] ?? item.srcLon ?? 0;
        const dLat = item.dst?.[0] ?? item.dstLat ?? 0;
        const dLon = item.dst?.[1] ?? item.dstLon ?? 0;
        return boundsIntersects(
          [
            [Math.min(sLat, dLat), Math.min(sLon, dLon)],
            [Math.max(sLat, dLat), Math.max(sLon, dLon)],
          ],
          viewBounds
        );
      });
    }, [items, cullOffscreen, viewBounds]);

    const registerPath = useCallback(
      (key: string, el: SVGPathElement | null) => {
        if (el) {
          pathRefs.current.set(key, el);
        } else {
          pathRefs.current.delete(key);
        }
      },
      []
    );

    const prepared = useMemo(() => prepareArcs(visibleItems), [visibleItems]);

    useEffect(() => {
      return attachSvgSync(
        svgRef.current,
        viewport,
        prepared,
        (key) => pathRefs.current.get(key),
        (key) => basePathRefs.current.get(key),
        curveSmooth
      );
    }, [viewport, prepared, curveSmooth]);

    return (
      <svg
        ref={svgRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex,
          overflow: 'visible',
          ...(animated ? { willChange: 'transform' } : {}),
        }}
      >
        {prepared.items.map((item) => (
          <React.Fragment key={item.key}>
            {showBasePath && (
              <path
                ref={(el) => {
                  if (el) {
                    basePathRefs.current.set(item.key, el);
                  } else {
                    basePathRefs.current.delete(item.key);
                  }
                }}
                stroke={item.color}
                strokeWidth={baseStrokeWidth}
                strokeOpacity={baseOpacity}
                strokeLinecap="round"
                fill="none"
              />
            )}
            <TrajectoryStroke
              item={item}
              animationKey={animationKey}
              strokeWidth={strokeWidth}
              animated={animated}
              fps={fps}
              registerPath={registerPath}
            />
          </React.Fragment>
        ))}
      </svg>
    );
  }
);
TrajectoryLayer.displayName = 'TrajectoryLayer';

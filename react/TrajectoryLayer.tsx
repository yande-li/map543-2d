import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type PreparedTrajectoryEntry,
  type TrajectoryCurveMode,
  type TrajectorySpec,
  animateTrajectoryStroke,
  attachSvgTrajectorySync,
  prepareTrajectoryBatch,
  scheduleStrokeAnimation,
} from '../core/trajectory';
import { initWasm, isWasmReady } from '../wasm/wasmBridge';
import { useMap } from './MapContext';

export type { TrajectoryCurveMode, TrajectorySpec as TrajectoryItem };

export interface TrajectoryLayerProps {
  items: TrajectorySpec[];
  animationKey?: number;
  strokeWidth?: number;
  showBasePath?: boolean;
  baseStrokeWidth?: number;
  baseOpacity?: number;
  zIndex?: number;
  lowPower?: boolean;
  /** Unlock 18fps stepped easing for full-framerate smooth stroke animation (default: false). */
  smooth?: boolean;
}

interface TrajectoryStrokeProps {
  item: PreparedTrajectoryEntry;
  animationKey: number;
  strokeWidth: number;
  lowPower: boolean;
  smooth: boolean;
  registerPath: (key: string, el: SVGPathElement | null) => void;
}

const TrajectoryStroke: React.FC<TrajectoryStrokeProps> = memo(
  ({ item, animationKey, strokeWidth, lowPower, smooth, registerPath }) => {
    const pathRef = useRef<SVGPathElement | null>(null);
    const animationRef = useRef<Animation | null>(null);

    const setRef = (el: SVGPathElement | null) => {
      pathRef.current = el;
      registerPath(item.key, el);
    };

    useEffect(() => {
      if (lowPower) return;
      const runAnimation = () => {
        const currentEl = pathRef.current;
        if (!currentEl) return;
        if (animationRef.current) {
          animationRef.current.cancel();
          animationRef.current = null;
        }
        animationRef.current = animateTrajectoryStroke(
          currentEl,
          item.dashRatio,
          item.duration,
          smooth
        );
      };

      const cancelScheduled = scheduleStrokeAnimation(runAnimation);
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
      lowPower,
      smooth,
    ]);

    return (
      <path
        ref={setRef}
        className={item.className}
        stroke={item.color}
        strokeWidth={strokeWidth}
        strokeOpacity={lowPower ? 0.65 : 0}
        strokeLinecap="round"
        fill="none"
      />
    );
  }
);
TrajectoryStroke.displayName = 'TrajectoryStroke';

/**
 * Thin React wrapper around core/trajectory batching and camera sync.
 */
export const TrajectoryLayer: React.FC<TrajectoryLayerProps> = memo(
  ({
    items,
    animationKey = 0,
    strokeWidth = 2,
    showBasePath = true,
    baseStrokeWidth = 1,
    baseOpacity = 0.14,
    zIndex = 350,
    lowPower = false,
    smooth = false,
  }) => {
    const { camera } = useMap();
    const [wasmReady, setWasmReady] = useState(() => isWasmReady());
    const svgRef = useRef<SVGSVGElement | null>(null);
    const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());
    const basePathRefs = useRef<Map<string, SVGPathElement>>(new Map());

    useEffect(() => {
      if (wasmReady) return;
      let cancelled = false;
      void initWasm()
        .then(() => {
          if (!cancelled) {
            setWasmReady(true);
          }
        })
        .catch(() => {
          // Keep wasmReady false if WASM runtime fails to initialize
        });
      return () => {
        cancelled = true;
      };
    }, [wasmReady]);

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

    const prepared = useMemo(() => prepareTrajectoryBatch(items), [items]);

    useEffect(() => {
      if (!wasmReady) return;
      return attachSvgTrajectorySync(
        svgRef.current,
        camera,
        prepared,
        (key) => pathRefs.current.get(key),
        (key) => basePathRefs.current.get(key),
        smooth
      );
    }, [camera, prepared, smooth, wasmReady]);

    if (!wasmReady) {
      return null;
    }

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
          ...(lowPower ? {} : { willChange: 'transform' }),
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
              lowPower={lowPower}
              smooth={smooth}
              registerPath={registerPath}
            />
          </React.Fragment>
        ))}
      </svg>
    );
  }
);
TrajectoryLayer.displayName = 'TrajectoryLayer';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { type ControlPosition } from '../core/controls';
import { useMap } from './MapContext';

export interface MapControlProps {
  position?: ControlPosition;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * Declaratively mounts UI controls into a corner flex slot of <MapView>.
 */
export const MapControl: React.FC<MapControlProps> = ({
  position = 'top-right',
  className = '',
  style,
  children,
}) => {
  const { getControlSlot, releaseControlSlot } = useMap();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const target = getControlSlot?.(position) ?? null;
    setSlot(target);
    return () => {
      setSlot(null);
      queueMicrotask(() => {
        releaseControlSlot?.(position);
      });
    };
  }, [getControlSlot, releaseControlSlot, position]);

  if (!slot) return null;

  return createPortal(
    <div
      className={className ? `map-control ${className}` : 'map-control'}
      style={{ pointerEvents: 'auto', ...style }}
    >
      {children}
    </div>,
    slot
  );
};

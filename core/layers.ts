export interface LayerHandle {
  remove: () => void;
  setVisible?: (visible: boolean) => void;
  setOpacity?: (opacity: number) => void;
  setZIndex?: (zIndex: number) => void;
}

export interface LayerGroup {
  add: (layer: LayerHandle) => () => void;
  remove: (layer: LayerHandle) => void;
  setVisible: (visible: boolean) => void;
  setOpacity: (opacity: number) => void;
  setZIndex: (zIndex: number) => void;
  clear: () => void;
  size: () => number;
}

/**
 * Composes multiple layer handles for collective visibility, opacity, z-index, and disposal.
 */
export function createLayerGroup(
  initial: readonly LayerHandle[] = []
): LayerGroup {
  const layers = new Set<LayerHandle>(initial);

  const remove = (layer: LayerHandle): void => {
    if (!layers.delete(layer)) return;
    layer.remove();
  };

  const add = (layer: LayerHandle): (() => void) => {
    layers.add(layer);
    return () => remove(layer);
  };

  const setVisible = (visible: boolean): void => {
    for (const layer of layers) {
      layer.setVisible?.(visible);
    }
  };

  const setOpacity = (opacity: number): void => {
    for (const layer of layers) {
      layer.setOpacity?.(opacity);
    }
  };

  const setZIndex = (zIndex: number): void => {
    for (const layer of layers) {
      layer.setZIndex?.(zIndex);
    }
  };

  const clear = (): void => {
    for (const layer of Array.from(layers)) {
      layer.remove();
    }
    layers.clear();
  };

  const size = (): number => layers.size;

  return { add, remove, setVisible, setOpacity, setZIndex, clear, size };
}

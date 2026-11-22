import { Viewport, ViewportState } from './viewport';

/**
 * Pluggable layer renderer contract enabling 2D Canvas, SVG, or WebGL2/OffscreenCanvas backends.
 */
export interface MapLayerRenderer {
  onAttach(viewport: Viewport): void;
  render(state: ViewportState): void;
  onDetach(): void;
}

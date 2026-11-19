import { Camera, ViewportState } from './camera';

/**
 * Pluggable layer renderer contract enabling 2D Canvas, SVG, or WebGL2/OffscreenCanvas backends.
 */
export interface MapLayerRenderer {
  onAttach(camera: Camera): void;
  render(state: ViewportState): void;
  onDetach(): void;
}

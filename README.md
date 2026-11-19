# `map543-2d`

Lightweight viewport and map rendering engine. Geometry data uniformly uses 32-bit TypedArrays (`Float32Array` / `Int32Array`) and WebAssembly (`f32` / `i32`).

---

## 1. React Components & Hooks

### `<MapView>`

Root viewport container with built-in `ResizeObserver`, drag, pinch-to-zoom, wheel/double-click zoom, keyboard/gamepad navigation, and optional zoom controls.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `center` | `LatLng` (`[number, number]`) | `[0, 0]` | Initial center `[lat, lon]` |
| `zoom` | `number` | `3` | Initial zoom level |
| `minZoom` | `number` | `0` | Minimum zoom (clamped to fit `maxBounds` when set) |
| `maxZoom` | `number` | `10` | Maximum zoom level |
| `maxBounds` | `[LatLng, LatLng]` | `undefined` | Geographic viewport bounds |
| `interactive` | `boolean` | `true` | Enable drag, wheel, double-click, and click events |
| `keyboard` | `boolean` | `true` | Enable keyboard pan/zoom when focused |
| `gamepad` | `boolean` | `false` | Enable Gamepad API pan/zoom controls |
| `unlockFps` | `boolean` | `false` | Unlock `flyTo` frame-rate cap for 60/120Hz animations |
| `showZoomControls` | `boolean` | `false` | Show `+` / `−` zoom buttons |
| `zoomControlPosition` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'bottom-right'` | Zoom controls position |
| `zoomDelta` | `number` | `0.5` | Zoom step per wheel/button action (`zoomDelta * 2` on double-click) |
| `referenceWidth` | `number` | `undefined` | Reference width (CSS px) to scale initial `zoom` for consistent longitude span |
| `preserveViewportSpan` | `boolean` | `false` | Auto-adjust `zoom` on resize to keep geographic span consistent |
| `onMove` | `() => void` | `undefined` | Viewport change callback |
| `onMoveEnd` | `() => void` | `undefined` | Debounced callback after movement stops |
| `moveEndDelayMs` | `number` | `120` | `onMoveEnd` debounce delay (ms) |
| `syncViewOnPropsChange` | `boolean` | `false` | Sync viewport when external `center` / `zoom` props change |
| `projection` | `'mercator' \| 'equirectangular' \| Projection` | `'mercator'` | Map projection (Web Mercator, equirectangular, or custom `Projection`) |
| `className` | `string` | `''` | Container CSS class |
| `style` | `React.CSSProperties` | `undefined` | Container inline styles |

### `<CanvasLayer>`

Full-viewport, DPR-aware Canvas layer that batches redraws via `requestAnimationFrame` on `Camera` changes.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `zIndex` | `number` | `100` | Layer stack order |
| `maxDpr` | `number` | `2` | Maximum canvas DPR (use `1` for power-saving) |
| `interactionMaxDpr` | `number` | `undefined` | Lower DPR cap via offscreen buffer during interaction; restores full DPR when idle |
| `interactionIdleDelayMs` | `number` | `140` | Delay before restoring full-resolution render after interaction (ms) |
| `className` | `string` | `''` | Canvas CSS class |
| `onDraw` | `(ctx, state, camera, isInteracting) => void` | Required | Draw callback (`clearRect` and `dpr` transform pre-applied) |

### `<ImageLayer>`

Renders georeferenced PNG, WebP, SVG, or JPEG images into `<CanvasLayer>` within `bounds` (default `[[-90, -180], [90, 180]]`). Core also exports React-free `loadImage` and `drawImage`.

### `<VectorLayer>`

Renders prepared FlatGeobuf / Geobuf fill and stroke layers onto `<CanvasLayer>` with WASM-accelerated decimation and interaction LOD.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `fillLayers` | `StyledVectorLayer[]` | Required | Styled polygon fill layers |
| `strokeLayers` | `StyledVectorLayer[]` | Required | Styled line/outline layers |
| `smoothFactor` | `number` | `1.0` | Simplification factor |
| `lowPower` | `boolean` | `false` | Enable power-saving rendering mode |
| `zIndex` | `number` | `100` | Layer stack order |
| `skipOnInteractLayers` | `ReadonlySet<string>` | `undefined` | Layer names to skip during active pan/zoom |

### `<PointLayer>`

High-density Canvas point layer with WASM batch projection and nearest-point click/hover hit-testing.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `points` | `PointItem[]` | Required | Point items with coordinates and styling |
| `zIndex` | `number` | `300` | Layer stack order |
| `hitRadiusPx` | `number` | `18` | Click/hover hit-test radius (px) |
| `marginPx` | `number` | `30` | Off-screen culling margin (px) |
| `onPointClick` | `(point, index) => void` | `undefined` | Point click callback |

### `<TrajectoryLayer>`

Renders animated geographic trajectories as SVG curves synchronized with the viewport camera.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `items` | `TrajectoryItem[]` | Required | Trajectory definitions (`src`, `dst`, curve/style options) |
| `animationKey` | `number` | `undefined` | Key to re-trigger stroke animations |
| `strokeWidth` | `number` | `undefined` | Animated stroke width |
| `showBasePath` | `boolean` | `undefined` | Render static base arc underneath |
| `baseStrokeWidth` | `number` | `undefined` | Base path stroke width |
| `baseOpacity` | `number` | `undefined` | Base path opacity |
| `zIndex` | `number` | `undefined` | Layer stack order |
| `lowPower` | `boolean` | `undefined` | Disable continuous stroke animations |
| `smooth` | `boolean` | `undefined` | Unlock stepped easing for full-framerate stroke animations |

### `<Marker>`

Positioned DOM marker built on `<Overlay>` with configurable variants (`pin`, `dot`, etc.), pulse animations, and click handling.

### `<Overlay>`

Anchors a React element at `[lat, lon]` using integer-pixel `translate3d` and `ResizeObserver` size caching.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `lat` | `number` | Required | Target latitude |
| `lon` | `number` | Required | Target longitude |
| `zIndex` | `number` | `500` | Stack order |
| `anchor` | `[number, number]` | `[0.5, 0.5]` | Anchor ratio (`[0.5, 0.5]` center, `[0.5, 1]` bottom-center) |
| `interactive` | `boolean` | `false` | Enable click handling and intercept pointer down |
| `onClick` | `(e: React.MouseEvent<HTMLDivElement>) => void` | `undefined` | Click handler |
| `className` | `string` | `''` | Wrapper CSS class |

### `<Popup>`

Dark-themed floating popup with pointer tip. Automatically flips downward near the top edge of the viewport when space permits below.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `lat` | `number` | Required | Target latitude |
| `lon` | `number` | Required | Target longitude |
| `maxWidth` | `number` | `260` | Maximum width (px) |
| `zIndex` | `number` | `900` | Stack order |
| `onClose` | `() => void` | `undefined` | Close handler (hides `×` if omitted) |

### `useMap()`

Must be called inside `<MapView>`. Returns `{ camera, getContainer, subscribeClick }`:
- `camera: Camera` — Viewport camera instance.
- `getContainer: () => HTMLDivElement | null` — Root DOM container getter.
- `subscribeClick: (listener: (x: number, y: number, latLng: LatLng) => void) => () => void` — Subscribe to clicks under the `5px` drag threshold.

---

## 2. Core API (`map543-2d/core`, React-free, Web Worker compatible)

### `Camera`

```ts
const camera = new Camera({ center: [25, 121], zoom: 4, width: 1200, height: 800 });
```

- `getState(): ViewportState` — Current `{ center, zoom, width, height, minZoom, maxZoom, maxBounds }`.
- `subscribe(listener: (state: ViewportState) => void): () => void` — Subscribe to viewport updates.
- `setSize(width: number, height: number): void` — Update viewport dimensions and re-clamp.
- `setConstraints(constraints: CameraConstraints): void` — Update `minZoom`, `maxZoom`, `maxBounds`, and projection/animation options.
- `setView(center: LatLng, zoom: number): void` — Jump immediately to center and zoom (cancels active `flyTo`).
- `fitBounds(bounds: [LatLng, LatLng], paddingPx = 0, durationMs = 0): void` — Fit bounds with optimal center and continuous zoom.
- `getResponsiveZoom(baseZoom: number): number` — Compute responsive continuous zoom from `referenceWidth` and current width.
- `panBy(dx: number, dy: number): void` — Pan by screen pixel delta.
- `zoomAt(targetZoom: number, anchorX: number, anchorY: number): void` — Zoom around screen anchor `(anchorX, anchorY)`.
- `flyTo(targetCenter: LatLng, targetZoom: number, durationMs = 1500): void` — Cubic ease-out flight animation.
- `cancelAnimation(): void` — Cancel active `flyTo` animation.
- `project(lat: number, lon: number): Point2D` — Project `[lat, lon]` to container pixels `{ x, y }`.
- `projectInto(lat: number, lon: number, out: Point2D): Point2D` — Zero-allocation projection into `out` (preferred in hot paths).
- `unproject(px: number, py: number): LatLng` — Unproject container pixels to `[lat, lon]`.
- `getBounds(): LatLngBounds` — Current viewport geographic bounds `{ north, south, east, west }`.

### Projections & Bounds

- Projections: `MERCATOR_PROJECTION`, `createEquirectangularProjection()`, `resolveProjection(projection)`.
- Transforms: `projectToNormalized`, `projectToNormalizedInto`, `unprojectFromNormalized`, `latLngToWorld`, `worldToLatLng`, `projectLatLngToContainer`, `unprojectContainerToLatLng`.
- Bounds & wrapping: `getViewportBounds(state)`, `getWrappedViewportSlices(state, padDeg)`, `computeDynamicMinZoom`, `computeResponsiveZoom`, `computeZoomForBounds`, `clampCenterToBounds`.

### Vector Formats, Controllers & Hit Testing

- Format parsers: `parseFgbToPreparedLayers(...)` (FlatGeobuf v3 `.fgb`), `parseGeobufToPreparedLayers(buffer, defaultLayerName?)` (Mapbox Geobuf `.geobuf` / `.pbf`).
- Curves: `computeQuadraticArc(src, dst, isShort)` — 13-point quadratic Bézier arc with ±180° longitude normalization.
- Controllers: `attachViewportInteractions(el, camera, options)`, `attachGamepadControls(camera, options)`, `BlanketCanvasLayer`.
- Hit testing: `findNearestPoint(clickX, clickY, points, projectFn, radiusPx = 14)`, `findNearestPointFast(clickX, clickY, points, camera, radiusPx = 14)`.
- WASM preloading: `initWasm(): Promise<boolean>`, `isWasmReady(): boolean`.
- Custom renderers: `MapLayerRenderer` interface (`onAttach(camera)`, `render(state)`, `onDetach()`) for custom renderers (e.g., WebGL2 / `OffscreenCanvas`).

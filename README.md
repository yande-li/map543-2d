# `map543-2d`

English | [繁體中文](./README.zh-TW.md)

2D viewport and map rendering engine using 32-bit TypedArrays (`Float32Array` / `Int32Array`) and WebAssembly (`f32` / `i32`).

**Supported formats**: FlatGeobuf (`.fgb`), Mapbox Geobuf (`.geobuf`, `.pbf`), and browser-supported image formats (PNG, WebP, AVIF, SVG, JPEG, etc.)

---

## 1. React Components & Hooks

### `<MapView>`

Root viewport container with `ResizeObserver`, drag, pinch, wheel/double-click zoom, keyboard/gamepad navigation, and zoom controls.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `center` | `LatLng` (`[number, number]`) | `[0, 0]` | Initial center `[lat, lon]` |
| `zoom` | `number` | `3` | Initial zoom |
| `minZoom` | `number` | `0` | Min zoom (clamped to `maxBounds` when set) |
| `maxZoom` | `number` | `10` | Max zoom |
| `maxBounds` | `[LatLng, LatLng]` | `undefined` | Viewport bounds |
| `interactive` | `boolean` | `true` | Enable drag, wheel, double-click, and click events |
| `keyboard` | `boolean` | `true` | Keyboard pan/zoom when focused |
| `gamepad` | `boolean` | `false` | Gamepad API pan/zoom |
| `unlockFps` | `boolean` | `false` | Remove `flyTo` frame-rate cap |
| `showZoomControls` | `boolean` | `false` | Show `+` / `−` zoom buttons |
| `zoomControlPosition` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'bottom-right'` | Zoom control position |
| `zoomDelta` | `number` | `0.5` | Zoom step per action (`zoomDelta * 2` on double-click) |
| `referenceWidth` | `number` | `undefined` | Reference width (CSS px) for scaling initial `zoom` |
| `preserveViewportSpan` | `boolean` | `false` | Adjust `zoom` on resize to keep span |
| `onMove` | `() => void` | `undefined` | Viewport change callback |
| `onMoveEnd` | `() => void` | `undefined` | Debounced callback after movement stops |
| `moveEndDelayMs` | `number` | `120` | `onMoveEnd` debounce delay (ms) |
| `syncViewOnPropsChange` | `boolean` | `false` | Sync viewport when `center` / `zoom` props change |
| `projection` | `'mercator' \| 'equirectangular' \| Projection` | `'mercator'` | Map projection |
| `className` | `string` | `''` | Container CSS class |
| `style` | `React.CSSProperties` | `undefined` | Container inline styles |

### `<CanvasLayer>`

DPR-aware Canvas layer that batches redraws via `requestAnimationFrame` on `Camera` changes.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `zIndex` | `number` | `100` | Stack order |
| `maxDpr` | `number` | `2` | Max canvas DPR |
| `interactionMaxDpr` | `number` | `undefined` | DPR cap during interaction; restores full DPR when idle |
| `interactionIdleDelayMs` | `number` | `140` | Idle delay before restoring full DPR (ms) |
| `className` | `string` | `''` | Canvas CSS class |
| `onDraw` | `(ctx, state, camera, isInteracting) => void` | Required | Draw callback (`clearRect` and `dpr` transform pre-applied) |

### `<ImageLayer>`

Renders georeferenced images (browser-supported formats or `CanvasImageSource`) into `<CanvasLayer>` within `bounds` (default `[[-90, -180], [90, 180]]`). Core also exports `loadImage` and `drawImage`.

### `<VectorLayer>`

Renders FlatGeobuf / Geobuf fill and stroke layers onto `<CanvasLayer>` with WASM decimation and interaction LOD.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `fillLayers` | `StyledVectorLayer[]` | Required | Polygon fill layers |
| `strokeLayers` | `StyledVectorLayer[]` | Required | Line/outline layers |
| `smoothFactor` | `number` | `1.0` | Simplification factor |
| `lowPower` | `boolean` | `false` | Power-saving mode |
| `zIndex` | `number` | `100` | Stack order |
| `skipOnInteractLayers` | `ReadonlySet<string>` | `undefined` | Layer names to skip during pan/zoom |

### `<PointLayer>`

Canvas point layer with WASM batch projection and nearest-point click/hover hit-testing.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `points` | `PointItem[]` | Required | Point items with coordinates and styling |
| `zIndex` | `number` | `300` | Stack order |
| `hitRadiusPx` | `number` | `18` | Hit-test radius (px) |
| `marginPx` | `number` | `30` | Off-screen culling margin (px) |
| `onPointClick` | `(point, index) => void` | `undefined` | Point click callback |

### `<TrajectoryLayer>`

Renders animated geographic trajectories as SVG curves synchronized with the camera.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `items` | `TrajectoryItem[]` | Required | Trajectory definitions (`src`, `dst`, curve/style options) |
| `animationKey` | `number` | `undefined` | Key to re-trigger stroke animations |
| `strokeWidth` | `number` | `undefined` | Animated stroke width |
| `showBasePath` | `boolean` | `undefined` | Render static base arc underneath |
| `baseStrokeWidth` | `number` | `undefined` | Base path stroke width |
| `baseOpacity` | `number` | `undefined` | Base path opacity |
| `zIndex` | `number` | `undefined` | Stack order |
| `lowPower` | `boolean` | `undefined` | Disable stroke animations |
| `smooth` | `boolean` | `undefined` | Use unstepped stroke animations |

### `<Marker>`

DOM marker built on `<Overlay>` with variants (`pin`, `dot`, etc.), pulse animations, and click handling.

### `<Overlay>`

Anchors a React element at `[lat, lon]`.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `lat` | `number` | Required | Latitude |
| `lon` | `number` | Required | Longitude |
| `zIndex` | `number` | `500` | Stack order |
| `anchor` | `[number, number]` | `[0.5, 0.5]` | Anchor ratio (`[0.5, 0.5]` center, `[0.5, 1]` bottom-center) |
| `interactive` | `boolean` | `false` | Enable click handling and intercept pointer down |
| `onClick` | `(e: React.MouseEvent<HTMLDivElement>) => void` | `undefined` | Click handler |
| `className` | `string` | `''` | Wrapper CSS class |

### `<Popup>`

Floating popup with pointer tip; flips downward near the top edge.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `lat` | `number` | Required | Latitude |
| `lon` | `number` | Required | Longitude |
| `maxWidth` | `number` | `260` | Max width (px) |
| `zIndex` | `number` | `900` | Stack order |
| `onClose` | `() => void` | `undefined` | Close handler (hides `×` if omitted) |

### `useMap()`

Hook for `<MapView>`. Returns `{ camera, getContainer, subscribeClick }`:
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
- `setView(center: LatLng, zoom: number): void` — Jump to center and zoom (cancels active `flyTo`).
- `fitBounds(bounds: [LatLng, LatLng], paddingPx = 0, durationMs = 0): void` — Fit viewport to bounds.
- `getResponsiveZoom(baseZoom: number): number` — Compute continuous zoom from `referenceWidth` and current width.
- `panBy(dx: number, dy: number): void` — Pan by screen pixel delta.
- `zoomAt(targetZoom: number, anchorX: number, anchorY: number): void` — Zoom around screen anchor `(anchorX, anchorY)`.
- `flyTo(targetCenter: LatLng, targetZoom: number, durationMs = 1500): void` — Cubic ease-out flight animation.
- `cancelAnimation(): void` — Cancel active `flyTo` animation.
- `project(lat: number, lon: number): Point2D` — Project `[lat, lon]` to container pixels `{ x, y }`.
- `projectInto(lat: number, lon: number, out: Point2D): Point2D` — Zero-allocation projection into `out`.
- `unproject(px: number, py: number): LatLng` — Unproject container pixels to `[lat, lon]`.
- `getBounds(): LatLngBounds` — Current viewport geographic bounds `{ north, south, east, west }`.

### Projections & Bounds

- Projections: `MERCATOR_PROJECTION`, `createEquirectangularProjection()`, `resolveProjection(projection)`.
- Transforms: `projectToNormalized`, `projectToNormalizedInto`, `unprojectFromNormalized`, `latLngToWorld`, `worldToLatLng`, `projectLatLngToContainer`, `unprojectContainerToLatLng`.
- Bounds & wrapping: `getViewportBounds(state)`, `getWrappedViewportSlices(state, padDeg)`, `computeDynamicMinZoom`, `computeResponsiveZoom`, `computeZoomForBounds`, `clampCenterToBounds`.

### Vector Formats, Controllers & Hit Testing

- Format parsers: `parseFgbToPreparedLayers(...)` (FlatGeobuf v3 `.fgb`), `parseGeobufToPreparedLayers(buffer, defaultLayerName?)` (Mapbox Geobuf `.geobuf` / `.pbf`).
- Curves: `computeQuadraticArc(src, dst, isShort)` — Quadratic Bézier arc with ±180° longitude normalization.
- Controllers: `attachViewportInteractions(el, camera, options)`, `attachGamepadControls(camera, options)`, `BlanketCanvasLayer`.
- Hit testing: `findNearestPoint(clickX, clickY, points, projectFn, radiusPx = 14)`, `findNearestPointFast(clickX, clickY, points, camera, radiusPx = 14)`.
- WASM preloading: `initWasm(): Promise<boolean>`, `isWasmReady(): boolean`.
- Custom renderers: `MapLayerRenderer` interface (`onAttach(camera)`, `render(state)`, `onDetach()`).

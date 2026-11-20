# `map543-2d`

English | [繁體中文](./README.zh-TW.md)

2D map rendering library using reduced-precision techniques to reduce memory and resource usage.

**Supported formats**: Mapbox Geobuf (`.geobuf`, `.pbf`), and browser-supported image formats (PNG, WebP, AVIF, SVG, JPEG, etc.)

---

## 1. React Components & Hooks

### `<MapView>`

Root viewport container with `ResizeObserver`, drag, pinch, wheel/double-click zoom, keyboard/gamepad navigation, and zoom controls.

| Prop                    | Type                                                           | Default          | Description                                            |
| :---------------------- | :------------------------------------------------------------- | :--------------- | :----------------------------------------------------- |
| `center`                | `LatLng` (`[number, number]`)                                  | `[0, 0]`         | Initial center `[lat, lon]`                            |
| `zoom`                  | `number`                                                       | `3`              | Initial zoom                                           |
| `minZoom`               | `number`                                                       | `0`              | Min zoom (clamped to `maxBounds` when set)             |
| `maxZoom`               | `number`                                                       | `10`             | Max zoom                                               |
| `maxBounds`             | `[LatLng, LatLng]`                                             | `undefined`      | Viewport bounds                                        |
| `interactive`           | `boolean`                                                      | `true`           | Enable drag, wheel, double-click, and click events     |
| `keyboard`              | `boolean`                                                      | `true`           | Keyboard pan/zoom when focused                         |
| `gamepad`               | `boolean`                                                      | `false`          | Gamepad API pan/zoom                                   |
| `unlockFps`             | `boolean`                                                      | `false`          | Remove `flyTo` frame-rate cap                          |
| `showZoomControls`      | `boolean`                                                      | `false`          | Show `+` / `−` zoom buttons                            |
| `zoomControlPosition`   | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'bottom-right'` | Zoom control position                                  |
| `zoomDelta`             | `number`                                                       | `0.5`            | Zoom step per action (`zoomDelta * 2` on double-click) |
| `referenceWidth`        | `number`                                                       | `undefined`      | Reference width (CSS px) for scaling initial `zoom`    |
| `preserveViewportSpan`  | `boolean`                                                      | `false`          | Adjust `zoom` on resize to keep span                   |
| `onMove`                | `() => void`                                                   | `undefined`      | Viewport change callback                               |
| `onMoveEnd`             | `() => void`                                                   | `undefined`      | Debounced callback after movement stops                |
| `moveEndDelayMs`        | `number`                                                       | `120`            | `onMoveEnd` debounce delay (ms)                        |
| `syncViewOnPropsChange` | `boolean`                                                      | `false`          | Sync viewport when `center` / `zoom` props change      |
| `projection`            | `'mercator' \| 'equirectangular' \| Projection`                | `'mercator'`     | Map projection                                         |
| `className`             | `string`                                                       | `''`             | Container CSS class                                    |
| `style`                 | `React.CSSProperties`                                          | `undefined`      | Container inline styles                                |

### `<CanvasLayer>`

DPR-aware Canvas layer that batches redraws via `requestAnimationFrame` on `Camera` changes.

| Prop                     | Type                                          | Default     | Description                                                 |
| :----------------------- | :-------------------------------------------- | :---------- | :---------------------------------------------------------- |
| `zIndex`                 | `number`                                      | `100`       | Stack order                                                 |
| `maxDpr`                 | `number`                                      | `2`         | Max canvas DPR                                              |
| `interactionMaxDpr`      | `number`                                      | `undefined` | DPR cap during interaction; restores full DPR when idle     |
| `interactionIdleDelayMs` | `number`                                      | `140`       | Idle delay before restoring full DPR (ms)                   |
| `className`              | `string`                                      | `''`        | Canvas CSS class                                            |
| `onDraw`                 | `(ctx, state, camera, isInteracting) => void` | Required    | Draw callback (`clearRect` and `dpr` transform pre-applied) |

### `<ImageLayer>`

Renders georeferenced images (browser-supported formats or `CanvasImageSource`) into `<CanvasLayer>` within `bounds` (default `[[-90, -180], [90, 180]]`). Core also exports `loadImage` and `drawImage`.

### `<VectorLayer>`

Renders Geobuf fill and stroke layers onto `<CanvasLayer>` with WASM decimation and interaction LOD.

| Prop                   | Type                  | Default     | Description                         |
| :--------------------- | :-------------------- | :---------- | :---------------------------------- |
| `fillLayers`           | `StyledVectorLayer[]` | Required    | Polygon fill layers                 |
| `strokeLayers`         | `StyledVectorLayer[]` | Required    | Line/outline layers                 |
| `smoothFactor`         | `number`              | `1.0`       | Simplification factor               |
| `lowPower`             | `boolean`             | `false`     | Power-saving mode                   |
| `zIndex`               | `number`              | `100`       | Stack order                         |
| `skipOnInteractLayers` | `ReadonlySet<string>` | `undefined` | Layer names to skip during pan/zoom |
| `resetOnUpload`        | `boolean`             | `false`     | Reset WASM arena before upload      |
| `precision`            | `'f32' \| 'u16'`      | `'f32'`     | Arena coordinate precision          |

### `<PointLayer>`

Canvas point layer with WASM batch projection and nearest-point click/hover hit-testing.

| Prop           | Type                     | Default     | Description                              |
| :------------- | :----------------------- | :---------- | :--------------------------------------- |
| `points`       | `PointItem[]`            | Required    | Point items with coordinates and styling |
| `zIndex`       | `number`                 | `300`       | Stack order                              |
| `hitRadiusPx`  | `number`                 | `18`        | Hit-test radius (px)                     |
| `marginPx`     | `number`                 | `30`        | Off-screen culling margin (px)           |
| `precision`    | `'f32' \| 'i16'`         | `'f32'`     | Coordinate buffer precision              |
| `onPointClick` | `(point, index) => void` | `undefined` | Point click callback                     |

### `<TrajectoryLayer>`

Renders animated geographic trajectories as SVG curves synchronized with the camera.

| Prop              | Type               | Default     | Description                                                |
| :---------------- | :----------------- | :---------- | :--------------------------------------------------------- |
| `items`           | `TrajectoryItem[]` | Required    | Trajectory definitions (`src`, `dst`, curve/style options) |
| `animationKey`    | `number`           | `undefined` | Key to re-trigger stroke animations                        |
| `strokeWidth`     | `number`           | `undefined` | Animated stroke width                                      |
| `showBasePath`    | `boolean`          | `undefined` | Render static base arc underneath                          |
| `baseStrokeWidth` | `number`           | `undefined` | Base path stroke width                                     |
| `baseOpacity`     | `number`           | `undefined` | Base path opacity                                          |
| `zIndex`          | `number`           | `undefined` | Stack order                                                |
| `lowPower`        | `boolean`          | `undefined` | Disable stroke animations                                  |
| `smooth`          | `boolean`          | `undefined` | Use unstepped stroke animations                            |

### `<Marker>`

DOM marker built on `<Overlay>` with variants (`pin`, `dot`, etc.), pulse animations, and click handling.

### `<Overlay>`

Anchors a React element at `[lat, lon]`.

| Prop          | Type                                            | Default      | Description                                                  |
| :------------ | :---------------------------------------------- | :----------- | :----------------------------------------------------------- |
| `lat`         | `number`                                        | Required     | Latitude                                                     |
| `lon`         | `number`                                        | Required     | Longitude                                                    |
| `zIndex`      | `number`                                        | `500`        | Stack order                                                  |
| `anchor`      | `[number, number]`                              | `[0.5, 0.5]` | Anchor ratio (`[0.5, 0.5]` center, `[0.5, 1]` bottom-center) |
| `interactive` | `boolean`                                       | `false`      | Enable click handling and intercept pointer down             |
| `onClick`     | `(e: React.MouseEvent<HTMLDivElement>) => void` | `undefined`  | Click handler                                                |
| `className`   | `string`                                        | `''`         | Wrapper CSS class                                            |

### `<Popup>`

Floating popup with pointer tip; flips downward near the top edge.

| Prop       | Type         | Default     | Description                          |
| :--------- | :----------- | :---------- | :----------------------------------- |
| `lat`      | `number`     | Required    | Latitude                             |
| `lon`      | `number`     | Required    | Longitude                            |
| `maxWidth` | `number`     | `260`       | Max width (px)                       |
| `zIndex`   | `number`     | `900`       | Stack order                          |
| `onClose`  | `() => void` | `undefined` | Close handler (hides `×` if omitted) |

### `useMap()`

Hook for `<MapView>`. Returns `{ camera, getContainer, subscribeClick }` (`subscribeClick` fires for clicks under the `5px` drag threshold).

---

## 2. Core API (`map543-2d/core`, React-free, Web Worker compatible)

### `Camera`

```ts
const camera = new Camera({
  center: [25, 121],
  zoom: 4,
  width: 1200,
  height: 800,
});
```

- State & sizing: `getState`, `subscribe`, `setSize`, `setConstraints`, `getResponsiveZoom`.
- Navigation & animation: `setView`, `fitBounds`, `panBy`, `zoomAt`, `flyTo`, `cancelAnimation`.
- Projection & bounds: `project`, `projectInto`, `unproject`, `getBounds`.

### Projections & Bounds

- Projections: `MERCATOR_PROJECTION`, `createEquirectangular()`, `resolveProjection(projection)`.
- Transforms: `latLngToNorm`, `latLngToNormInto`, `normToLatLng`, `latLngToWorld`, `worldToLatLng`, `latLngToPx`, `pxToLatLng`.
- Bounds & wrapping: `getViewportBounds(state)`, `getWrappedSlices(state, padDeg)`, `getMinZoom`, `getResponsiveZoom`, `computeZoomForBounds`, `clampCenterToBounds`.

### Vector Formats, Controllers & Hit Testing

- Format parser: `parseGeobuf(buffer, defaultLayerName?)` (Mapbox Geobuf `.geobuf` / `.pbf`).
- Location dictionary decoder: `decodeLocationDictBatch(rawBytes, locCount, outLats, outLons, outMxs?, outMys?)`.
- 16-bit APIs (`u16` / `i16`): `encodeNormU16`, `uploadStaticRingsU16`, `drawStaticU16Direct`, `encodePointsToI16`, `batchProjectPointsI16`, `hitTestPointsI16`.
- Static Point Arena (zero-copy): `uploadStaticPoints`, `uploadStaticPointsI16`, `batchProjectStaticPoints`, `hitTestStaticPoints`.
- Curves: `computeArc(src, dst, isShort)` — Quadratic Bézier arc with ±180° longitude normalization.
- Controllers: `attachInteractions(el, camera, options)`, `attachGamepad(camera, options)`, `BlanketCanvasLayer`.
- Hit testing: `findNearestPoint(clickX, clickY, points, projectFn, radiusPx = 14)`, `hitTestPoints(clickX, clickY, points, camera, radiusPx = 14)`.
- WASM preloading: `initWasm(): Promise<boolean>`, `isWasmReady(): boolean`.
- Custom renderers: `MapLayerRenderer` interface (`onAttach(camera)`, `render(state)`, `onDetach()`).

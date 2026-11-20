# `map543-2d`

English | [繁體中文](./README.zh-TW.md)

2D map rendering library using reduced-precision techniques to reduce memory and resource usage.

**Supported formats**: Mapbox Geobuf (`.geobuf`, `.pbf`), and browser-supported image formats (PNG, WebP, AVIF, SVG, JPEG, etc.)

## Usage

```tsx
import { MapView, PointLayer, Marker } from 'map543-2d';

export function App({ points }) {
  return (
    <MapView center={[25, 121]} zoom={4} showZoomControls>
      <PointLayer points={points} precision="i16" />
      <Marker lat={25.033} lon={121.565} pulse="radar" />
    </MapView>
  );
}
```

## React Components & Hooks (`map543-2d`)

Full prop types and JSDoc are included in TypeScript declarations (`.d.ts`).

- `<MapView>` — Viewport container with drag, pinch, wheel/double-click zoom, keyboard/gamepad, and zoom controls.
- `<CanvasLayer>` — DPR-aware canvas synchronized via `requestAnimationFrame` (supports `interactionMaxDpr`).
- `<VectorLayer>` — WASM-accelerated Geobuf fill/stroke rendering with LOD and `precision` (`'f32' | 'u16'`).
- `<PointLayer>` — Batch-projected canvas points with nearest-point click/hover hit-testing and `precision` (`'f32' | 'i16'`).
- `<TrajectoryLayer>` — SVG animated trajectory arcs synced with `Camera`.
- `<ImageLayer>` — Georeferenced image overlay (`loadImage`, `drawImage`).
- `<Marker>`, `<Overlay>`, `<Popup>` — GPU-positioned DOM overlays (`translate3d`).
- `useMap()` — Returns `{ camera, getContainer, subscribeClick }`.

## Core API (`map543-2d/core`, React-free, Web Worker compatible)

- **Camera & Projections**: `Camera`, `MERCATOR_PROJECTION`, `createEquirectangular`, `latLngToNorm` / `normToLatLng`, `getViewportBounds`, `getWrappedSlices`.
- **Formats & Curves**: `parseGeobufAsync` (auto-initializes WASM), `parseGeobuf`, `computeArc`, `computeArcsBatch`, `prepareArcs`, `drawTrajectories`.
- **WASM & Reduced-Precision (`u16` / `i16`)**: `initWasm`, `isWasmReady`, `decodeLocationDictBatch`, `uploadStaticRings` / `uploadStaticRingsU16`, `uploadStaticPoints` / `uploadStaticPointsI16`, `batchProjectStaticPoints`, `hitTestStaticPoints`, `encodeNormU16`, `encodePointsToI16`.
- **Controllers & Custom Layers**: `attachInteractions`, `attachGamepad`, `BlanketCanvasLayer`, `MapLayerRenderer`.

## Scripts

```bash
npm run build   # Compile WASM, emit .d.ts, and bundle dist/
npm test        # Run unit tests
npm run bench   # Run performance & memory benchmarks
npm run size    # Verify dist/ bundle size budgets
```

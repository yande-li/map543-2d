# `map543-2d`

English | [繁體中文](./README.zh-TW.md)

2D map rendering library using reduced-precision techniques to reduce memory and resource usage.

- **Supported formats**: Mapbox Geobuf (`.geobuf`, `.pbf`), and browser-supported image formats (PNG, WebP, AVIF, SVG, JPEG, etc.)
- **Geographic Coordinate System (GCS)**: **WGS 84** (`EPSG:4326`, `[lat, lon]`)
- **Projected Coordinate Systems (PCS)**:
  - **Web Mercator** (`EPSG:3857`, default, `±85.051129°`)
  - **Equirectangular / Plate Carrée** (`projection="equirectangular"` or `createEquirectangular(bounds)`)
- **Minimum Requirements (ES2022 + WebAssembly 2.0)**

## Usage

```tsx
import { MapView, VectorLayer, PointLayer, Marker } from 'map543-2d';

export function App({ layers, points }) {
  return (
    <MapView
      center={[25, 121]}
      zoom={4}
      showZoomControls
      onClick={({ latLng }) => console.log(latLng)}
    >
      <VectorLayer
        fillLayers={layers.fillLayers}
        strokeLayers={layers.strokeLayers}
        precision={16}
      />
      <PointLayer points={points} precision={16} />
      <Marker position={[25.033, 121.565]} pulse="radar" />
    </MapView>
  );
}
```

## React Components & Hooks (`map543-2d`)

Full prop types and JSDoc are included in TypeScript declarations (`.d.ts`).

- `<MapView>` — Viewport container with drag, pinch, wheel/double-click zoom, keyboard/gamepad, `onClick` (`{ latLng, x, y }`), `smooth`, and zoom controls.
- `<CanvasLayer>` — DPR-aware canvas synchronized via `requestAnimationFrame` (supports `interactionMaxDpr`).
- `<VectorLayer>` — WASM-accelerated Geobuf fill/stroke rendering with LOD, `styles`, `className`, and `precision` (`32 | 16`).
- `<PointLayer>` — Batch-projected canvas points with nearest-point click/hover hit-testing, `className`, and `precision` (`32 | 16`).
- `<TrajectoryLayer>` — SVG animated trajectory arcs (`src`, `dst`) synced with `Camera`.
- `<ImageLayer>` — Georeferenced image overlay (`src` or pre-loaded `image`; core also exports `loadImage`, `drawImage`).
- `<Marker>`, `<Overlay>`, `<Popup>` — GPU-positioned DOM overlays (`translate3d`, supports `position={[lat, lon]}`).
- `useMap()` — Returns `{ camera, getContainer, subscribeClick }`.

## Core API (`map543-2d/core`, React-free, Web Worker compatible)

- **Camera & Projections**: `Camera` (`setView` / `flyTo` with optional `zoom`), `MERCATOR_PROJECTION`, `createEquirectangular`, `latLngToNorm` / `normToLatLng`, `getViewportBounds`, `getWrappedSlices`.
- **Formats & Curves**: `parseGeobuf`, `computeArc`, `computeArcsBatch`, `prepareArcs`, `drawTrajectories`.
- **WASM & Reduced-Precision (`32 | 16`)**: WASM auto-initializes synchronously on first use (`decodeLocationDictBatch`, `uploadStaticRings`, `drawRings`, `uploadStaticPoints`, `batchProjectPoints`, `hitTestPoints`, `encodeRings16`, `encodePoints16`, `resetWasmArena`, `disposeWasm`).
- **Controllers & Custom Layers**: `attachInteractions`, `attachGamepad`, `CanvasRenderer`, `MapLayerRenderer`.

## Scripts

```bash
npm run build   # Compile WASM, emit .d.ts, and bundle dist/
npm test        # Run unit tests
npm run bench   # Run performance & memory benchmarks
npm run size    # Verify dist/ bundle size budgets
```

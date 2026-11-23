# `map543-2d`

English | [繁體中文](./README.zh-TW.md)

A 2D map rendering library using lower-precision techniques to reduce memory footprint and resource overhead. It is designed to handle map rendering and related features for another toy project of mine.

- **Supported formats**: Mapbox Geobuf (`.geobuf`, `.pbf`), and browser-supported image formats (PNG, WebP, AVIF, SVG, JPEG, etc.)
- **Geographic Coordinate System (GCS)**: **WGS 84** (`EPSG:4326`)
- **Projected Coordinate Systems (PCS)**:
  - **Web Mercator** (`EPSG:3857`, default)
  - **Equirectangular / Plate Carrée**
- **Minimum Requirements (ES2022 + WebAssembly 2.0)**

## Usage

### React (`map543-2d`)

```tsx
import { MapView, VectorLayer, PointLayer, Marker } from 'map543-2d';

export function App({ points }) {
  return (
    <MapView
      center={[25, 121]}
      zoom={4}
      zoomControls
      onClick={({ latLon }) => console.log(latLon)}
    >
      <VectorLayer src="/world.geobuf" precision={16} />
      <PointLayer points={points} precision={16} />
      <Marker
        position={[25.033, 121.565]}
        pulse="radar"
        popup={<span>Taipei 101</span>}
      />
    </MapView>
  );
}
```

### Non-React / Vanilla JS (`map543-2d/core`)

```ts
import { createMap } from 'map543-2d/core';

const map = createMap('#map', {
  center: [25, 121],
  zoom: 4,
  zoomControls: true,
  onClick: ({ latLon }) => console.log(latLon),
});

map.addVectorLayer({ src: '/world.geobuf', precision: 16 });
map.addPointLayer({ points, precision: 16 });
const markerEl = document.createElement('div');
map.addOverlay(markerEl, [25.033, 121.565]);
```

## React Components & Hooks (`map543-2d`)

Full prop types and JSDoc are included in TypeScript declarations (`.d.ts`).

- `<MapView>` — Viewport container with `ref` (`MapViewHandle`: `flyTo`, `setView`, `fitBounds`), `bounds`, drag/pinch/wheel/double-click zoom, keyboard/gamepad, `onClick`, `onMove`/`onMoveEnd`, `smooth`, and `zoomControls`.
- `<CanvasLayer>` — DPR-aware canvas synchronized via `requestAnimationFrame` (supports `interactionMaxDpr`).
- `<VectorLayer>` — WASM-accelerated Geobuf fill/stroke rendering (`src`, `data`, or `fillLayers`), LOD, `styles`, `className`, and `precision` (`32 | 16`).
- `<PointLayer>` — Batch-projected canvas points with nearest-point `onPointClick`/`onPointHover` hit-testing, `className`, and `precision` (`32 | 16`).
- `<TrajectoryLayer>` — SVG animated trajectory arcs (`src`, `dst`) synced with `Viewport`.
- `<ImageLayer>` — Georeferenced image overlay (`src` or pre-loaded `image`; core also exports `loadImage`, `drawImage`).
- `<Marker>`, `<Overlay>`, `<Popup>` — GPU-positioned DOM overlays (`translate3d`, `position={[lat, lon]}`, and `Marker` `popup`).
- `useViewport()`, `useViewportSelector()`, `useMapClick()`, `useGeobuf()`, `useMap()` — Declarative React hooks without manual `useEffect` wiring.

## Core API (`map543-2d/core`, React-free, Web Worker compatible)

- **High-Level Facade**: `createMap` (unified viewport, interactions, zoom controls, `addVectorLayer`, `addPointLayer`, `addImageLayer`, `addTrajectoryLayer`, `addOverlay`, `destroy`).
- **Viewport & Projections**: `Viewport` (`setView` / `flyTo` with optional `zoom`, `fitBounds`), `MERCATOR_PROJECTION`, `createEquirectangular`, `latLonToNorm` / `normToLatLon`, `getViewportBounds`, `getWrappedSlices`.
- **Formats, Curves & Errors**: `loadGeobuf`, `parseGeobuf`, `computeArcsBatch`, `prepareArcs`, `drawTrajectories`, `MapError`.
- **WASM & Reduced-Precision (`32 | 16`)**: WASM auto-initializes synchronously on first use (`decodeLocDict`, `uploadStaticRings`, `drawRings`, `uploadStaticPoints`, `batchProjectPoints`, `hitTestPoints`, `encodeRings16`, `encodePoints16`, `resetWasmArena`, `disposeWasm`).
- **Controllers & Custom Layers**: `attachInteractions`, `attachGamepad`, `CanvasRenderer`, `MapLayerRenderer`.

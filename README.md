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

- `<MapView>` — Interactive map container with `ref` controls (`flyTo`, `setView`, `fitBounds`).
- `<CanvasLayer>`, `<VectorLayer>`, `<PointLayer>`, `<HeatmapLayer>`, `<ImageLayer>`, `<TrajectoryLayer>` — Map rendering layers.
- `<Marker>`, `<Overlay>`, `<Popup>`, `<MapControl>` — DOM overlays and corner UI controls.
- `useViewport`, `useViewportSelector`, `useViewportEffect`, `useViewportEvent`, `useMapClick`, `useGeobuf`, `useMap` — React hooks.

## Core API (`map543-2d/core`)

React-free and Web Worker compatible:

- `createMap` — Map instance factory (`addVectorLayer`, `addPointLayer`, `addHeatmapLayer`, `addImageLayer`, `addTrajectoryLayer`, `addOverlay`, `destroy`).
- `Viewport`, `MERCATOR_PROJECTION`, `createEquirectangular` — Viewport state and projections.
- `loadGeobuf`, `parseGeobuf`, `loadImage`, `drawImage` — Data and image loaders.
- `initWasm`, `resetWasmArena`, `disposeWasm` — WASM lifecycle (auto-initializes on first use).
- `attachInteractions`, `attachGamepad`, `CanvasRenderer`, `MapError` — Input controllers, custom canvas renderer, and error type.

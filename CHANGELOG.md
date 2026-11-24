# Changelog

## [0.4.0-rc.2] - 2026-11-24

### Features

- Add MapView cursor handling and cruise controller functionality

### Fixed

- Update size budgets for index.js and core.js in check-size script
- Include `cruise.ts` and `cruise-react.ts` in `tsconfig.build.json` for declaration output

## [0.4.0-rc.1] - 2026-11-23

### Features

- Add WASM-accelerated heatmap rendering and React wrapper
- Refactor Overlay and PointLayer components to use centralized z-index constants
- Add cleanSeamFeature function

### Changed

- Updated TrajectoryLayer to synchronize with viewport.
- Refactored VectorLayer to support loading Geobuf data with improved error handling.
- Introduced MapError class for error management.
- Added useGeobuf hook for declarative fetching and parsing of Geobuf files.
- Improve the click event handling of MapView and PointLayer, and refactor code

## [0.3.0] - 2026-11-21

### Features

- Consolidated `32 | 16` reduced-precision and static buffer APIs (`VectorLayer`, `PointLayer`, `core`).
- Synchronous WASM auto-initialization on first use.
- Added `MapView` `onClick`, `CanvasLayer` / `VectorLayer` `interactionMaxDpr`, and optional `zoom` in `Camera`.
- Added `ImageLayer` (`loadImage`, `drawImage`) and `CanvasRenderer`.

### Changed

- Simplified internal rendering and layer APIs (`CanvasRenderer`, `drawRings`, `styles`, `className`).

### Performance

- Reduced per-frame transfer and rendering cost via static WASM buffers and `interactionMaxDpr`.

## [0.2.0] - 2026-11-20

### Changed

- **Changed license to ISC**.
- **Removed FlatGeobuf (`.fgb`) support** and legacy `isGeckoEngine` helper.
- **Renamed internal modules and API names**: Simplified exported function and type names across the board (projections, formats, hit-testing, curves, and controllers).

### Features

- **Optional 16-bit (`u16` / `i16`) APIs** (50% coordinate buffer memory reduction for low-zoom / memory-constrained usage):
  - Vector rings: `encodeNormU16`, `uploadStaticRingsU16`, `drawStaticU16Direct`
  - Points: `encodePointsToI16`, `batchProjectPointsI16`, `hitTestPointsI16`

### Optimizations & Build

- Removed unused AssemblyScript stub runtime from `wasm/kernels.wasm`.
- Disabled `.js.map` / `.d.ts.map` and enabled `removeComments` in `tsconfig.build.json`.
- Simplified hot-path integer arithmetic in `drawBatchPoints`, `traceArc`, `encodeNormU16`, and `parseGeobuf`.
- Fixed WASM init retry/guard in `initWasm` and `TrajectoryLayer`, added `Escape` close support to `Popup`, and reduced per-frame allocations in `drawBatchPoints` and `drawImage`.

# Changelog

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

# `map543-2d`

[English](./README.md) | 繁體中文

使用降精度等方法的 2D 地圖繪圖函式庫，以減少記憶體與資源消耗。

**支援格式**：Mapbox Geobuf（`.geobuf`、`.pbf`）及瀏覽器支援的圖片格式（PNG、WebP、AVIF、SVG、JPEG 等）

## 使用範例

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

## React 元件與 Hooks（`map543-2d`）

完整 Props 型別與 JSDoc 皆附帶於 TypeScript `.d.ts` 宣告檔中。

- `<MapView>` — Root viewport container，支援 `ResizeObserver`、拖曳、手勢、滾輪／雙擊縮放、鍵盤／手把操作與縮放控制項。
- `<CanvasLayer>` — 支援 DPR 的 Canvas layer，於 `Camera` 變更時透過 `requestAnimationFrame` 批次重繪（支援 `interactionMaxDpr`）。
- `<VectorLayer>` — 將 Geobuf fill 與 stroke 圖層繪製至 `<CanvasLayer>`，支援 WASM decimation、互動 LOD 與 `precision`（`'f32' | 'u16'`）。
- `<PointLayer>` — Canvas point layer，支援 WASM batch projection、最近點點擊／hover hit-testing 與 `precision`（`'f32' | 'i16'`）。
- `<TrajectoryLayer>` — 繪製與 `Camera` 同步的 SVG 動態地理軌跡曲線。
- `<ImageLayer>` — 將具地理座標的圖片繪製至 `<CanvasLayer>`（核心亦匯出 `loadImage` 與 `drawImage`）。
- `<Marker>`、`<Overlay>`、`<Popup>` — 使用 GPU `translate3d` 定位的 DOM overlay、marker 與浮動 popup。
- `useMap()` — 取得 `{ camera, getContainer, subscribeClick }`。

## Core API（`map543-2d/core`，不依賴 React，支援 Web Worker）

- **Camera & Projections**：`Camera`、`MERCATOR_PROJECTION`、`createEquirectangular`、`latLngToNorm` / `normToLatLng`、`getViewportBounds`、`getWrappedSlices`。
- **Formats & Curves**：`parseGeobuf`、`computeArc`、`computeArcsBatch`、`prepareArcs`、`drawTrajectories`。
- **WASM & 降精度（`u16` / `i16`）**：首次呼叫時自動同步初始化 WASM（`decodeLocationDictBatch`、`uploadStaticRings` / `uploadStaticRingsU16`、`uploadStaticPoints` / `uploadStaticPointsI16`、`batchProjectStaticPoints`、`hitTestStaticPoints`、`encodeNormU16`、`encodePointsToI16`、`resetWasmArena`、`disposeWasm`）。
- **Controllers & Custom Renderers**：`attachInteractions`、`attachGamepad`、`BlanketCanvasLayer`、`MapLayerRenderer`。

## Scripts

```bash
npm run build   # 編譯 WASM、產生 .d.ts 並打包 dist/
npm test        # 執行單元測試
npm run bench   # 執行效能與記憶體 benchmark
npm run size    # 檢查 dist/ 體積預算
```

# `map543-2d`

[English](./README.md) | 繁體中文

使用降精度等方法的 2D 地圖繪圖函式庫，以減少記憶體佔用與資源消耗。設計用於處理我另一個玩具專案的地圖渲染及相關功能。

- **支援格式**：Mapbox Geobuf（`.geobuf`、`.pbf`）及瀏覽器支援的圖片格式（PNG、WebP、AVIF、SVG、JPEG 等）
- **地理座標系（GCS）**：**WGS 84**（`EPSG:4326`）
- **投影座標系（PCS）**：
  - **Web Mercator**（`EPSG:3857`，預設）
  - **Equirectangular / Plate Carrée**
- **最低環境要求（ES2022 + WebAssembly 2.0）**

## 使用範例

### React（`map543-2d`）

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

### 非 React / Vanilla JS（`map543-2d/core`）

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

## React 元件與 Hooks（`map543-2d`）

完整 Props 型別與 JSDoc 皆附帶於 TypeScript `.d.ts` 宣告檔中。

- `<MapView>` — Root viewport container，支援 `ref`（`MapViewHandle`：`flyTo`、`setView`、`fitBounds`）、`bounds`、`ResizeObserver`、拖曳／pinch／滾輪／雙擊縮放、鍵盤／手把、`onClick`、`onMove`／`onMoveEnd`、`smooth` 與 `zoomControls`。
- `<CanvasLayer>` — 支援 DPR 的 Canvas layer，於 `Viewport` 變更時透過 `requestAnimationFrame` 批次重繪（支援 `interactionMaxDpr`）。
- `<VectorLayer>` — 將 Geobuf fill 與 stroke 圖層繪製至 `<CanvasLayer>`（支援 `src`、`data` 或 `fillLayers`），具備 WASM decimation、互動 LOD、`styles`、`className` 與 `precision`（`32 | 16`）。
- `<PointLayer>` — Canvas point layer，支援 WASM batch projection、最近點 `onPointClick`／`onPointHover` hit-testing、`className` 與 `precision`（`32 | 16`）。
- `<TrajectoryLayer>` — 繪製與 `Viewport` 同步的 SVG 動態地理軌跡曲線（`src`、`dst`）。
- `<ImageLayer>` — 將具地理座標的圖片繪製至 `<CanvasLayer>`（支援 `src` 或預載 `image`；核心亦匯出 `loadImage` 與 `drawImage`）。
- `<Marker>`、`<Overlay>`、`<Popup>` — 使用 GPU `translate3d` 定位的 DOM overlay、marker（支援 `popup`）與浮動 popup（支援 `position={[lat, lon]}`）。
- `useViewport()`、`useViewportSelector()`、`useMapClick()`、`useGeobuf()`、`useMap()` — 免手寫 `useEffect` 的宣告式 React Hooks。

## Core API（`map543-2d/core`，不依賴 React，支援 Web Worker）

- **高階整合入口**：`createMap`（整合Viewport、互動、縮放控制項、`addVectorLayer`、`addPointLayer`、`addImageLayer`、`addTrajectoryLayer`、`addOverlay`、`destroy`）。
- **Viewport & Projections**：`Viewport`（`setView` / `flyTo` 支援省略 `zoom`，以及 `fitBounds`）、`MERCATOR_PROJECTION`、`createEquirectangular`、`latLonToNorm` / `normToLatLon`、`getViewportBounds`、`getWrappedSlices`。
- **Formats, Curves & Errors**：`loadGeobuf`、`parseGeobuf`、`computeArcsBatch`、`prepareArcs`、`drawTrajectories`、`MapError`。
- **WASM & 降精度（`32 | 16`）**：首次呼叫時自動同步初始化 WASM（`decodeLocDict`、`uploadStaticRings`、`drawRings`、`uploadStaticPoints`、`batchProjectPoints`、`hitTestPoints`、`encodeRings16`、`encodePoints16`、`resetWasmArena`、`disposeWasm`）。
- **Controllers & Custom Renderers**：`attachInteractions`、`attachGamepad`、`CanvasRenderer`、`MapLayerRenderer`。

## Scripts

```bash
npm run build   # 編譯 WASM、產生 .d.ts 並打包 dist/
npm test        # 執行單元測試
npm run bench   # 執行 benchmark
npm run size    # 檢查 dist/ 體積預算
```

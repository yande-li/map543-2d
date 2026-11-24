# `map543-2d`

[English](./README.md) | 繁體中文

使用降精度等方法的 2D 地圖繪圖函式庫，以減少記憶體佔用與資源消耗。設計用於處理我另一個玩具專案的地圖渲染及相關功能。

- **支援格式**：Mapbox Geobuf（`.geobuf`、`.pbf`）及瀏覽器支援的圖片格式（PNG、WebP、AVIF、SVG、JPEG 等）
- **地理座標系（GCS）**：**WGS 84**（`EPSG:4326`）
- **投影座標系（PCS）**：
  - **Web Mercator**（`EPSG:3857`，預設）
  - **Equirectangular / Plate Carrée**
- **ES2022 + WebAssembly 2.0**

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

- `<MapView>` — 互動式地圖容器，支援 `ref` 控制（`flyTo`、`setView`、`fitBounds`）與 `cursor` / `--map543-cursor`。
- `<CanvasLayer>`、`<VectorLayer>`、`<PointLayer>`、`<HeatmapLayer>`、`<ImageLayer>`、`<TrajectoryLayer>` — 各類地圖 layer。
- `<Marker>`、`<Overlay>`、`<Popup>`、`<MapControl>` — DOM overlay 與 UI 元件。
- `useViewport`、`useViewportSelector`、`useViewportEffect`、`useViewportEvent`、`useMapClick`、`useGeobuf`、`useMap` — React Hooks。

## Core API（`map543-2d/core`）

不依賴 React，支援 Web Worker：

- `createMap` — 建立 map instance（`addVectorLayer`、`addPointLayer`、`addHeatmapLayer`、`addImageLayer`、`addTrajectoryLayer`、`addOverlay`、`destroy`）。
- `Viewport`、`MERCATOR_PROJECTION`、`createEquirectangular` — viewport 狀態與投影。
- `loadGeobuf`、`parseGeobuf`、`loadImage`、`drawImage` — 資料與圖片載入工具。
- `packTrajectories`、`packTrajectoryArrays`、`drawBatchTrajectories` — 32/16-bit 批次 Canvas 軌跡繪製管線。
- `initWasm`、`resetWasmArena`、`disposeWasm` — WASM 生命週期管理。
- `attachInteractions`、`attachGamepad`、`CanvasRenderer`、`MapError` — 輸入控制、自訂 Canvas renderer 與錯誤型別。

## 選用 Subpaths

- `map543-2d/cruise` — `createCruiseController`（巡航控制，支援 `Viewport`、`MapInstance`、`fitBounds`、generic `CruiseWaypoint<T>` 與使用者輸入搶佔）。
- `map543-2d/cruise/react` — `useCruise` React Hook。

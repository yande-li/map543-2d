# `map543-2d`

[English](./README.md) | 繁體中文

使用降精度等方法的 2D 地圖繪圖函式庫，以減少記憶體與資源消耗。

**支援格式**：Mapbox Geobuf（`.geobuf`、`.pbf`）及瀏覽器支援的圖片格式（PNG、WebP、AVIF、SVG、JPEG 等）

---

## 1. React 元件與 Hooks

### `<MapView>`

Root viewport container，支援 `ResizeObserver`、拖曳、pinch、滾輪/雙擊縮放、鍵盤/手把 操作與縮放控制項。

| Prop                    | Type                                                           | Default          | Description                                    |
| :---------------------- | :------------------------------------------------------------- | :--------------- | :--------------------------------------------- |
| `center`                | `LatLng` (`[number, number]`)                                  | `[0, 0]`         | 初始中心點 `[lat, lon]`                        |
| `zoom`                  | `number`                                                       | `3`              | 初始 zoom                                      |
| `minZoom`               | `number`                                                       | `0`              | 最小 zoom（有設定 `maxBounds` 時會受其限制）   |
| `maxZoom`               | `number`                                                       | `10`             | 最大 zoom                                      |
| `maxBounds`             | `[LatLng, LatLng]`                                             | `undefined`      | Viewport 地理邊界                              |
| `interactive`           | `boolean`                                                      | `true`           | 啟用拖曳、滾輪、雙擊與點擊事件                 |
| `keyboard`              | `boolean`                                                      | `true`           | 聚焦時啟用鍵盤平移/縮放                        |
| `gamepad`               | `boolean`                                                      | `false`          | 啟用 Gamepad API 平移/縮放                     |
| `unlockFps`             | `boolean`                                                      | `false`          | 解除 `flyTo` frame-rate 上限                   |
| `showZoomControls`      | `boolean`                                                      | `false`          | 顯示 `+` / `−` 縮放按鈕                        |
| `zoomControlPosition`   | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'bottom-right'` | 縮放按鈕位置                                   |
| `zoomDelta`             | `number`                                                       | `0.5`            | 單次縮放步進（雙擊為 `zoomDelta * 2`）         |
| `referenceWidth`        | `number`                                                       | `undefined`      | 計算初始 `zoom` 比例的參考寬度（CSS px）       |
| `preserveViewportSpan`  | `boolean`                                                      | `false`          | Resize 時調整 `zoom` 以維持顯示跨度            |
| `onMove`                | `() => void`                                                   | `undefined`      | Viewport 變更 callback                         |
| `onMoveEnd`             | `() => void`                                                   | `undefined`      | 移動停止後的 debounce callback                 |
| `moveEndDelayMs`        | `number`                                                       | `120`            | `onMoveEnd` debounce 延遲（ms）                |
| `syncViewOnPropsChange` | `boolean`                                                      | `false`          | 當 `center` / `zoom` props 變更時同步 viewport |
| `projection`            | `'mercator' \| 'equirectangular' \| Projection`                | `'mercator'`     | 地圖投影                                       |
| `className`             | `string`                                                       | `''`             | Container CSS class                            |
| `style`                 | `React.CSSProperties`                                          | `undefined`      | Container inline styles                        |

### `<CanvasLayer>`

支援 DPR 的 Canvas layer，於 `Camera` 變更時透過 `requestAnimationFrame` 批次重繪。

| Prop                     | Type                                          | Default     | Description                                                |
| :----------------------- | :-------------------------------------------- | :---------- | :--------------------------------------------------------- |
| `zIndex`                 | `number`                                      | `100`       | 圖層堆疊順序                                               |
| `maxDpr`                 | `number`                                      | `2`         | Canvas 最大 DPR                                            |
| `interactionMaxDpr`      | `number`                                      | `undefined` | 互動期間的 DPR 上限；idle 後恢復完整 DPR                   |
| `interactionIdleDelayMs` | `number`                                      | `140`       | 互動結束後恢復完整 DPR 的延遲（ms）                        |
| `className`              | `string`                                      | `''`        | Canvas CSS class                                           |
| `onDraw`                 | `(ctx, state, camera, isInteracting) => void` | Required    | Draw callback（已預先套用 `clearRect` 與 `dpr` transform） |

### `<ImageLayer>`

將具地理座標的圖片（瀏覽器支援的格式或 `CanvasImageSource`）繪製至 `<CanvasLayer>` 的 `bounds` 範圍內（預設 `[[-90, -180], [90, 180]]`）。Core 亦匯出 `loadImage` 與 `drawImage`。

### `<VectorLayer>`

將 Geobuf fill 與 stroke 圖層繪製至 `<CanvasLayer>`，支援 WASM decimation 與互動 LOD。

| Prop                   | Type                  | Default     | Description                 |
| :--------------------- | :-------------------- | :---------- | :-------------------------- |
| `fillLayers`           | `StyledVectorLayer[]` | Required    | Polygon fill 圖層           |
| `strokeLayers`         | `StyledVectorLayer[]` | Required    | Line / outline 圖層         |
| `smoothFactor`         | `number`              | `1.0`       | 簡化係數                    |
| `lowPower`             | `boolean`             | `false`     | 省電模式                    |
| `zIndex`               | `number`              | `100`       | 圖層堆疊順序                |
| `skipOnInteractLayers` | `ReadonlySet<string>` | `undefined` | 平移/縮放期間略過的圖層名稱 |

### `<PointLayer>`

Canvas point layer，支援 WASM batch projection 與最近點點擊/hover hit-testing。

| Prop           | Type                     | Default     | Description                     |
| :------------- | :----------------------- | :---------- | :------------------------------ |
| `points`       | `PointItem[]`            | Required    | 含座標與樣式的點資料            |
| `zIndex`       | `number`                 | `300`       | 圖層堆疊順序                    |
| `hitRadiusPx`  | `number`                 | `18`        | Hit-test 半徑（px）             |
| `marginPx`     | `number`                 | `30`        | Off-screen culling margin（px） |
| `onPointClick` | `(point, index) => void` | `undefined` | 點擊 callback                   |

### `<TrajectoryLayer>`

繪製與 camera 同步的 SVG 動態地理軌跡曲線。

| Prop              | Type               | Default     | Description                              |
| :---------------- | :----------------- | :---------- | :--------------------------------------- |
| `items`           | `TrajectoryItem[]` | Required    | 軌跡定義（`src`、`dst`、曲線與樣式設定） |
| `animationKey`    | `number`           | `undefined` | 重新觸發 stroke 動畫的 key               |
| `strokeWidth`     | `number`           | `undefined` | 動畫 stroke 寬度                         |
| `showBasePath`    | `boolean`          | `undefined` | 顯示底層靜態弧線                         |
| `baseStrokeWidth` | `number`           | `undefined` | 底層弧線寬度                             |
| `baseOpacity`     | `number`           | `undefined` | 底層弧線透明度                           |
| `zIndex`          | `number`           | `undefined` | 圖層堆疊順序                             |
| `lowPower`        | `boolean`          | `undefined` | 停用 stroke 動畫                         |
| `smooth`          | `boolean`          | `undefined` | 使用 unstepped stroke 動畫               |

### `<Marker>`

基於 `<Overlay>` 的 DOM marker，支援 variant（`pin`、`dot` 等）、pulse 動畫與點擊事件。

### `<Overlay>`

將 React 元素錨定於 `[lat, lon]`。

| Prop          | Type                                            | Default      | Description                                           |
| :------------ | :---------------------------------------------- | :----------- | :---------------------------------------------------- |
| `lat`         | `number`                                        | Required     | 緯度                                                  |
| `lon`         | `number`                                        | Required     | 經度                                                  |
| `zIndex`      | `number`                                        | `500`        | 堆疊順序                                              |
| `anchor`      | `[number, number]`                              | `[0.5, 0.5]` | Anchor 比例（`[0.5, 0.5]` 置中，`[0.5, 1]` 底部置中） |
| `interactive` | `boolean`                                       | `false`      | 啟用點擊事件並攔截 pointer down                       |
| `onClick`     | `(e: React.MouseEvent<HTMLDivElement>) => void` | `undefined`  | Click handler                                         |
| `className`   | `string`                                        | `''`         | Wrapper CSS class                                     |

### `<Popup>`

帶指示箭頭的浮動 popup；靠近 viewport 頂端時會自動向下翻轉。

| Prop       | Type         | Default     | Description                       |
| :--------- | :----------- | :---------- | :-------------------------------- |
| `lat`      | `number`     | Required    | 緯度                              |
| `lon`      | `number`     | Required    | 經度                              |
| `maxWidth` | `number`     | `260`       | 最大寬度（px）                    |
| `zIndex`   | `number`     | `900`       | 堆疊順序                          |
| `onClose`  | `() => void` | `undefined` | Close handler（未提供時隱藏 `×`） |

### `useMap()`

用於 `<MapView>` 內部，回傳 `{ camera, getContainer, subscribeClick }`（`subscribeClick` 訂閱位移小於 `5px` 的點擊事件）。

---

## 2. Core API（`map543-2d/core`，不依賴 React，支援 Web Worker）

### `Camera`

```ts
const camera = new Camera({
  center: [25, 121],
  zoom: 4,
  width: 1200,
  height: 800,
});
```

- 狀態與尺寸：`getState`、`subscribe`、`setSize`、`setConstraints`、`getResponsiveZoom`。
- 導航與動畫：`setView`、`fitBounds`、`panBy`、`zoomAt`、`flyTo`、`cancelAnimation`。
- 投影與邊界：`project`、`projectInto`、`unproject`、`getBounds`。

### Projections & Bounds

- Projections：`MERCATOR_PROJECTION`、`createEquirectangular()`、`resolveProjection(projection)`。
- Transforms：`latLngToNorm`、`latLngToNormInto`、`normToLatLng`、`latLngToWorld`、`worldToLatLng`、`latLngToPx`、`pxToLatLng`。
- Bounds & wrapping：`getViewportBounds(state)`、`getWrappedSlices(state, padDeg)`、`getMinZoom`、`getResponsiveZoom`、`computeZoomForBounds`、`clampCenterToBounds`。

### Vector Formats, Controllers & Hit Testing

- Format parser：`parseGeobuf(buffer, defaultLayerName?)`（Mapbox Geobuf `.geobuf` / `.pbf`）。
- 16-bit API（`u16` / `i16`）：`encodeNormU16`、`uploadStaticRingsU16`、`drawStaticU16Direct`、`encodePointsToI16`、`batchProjectPointsI16`、`hitTestPointsI16`。
- Curves：`computeArc(src, dst, isShort)` — 含 ±180° 經度正規化的 quadratic Bézier 弧線。
- Controllers：`attachInteractions(el, camera, options)`、`attachGamepad(camera, options)`、`BlanketCanvasLayer`。
- Hit testing：`findNearestPoint(clickX, clickY, points, projectFn, radiusPx = 14)`、`hitTestPoints(clickX, clickY, points, camera, radiusPx = 14)`。
- WASM preload：`initWasm(): Promise<boolean>`、`isWasmReady(): boolean`。
- Custom renderers：`MapLayerRenderer` 介面（`onAttach(camera)`、`render(state)`、`onDetach()`）。

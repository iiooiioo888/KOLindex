# ADR-008 開始以 Next.js 為前端宿主

- 狀態：已接受
- 日期：2026-11-26
- 取代：ADR-005 的「凍結 `apps/web`、不接正式路由」

## 決定

1. `apps/web`（Next.js 16、App Router、`output: "standalone"`）成為正式前端宿主。
2. 現有 `index2.html` + `css/` + `js/` + `fonts/` 先整包同步到 `apps/web/public/console/`，在 `/console/` 繼續跑，行為對照不變。
3. Next 先提供殼層路由、元件健康 SSR（`/health`）、以及往後端的 rewrite；不一次重寫十二個分頁。
4. `tests/dev-server.mjs` 仍負責 `/__auth`、`/__sherlock`、`/__docker`、`/__oss` 等本機 BFF，直到對應能力搬進 Next Route Handler。
5. 分頁遷移規則：一頁一頁搬；搬完才刪該頁對 `index2`／`js/` 的依賴。未搬的分頁繼續走 `/console/#/...`。

## 為什麼

操作者要求改為 Next.js／更強架構。規格第 5 節本來就是 Next.js。ADR-005 的凍結條件已被這次明確指示取代。整站一次重寫風險高，所以宿主先換、畫面漸進遷。

## 代價

一段時間內會有兩層入口：`/console/`（原型）與 Next 殼層。Compose 預設映像若仍用 `infra/compose/Dockerfile`（dev-server），要另開 `apps/web` 的建置流程才能換成 Next 映像。BFF 未搬完之前，Sherlock／容器開關不能只靠 Next。

## 2026-11-27 入口

`/` 與 `/queue` 進入現有監控台的隊列分頁（`/console/index.html#/queue`）。`/collect` 進入 `#/collect`。Next 宿主不再把 `#/queue` 送回 `/queue`。隊列畫面仍是 `index2.html`，不另做一套 React 隊列。

## 何時重審

第一個分頁完成 App Router 遷移並刪掉對應舊檔時重審。若 BFF 全部進 Next Route Handler，可停用 `tests/dev-server.mjs` 當正式入口。

# 靈境 · LINKIN — KOL Index 執行時原型

[![pages](https://github.com/iiooiioo888/KOLindex/actions/workflows/pages.yml/badge.svg)](https://github.com/iiooiioo888/KOLindex/actions/workflows/pages.yml)

網紅索引與監控平台的介面原型，照《KOL-Index 項目計劃書／架構書／驗收規格 v2.2》做的「自動認領 × LLM 空檔排程」執行時畫面。純靜態：HTML + CSS + 原生 JS，沒有框架、沒有建置步驟、沒有 npm 依賴。

> 本原型對齊規格 **v2.2 的 UX 語意**；資料模型與治理模型以 **v4.0** 為準（治理層、31 張表、Sandbox／Egress 分離、F14／F15）。原型尚未實作治理層，落差列在 ROADMAP。

12 個分頁各自是一塊真實介面，其中七塊（任務收集、席位執行的 worker pool、人物檔案、審核台、基礎設施的連接器與排程工作、素材庫）加上右欄監控面板，接本機的 `kolindex-api`（SQLite）真實資料；其餘分頁仍是示範資料。

哪些頁面接真資料、哪些還是示範、規格書（v2.2）還缺哪些表與端點，都列在 **[ROADMAP.md](ROADMAP.md)**（2026-11-23）。

![素材庫與右欄監控面板](screenshots/screenshot-library.jpg)

## 分頁與資料來源

| # | 分頁 | 內容 | 資料 |
|---|---|---|---|
| 01 | 任務收集 | 待歸戶帳號的收件匣，可「認領／退回」寫回後端 | 真（`GET /api/collect`、`POST /api/collect/:id/claim\|return`） |
| 02 | 任務隊列 | 四條車道的排程動畫、任務卡 | 示範 |
| 03 | 感測上下文 | 平台熱度、關鍵詞、情緒分佈 | 示範 |
| 04 | 產出庫 | 已交付的內容與檢視器 | 示範 |
| 05 | 席位執行 | 8 個席位的 worker pool：搶工單、掃資料庫／磁碟、寫回結果與耗時 | 真（`GET /api/seats`、`POST /api/seats/run\|auto`） |
| 06 | 統一管線 | 採集 → 清洗 → 入庫的流程圖 | 示範 |
| 07 | 基礎設施 | Docker 總覽（示範）＋連接器憑證、排程工作兩個子頁籤 | 後兩個真 |
| 08 | 開源組件 | 第三方依賴清單 | 示範 |
| 09 | UI 生成 | 一句話畫線框圖，走 OpenAI 相容 API | 需要代理（見下） |
| 10 | 人物檔案 | 抖音作者索引，清單與檔案兩個檢視、作品時間軸、平台互動數 | 真（`/api/library/authors` 等） |
| 11 | 審核台 | F2 歸戶佇列，人工裁決寫回 `review_task` 並留 `audit_log` | 真（含兩支寫入） |
| 12 | 素材庫 | 本機抖音作品索引（圖集／影片）、作者檢視、下載缺檔、無損清理、衍生層 | 真（`/api/library`、`/api/mylike`、`/api/library/optimize`、`/api/library/derivative`） |

右欄監控面板（佇列深度、連接器槽位、Dispatcher、事件流、審計、儲存）也接真資料：`GET /api/rail`，15 秒輪詢。

![任務收集](screenshots/screenshot-collect.jpg)

## 快速開始

### 只有前端

```
node tests/dev-server.mjs . 5200
```

開 <http://127.0.0.1:5200/>。零依賴靜態伺服器，改檔案會自動重新整理；後端沒開時頁面照常運作，只是右上角顯示 `DEMO DATA`、資料退回示範值。

### 配後端

後端 `kolindex-api`（Node + `node:sqlite`，24 張表）在另一個 repo，跑起來後：

```
node server.mjs                       # API 127.0.0.1:5210
node ../KOLindex-dev/douyin/…         # 素材庫的圖片／影片靜態站 127.0.0.1:5400
```

前端會自己找同源的 `/api`（經 5200 代理）；素材庫的媒體則直接指向 `http://127.0.0.1:5400/media/...`，可以用 `window.KOLINDEX_MEDIA` 或 `KOLINDEX_BASE` 覆寫。

### UI 生成（可選）

`UI 生成` 分頁把一句話送給 OpenAI 相容端點，由本機代理轉發（金鑰只存在代理端的 `.env`，不進瀏覽器）。沒有金鑰時分頁仍可用，會畫一張示範線框。

## 檢查

```
node tests/test-wireframe.js   # 線框圖渲染器（純函式）：XSS、深度／寬度剪枝
node tests/test-page.mjs       # 站台輸出、資產 MIME、id 對齊、分頁註冊、CSS 載入順序
node tests/test-ds.mjs         # 設計系統四層、權杖、單一 accent、零轉場
node tests/test-balance.mjs    # HTML 標籤開閉配對（少一個 </section> 會整頁空白）
```

四支都只打 `127.0.0.1:5200`，不需要後端；`check` job 在每次 `push`／`PR` 跑這組。更完整的十九支（含寫入端點、離線、瀏覽器截圖）在私有開發資料夾 `KOLindex-dev`，不在這個 repo。

## 部署

`main` 通過檢查後，workflow 會把 `index2.html`、`css/`、`js/`、`fonts/` 發佈到 GitHub Pages。第一次需要在 **Settings → Pages → Source** 選 **GitHub Actions**（workflow 用 `GITHUB_TOKEN` 開 Pages 會因權限不足失敗，該步驟已設 `continue-on-error`）。

Pages 是純靜態，沒有 `/api`：接後端的分頁會顯示示範資料，UI 生成也沒有代理可用。要看真實資料請在本機跑。

## 目錄

```
index2.html            12 個分頁的版面（單檔）
css/index2.css         原版樣式
css/ds/                設計系統四層：tokens → base → components → pages
css/*.css              各分頁樣式（studio／person／review／connectors／jobs／library／seats）
js/index2.js           分頁切換、示範資料、圖表、對話框
js/api.js              後端橋接（收集、告警）
js/rail.js             右欄監控面板 → /api/rail
js/seats.js            席位編隊 → /api/seats（派工、自動派工、工人狀態）
js/*.js                各分頁邏輯（studio／person／review／infra／jobs／library／wireframe）
fonts/                 自架 woff2（Chakra Petch、IBM Plex Mono）
tests/                 四支靜態檢查 + 零依賴 dev-server
screenshots/           README 用的截圖
```

## 已知限制

- 仍是原型：任務隊列、感測上下文、產出庫、統一管線、開源組件是示範資料，動畫用 `requestAnimationFrame` 產生。席位執行的 8 席 worker pool 是真的，但下方的 80 席角色表仍是示範。
- 素材庫依賴本機已經抓下來的抖音媒體（數萬件作品、數十 GB），repo 裡沒有任何媒體檔；索引與媒體都只在本機。
- 只有六組寫入路徑（審核裁決、收集認領／退回、素材庫補檔、圖片無損清理、席位派工與工單結果、圖片衍生層），其餘分頁唯讀。「產生衍生層」只新增 `<原檔>.q50.webp` 並記血緣，**原檔與 sha256 不動**，所以不會釋放空間；要省空間得另外決定原檔的保留政策。
- 外部依賴只有 jsdelivr 的 tippy.js／popper.js 與 highlight.js，三者都帶 sha384 SRI；離線時失效但頁面仍可載入。

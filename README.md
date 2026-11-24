# 靈境 · LINKIN — KOL Index 執行時原型

[![pages](https://github.com/iiooiioo888/KOLindex/actions/workflows/pages.yml/badge.svg)](https://github.com/iiooiioo888/KOLindex/actions/workflows/pages.yml)

網紅索引與監控平台的介面原型。時間表、技術表、技術目標和格式要求在 [PROJECT.md](PROJECT.md)。畫面語意對齊較早的 v2.2；開發約束以 KOL-SPEC-001 v4.1 為準。現用畫面是 HTML + CSS + 原生 JS。`apps/web` 另有一套 Next.js 骨架，還沒取代這個畫面。

> 畫面語意對齊 v2.2。開發約束以 KOL-SPEC-001 v4.1 為準。治理層還沒做，落差列在 ROADMAP。時間表和技術表在 PROJECT.md。

12 個分頁各自是一塊真實介面，其中七塊（任務收集、席位執行的 worker pool、人物檔案、審核台、基礎設施的連接器與排程工作、素材庫）加上右欄監控面板，接本機的 `kolindex-api`（SQLite）真實資料；其餘分頁仍是示範資料。

哪些頁面接真資料、哪些還是示範、規格書（v2.2）還缺哪些表與端點，都列在 **[ROADMAP.md](ROADMAP.md)**（2026-11-24）。

![素材庫與右欄監控面板](screenshots/screenshot-library.jpg)

## 分頁與資料來源

| # | 分頁 | 內容 | 資料 |
|---|---|---|---|
| 01 | 任務收集 | 待歸戶帳號的收件匣，可「認領／退回」寫回後端 | 真（`GET /api/collect`、`POST /api/collect/:id/claim\|return`） |
| 02 | 任務隊列 | 五條車道的真實工作看板：排程、歸戶複核、MyLike 同步、席位工單、補檔；KPI 與派工／席位面板即時更新 | 真（`/api/jobs`、`/api/seats`、`/api/rail`、`/api/review/queue`） |
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

任務收集的「呼叫 Sherlock」用本機 `docker run` 啟動官方映像 `sherlock/sherlock` 0.16.0 的固定摘要，查完就退出。它只查你送出的那個公開用戶名。網頁容器沒有掛載 Docker socket。正式環境要另外設 `KOL_SHERLOCK=1` 才開放這個入口。

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
node tests/test-authz.mjs      # 角色能力：viewer 只讀、reviewer 裁決、operator 全寫（自己起三個實例）
node tests/test-caps.mjs       # 前端依 caps 收起按鈕：靜態與動態模板的 data-cap 標註
```

前四支只打 `127.0.0.1:5200`；`test-authz` 自己起 5390–5392 三個實例，`test-caps` 只讀檔，都不需要後端。`check` job 在每次 `push`／`PR` 跑這六支。更完整的二十支（含寫入端點、離線、瀏覽器截圖）在私有開發資料夾 `KOLindex-dev`，不在這個 repo。

## 部署

`main` 通過檢查後，workflow 會把 `index2.html`、`css/`、`js/`、`fonts/` 發佈到 GitHub Pages。第一次需要在 **Settings → Pages → Source** 選 **GitHub Actions**（workflow 用 `GITHUB_TOKEN` 開 Pages 會因權限不足失敗，該步驟已設 `continue-on-error`）。

Pages 是純靜態，沒有 `/api`：接後端的分頁會顯示示範資料，UI 生成也沒有代理可用。要看真實資料請在本機跑。

### 本機 NAS

這組服務要在家裡的 NAS 上跑，不靠 GitHub Pages。預設埠只聽 `127.0.0.1`，可用 `.env` 的 `*_BIND` 改。資料卷落在 NAS 的磁碟上。

```
copy infra\compose\.env.example infra\compose\.env
docker compose -f infra/compose/docker-compose.yml up -d --build
```

`.env` 只留在 NAS 上。Compose 的網頁服務用 `infra/compose/Dockerfile` 提供現用的 `index2.html`，映像標籤是 `kolindex-site:2026.11.24`。`apps/web` 的 Next.js 映像不在這組服務裡。第一版拉起網頁、PostgreSQL 16.16（pgvector 0.8.7）和 Meilisearch v1.57.0。PostgreSQL 是真相，Meilisearch 是衍生索引，重建用 `node scripts/rebuild-meilisearch.mjs`。Redis 與 MinIO 不在這個檔裡，定義留在 `docker-compose.later.yml`，預設不啟動。媒體放 `KOL_NAS_ROOT`。初始化 SQL 是 `infra/compose/postgres/init/001-schema.sql`，只在空資料目錄第一次啟動時執行。MongoDB 不在這組服務裡。

可在 `.env` 調整的項目：時區 `TZ`、業務 API 位址 `KOL_API`（留空則容器經 `host.docker.internal:5210` 找宿主機上的 API）、各服務的監聽位址（`WEB_BIND` 等，預設 `127.0.0.1`）、記憶體與 CPU 上限。上限是容器配額，不是這台機器的測量結果。日誌每個容器最多 3 個 10MB 檔。網頁容器把 `KOL_DOCKER`、`KOL_SHERLOCK`、`KOL_LLM` 固定為 `0`，也不掛 Docker socket。PostgreSQL 的資料目錄要讓容器內的 postgres 使用者可寫。慢查詢日誌由 `PG_LOG_MIN_DURATION_MS` 打開，預設 `0` 是為了開始記錄，不是已測量的門檻。兩週數據出來之前，不依這個日誌加索引。

控制面另開一個行程，不放進網頁容器：

```
set KOL_TOKEN_VIEWER=...
set KOL_TOKEN_REVIEWER=...
set KOL_TOKEN_OPERATOR=...
set KOL_DATABASE_URL=postgresql://kolindex:...@127.0.0.1:5432/kolindex
python apps/control/app.py
```

沒有 `KOL_DATABASE_URL` 時，它把 SQLite 放在 `KOL_NAS_ROOT/buffer/`，只當 intake buffer。`KOL_PROD=1` 時拒絕這樣啟動。寫入要帶 `Authorization: Bearer`。viewer 不能寫，reviewer 只能 `POST /decisions`，operator 可以打四個寫入端點。秘密檔用 `.sops.yaml` 的規則加密，明文範例在 `secrets/api-tokens.example.yaml`，不能拿來登入。age 公鑰還沒寫進 `.sops.yaml`，所以現在還沒有加密後的秘密檔。

上線前先核對下面五項。判定和現況寫在 [PROJECT.md](PROJECT.md) 第 7 節。

| # | 檢查 |
|---|---|
| 1 | PostgreSQL、Meilisearch、Sherlock 的映像要有這台 NAS 的 CPU 架構。家用 NAS 常是 ARM。Redis 與 MinIO 不在第一版 |
| 2 | 這個階段用 Docker。規格裡的 rootless Podman 延後，等確認 NAS 的容器工具支援之後再改 |
| 3 | 若用 DDNS、QuickConnect 或 Tailscale 從外面看，先核對業務 API 自己有沒有認證。`KOL_GATE` 只擋這個網頁行程 |
| 4 | 媒體目錄和知識庫只給跑這個站的帳號讀，不開放給 NAS 上的其他家庭帳號 |
| 5 | 磁碟陣列不是備份。異地備份和還原演練仍待做 |

容器監測和開關不在網頁容器裡做，也不掛 Docker socket。在 NAS 上另開這個站的行程，並設 `KOL_DOCKER=1`：

```
set KOL_DOCKER=1
node tests/dev-server.mjs . 5200
```

基礎設施頁會列出 web、postgres、redis、minio、meilisearch。只有伺服器角色是操作者時，才能啟動、重啟或停止這五個服務。

預設頁面聽 `127.0.0.1:5200`。網頁容器裡面聽 `0.0.0.0`，所以必須在 `.env` 設 `KOL_GATE`，否則行程拒絕啟動。角色用 `KOL_ROLE`（預設 `viewer`），名字用 `KOL_OPERATOR`；表單不能自選角色。前面再加你自己的反向代理。容器內 `KOL_PROD=1`：沒有自動重整、不列出目錄、預設不轉發 `/__llm`。沒有設定 `KOL_API` 時，收集與告警顯示未連線並清掉示範卡片，不把假資料留在畫面上。收集輪詢 60 秒，右欄 `rail.js` 是 15 秒。Sherlock 不在主 Compose 裡。收集頁要呼叫它，仍是在裝了 Docker 的機器上跑 `node tests/dev-server.mjs`，並設 `KOL_SHERLOCK=1`。

開源候選另外放在 `infra/compose/docker-compose.oss.yml`，專案名 `kolindex-oss`，profile 是 `oss`。`docker compose -f infra/compose/docker-compose.yml up -d` 不會啟動它們，基礎設施頁的開關也不包含它們。它們使用自己的 `oss` 網路，不加入主檔的 `data` 網路，也不掛 Docker socket。埠只綁 `127.0.0.1`。工作目錄在 `KOL_NAS_ROOT/oss/`，不掛媒體庫，也不讀 `.env` 裡的資料庫密碼。

| 服務 | 映像 | 這份檔實際包含的 |
|---|---|---|
| `sherlock` | `sherlock/sherlock` 0.16.0 的固定摘要 | 一次性查詢。收集頁仍走原本的 `docker run` |
| `maigret` | `soxoj/maigret` 標籤 `327c2bc` 的固定摘要 | CLI。不開它的 Web UI |
| `xhs-downloader` | `joeanamier/xhs-downloader` 2.8 的固定摘要 | 官方映像的預設命令。工作目錄是 `oss/xhs` |
| `douyin-tiktok-api` | `evil0ctal/douyin_tiktok_download_api` 5.1.13 的固定摘要 | 只有 API。不接本專案的 PostgreSQL、Redis、MinIO。不含上游的 browser、downloader、transcriber |

douyin-dl 沒有可釘住的 Docker Hub 映像，麦田沒有官方映像，兩份 Compose 都沒有它們。摘要是 2026-11-24 向 Docker Hub 讀到的 manifest list。這台開發機沒有 Docker，所以這些服務還沒有在這裡啟動過。

```
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.oss.yml --profile oss run --rm sherlock --help
```

打開站會先看到登入頁。沒有 `KOL_GATE` 時，填操作者就能進入，通行碼不核對。要擋住未登入的人和 `/api`，啟動時加上 `KOL_GATE`（只放在伺服器環境變數，不要寫進倉庫）。登入後右上角名字可點，用來登出。

角色只有三種，規則寫在 `tests/authz.mjs`；`KOL_GATE` 開啟時 dev-server 會擋不屬於該角色的寫入（`401` 未登入、`403` 角色不足）：

| 角色 | 讀取 | 審核裁決 `POST /api/review/:id/verdict`、`POST /api/ai/events/:id/ack` | 其他 `/api` 寫入 |
| --- | --- | --- | --- |
| `viewer` 只讀 | 可 | 不可 | 不可 |
| `reviewer` 審核 | 可 | 可 | 不可 |
| `operator` 操作者 | 可 | 可 | 可 |

同名主機一次只能掛一個 `KOL_ROLE`；要同時給三種人用，就開三個實例（各自 `KOL_ROLE`、共用同一個 API）再用反向代理分流。`tests/test-authz.mjs` 會起三個實例驗 401／403，CI 也會跑。

前端也照同一份 `caps` 收起沒有權限的按鈕，避免使用者點了才吃 `403`：`viewer` 看不到任何寫入控制，`reviewer` 只看得到審核台的四顆裁決鍵（確認／駁回／延後／標記已處理），`operator` 全開。實作是 `js/login.js` 的 `applyCaps()` 把 `caps` 寫成 `body[data-can-write|review|operate]`，`css/caps.css` 再用三條 `[data-cap]` 選擇器隱藏；沒有 `KOL_GATE` 的本機模式一律全開。`tests/test-caps.mjs` 會靜態檢查靜態與動態模板的標註有沒有漏，CI 也會跑。

## 目錄

```
index2.html            12 個分頁的版面（單檔）
css/index2.css         原版樣式
css/ds/                設計系統四層：tokens → base → components → pages
css/*.css              各分頁樣式（studio／person／review／connectors／jobs／library／seats／queue）
js/index2.js           分頁切換、示範資料、任務隊列的資料橋、圖表、對話框
js/api.js              後端橋接（收集、告警）
js/rail.js             右欄監控面板 → /api/rail
js/seats.js            席位編隊 → /api/seats（派工、自動派工、工人狀態）
js/*.js                各分頁邏輯（studio／person／review／infra／jobs／library／wireframe）
fonts/                 自架 woff2（Chakra Petch、IBM Plex Mono）
tests/                 六支檢查（含角色與 caps）+ 零依賴 dev-server
screenshots/           README 用的截圖
```

## 已知限制

- 仍是原型：感測上下文、產出庫、統一管線、開源組件是示範資料，動畫用 `requestAnimationFrame` 產生。任務隊列、席位執行的 8 席 worker pool 是真的，但席位頁下方的 80 席角色表仍是示範。
- 素材庫依賴本機已經抓下來的抖音媒體（數萬件作品、數十 GB），repo 裡沒有任何媒體檔；索引與媒體都只在本機。
- 只有八組寫入路徑（審核裁決、AI 事件 ack、收集認領／退回、席位派工與工單結果、MyLike 索引同步、素材庫補檔、圖片無損清理、圖片衍生層），其餘分頁唯讀。「產生衍生層」只新增 `<原檔>.q50.webp` 並記血緣，**原檔與 sha256 不動**，所以不會釋放空間；要省空間得另外決定原檔的保留政策。
- 外部依賴只有 jsdelivr 的 tippy.js／popper.js 與 highlight.js，三者都帶 sha384 SRI；離線時失效但頁面仍可載入。

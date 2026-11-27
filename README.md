# 靈境 · LINKIN — KOL Index 執行時原型

[![pages](https://github.com/iiooiioo888/KOLindex/actions/workflows/pages.yml/badge.svg)](https://github.com/iiooiioo888/KOLindex/actions/workflows/pages.yml)

網紅索引與監控平台的介面原型。時間表、技術表、技術目標和格式要求在 [PROJECT.md](PROJECT.md)。畫面語意對齊較早的 v2.2；開發約束以 KOL-SPEC-001 v4.1 為準。前端宿主依 ADR-008 改為 `apps/web`（Next.js）。監控台建置時同步到 `/console/`；`/` 與 `/queue` 進入隊列分頁。登入、Sherlock、Docker 仍由 `tests/dev-server.mjs` 當 BFF。

> 畫面語意對齊 v2.2。開發約束以 KOL-SPEC-001 v4.1 為準。治理層還沒做，落差列在 ROADMAP。時間表和技術表在 PROJECT.md。

**單一真相是 PostgreSQL**（ADR-006／ADR-009）。控制面在 `KOL_DATABASE_URL=postgres…` 時讀寫都走 PG；未設且非正式環境才用 SQLite buffer。外部 `kolindex-api` SQLite 只作遷移來源。

| 資料類 | 現在寫哪 | 畫面應讀哪 | 狀態 |
|---|---|---|---|
| intake、artifact、event、decision | PostgreSQL（或過渡 buffer） | `/__control` → 控制面 | 已接控制面；設 PG 即為真相 |
| subjects／帳號／indexed_posts／media_index | 控制面 → PG | `/__control/subjects*` | 已接；歷史用遷移腳本匯入 |
| 抖音作品、作者、素材庫（舊 API） | 曾寫 `kolindex-api` SQLite | 遷移後讀 PG；過渡期對帳 | `scripts/migrate_sqlite_to_postgres.py` |
| 審核／席位等未映射表 | 遷移進 `legacy_sqlite_rows` | 對帳後再接畫面 | 不發明未核對表 |

過渡期對帳：`python scripts/reconcile_sqlite_postgres.py --sqlite <path>`（比對筆數與 `content_hash`／`checksum`）。結果在 PG 的 `data_reconcile_*` 與 `GET /__control/truth/status`。

哪些頁面接真資料、哪些還是示範、規格書（v2.2）還缺哪些表與端點，都列在 **[ROADMAP.md](ROADMAP.md)**（2026-11-27）。

![素材庫與右欄監控面板](screenshots/screenshot-library.jpg)

## 分頁與資料來源

| # | 分頁 | 內容 | 資料 |
|---|---|---|---|
| 01 | 任務收集 | 待歸戶帳號的收件匣，可「認領／退回」寫回後端 | 真（`GET /api/collect`、`POST /api/collect/:id/claim\|return`） |
| 02 | 任務隊列 | 五條車道的工作看板，入口 `/console/#/queue`（`/` 與 `/queue` 轉到這裡）。卡片只讀，派工連到席位頁 | 真（`/api/jobs`、`/api/seats`、`/api/rail`、`/api/review/queue`） |
| 03 | 感測上下文 | 抖音近 30 日作品量、作者、互動、關鍵詞、情緒粗分 | 真（`GET /api/sense`） |
| 04 | 產出庫 | 已交付的內容與檢視器 | 空（控制面沒有 `GET /artifacts`） |
| 05 | 席位執行 | 8 個席位的 worker pool：搶工單、掃資料庫／磁碟、寫回結果與耗時 | 真（`GET /api/seats`、`POST /api/seats/run\|auto`） |
| 06 | 統一管線 | 採集 → 清洗 → 入庫的流程圖 | 示意（沒有耗時測量） |
| 07 | 基礎設施 | 探測服務、NAS 容器、席位池、儲存指標改為圖卡（`css/viz.css`）；表格式明細收在 `<details>` | 半（圖形＋表同源 `/__health/components`、`/__docker`、`/api/rail`、`/api/seats`） |
| 07b | 元件健康 | Docker／探測總覽圖板（`css/health.css`、`#healthBoard`） | 半（BFF 代問；`KOL_DOCKER=1` 才有真實 `compose ps`） |
| 08 | 開源組件 | 第三方依賴清單、清單／明細兩欄、OSS 跑 Sherlock／Maigret | 半（靜態目錄＋可呼叫容器） |
| 09 | UI 生成 | 一句話畫線框圖，走 OpenAI 相容 API | 需要代理（見下） |
| 10 | 人物檔案 | 抖音作者索引，清單與檔案兩個檢視、作品時間軸、平台互動數 | 真（`/api/library/authors` 等） |
| 11 | 審核台 | F2 歸戶佇列，人工裁決寫回 `review_task` 並留 `audit_log` | 真（含兩支寫入） |
| 12 | 素材庫 | 本機抖音作品索引（圖集／影片）、480px 縮圖牆、作者檢視、下載缺檔、無損清理、衍生層、MyLike 面板 | 真（`/api/library`、`/api/mylike`、`/api/library/optimize`、`/api/library/derivative`） |

**MyLike 深入分析（`js/mylike-intel.js`）**：依 `/api/mylike` 與素材庫摘要做**確定性規則**洞察（連線、缺口集中、同步失敗、磁碟等）。只產候選與建議，不寫庫、不自己開採集；勾選「自動派席」時最多建兩張席位 Agent 大任務候選。高優先洞察也會反映到任務看板（`board: mylike-intel`）。分析模型無工具。

右欄監控面板（佇列深度、連接器槽位、Dispatcher、事件流、審計、儲存）也接真資料：`GET /api/rail`，15 秒輪詢。

本機操作層：`⌘K`／`Ctrl+K` 開快速切換，可跳分頁、查作者與作品、執行七個本機動作；後端離線時不再清空畫面，左下顯示「後端離線 · 顯示 HH:MM 的資料 · 每 8 秒重試」，收集與告警會從 sessionStorage 快取（6 小時）先畫一次；狀態列顯示上次成功的 API 延遲。實作在 `js/cmdk.js`、`css/ux.css`、`js/api.js`。

![任務收集](screenshots/screenshot-collect.jpg)

## 快速開始

### 只有前端（舊入口，仍可用）

```
node tests/dev-server.mjs . 5200
```

開 <http://127.0.0.1:5200/>。零依賴靜態伺服器，改檔案會自動重新整理。後端沒開時，各分頁顯示空狀態或未連線，不再回退示範資料。

### Next.js 宿主（ADR-008）

另開 BFF（埠不要跟 Next 撞）：

```
set PORT=5201
node tests/dev-server.mjs . 5201
```

然後：

```
cd apps/web
npm run sync:console
npm run dev
```

開 <http://127.0.0.1:5200/> 進監控台任務隊列（`/console/index.html#/queue`）。元件健康在 <http://127.0.0.1:5200/ops/health>。可用 `KOL_API`、`KOL_CONTROL`、`KOL_BFF` 覆寫 rewrite 目標。

任務收集的「呼叫 Sherlock」只給操作者。開源組件頁的「拉起映像」會在設了 `KOL_DOCKER=1` 的宿主行程拉取官方映像 `sherlock/sherlock` 0.16.0 的固定摘要，並打開這個入口；查詢仍是 `docker run`，查完就退出。沒有按過拉起、也沒設 `KOL_SHERLOCK=1` 時，入口回 `{"error":"disabled"}`。Maigret 用同一個按鈕只拉取備援映像，不接到收集頁。兩者都是命令列映像，沒有網頁埠。網頁容器把 `KOL_DOCKER` 和 `KOL_SHERLOCK` 固定為 `0`，也不掛 Docker socket，所以容器裡的按鈕會被拒絕。GitHub Pages 沒有這個入口。

### 配後端

後端 `kolindex-api`（Node + `node:sqlite`，24 張表）在另一個 repo，跑起來後：

```
node server.mjs                       # API 127.0.0.1:5210
KOL_MEDIA_ROOT=../KOLindex-dev/douyin/media node tests/dev-server.mjs . 5200
```

前端會自己找同源的 `/api`（經 5200 代理）；素材庫的媒體也走同源 `/media/...`，由 `KOL_MEDIA_ROOT` 指向 `douyin/media`。想改由 5400 的相簿靜態站供檔，在頁面載入前設 `window.KOLINDEX_MEDIA='http://127.0.0.1:5400'`。

### UI 生成（可選）

`UI 生成` 分頁把一句話送給 OpenAI 相容端點，由本機代理轉發（金鑰只存在代理端的 `.env`，不進瀏覽器）。沒有金鑰時分頁仍可開，但只提示未設定，不生成線框。

## 檢查

```
node tests/test-wireframe.js   # 線框圖渲染器（純函式）：XSS、深度／寬度剪枝
node tests/test-page.mjs       # 站台輸出、資產 MIME、id 對齊、分頁註冊、CSS 載入順序
node tests/test-ds.mjs         # 設計系統四層、權杖、單一 accent、零轉場
node tests/test-balance.mjs    # HTML 標籤開閉配對（少一個 </section> 會整頁空白）
node tests/test-authz.mjs      # 角色能力：viewer 只讀、reviewer 裁決、operator 全寫（自己起三個實例）
node tests/test-caps.mjs       # 前端依 caps 收起按鈕：靜態與動態模板的 data-cap 標註
node tests/test-api-auth.mjs   # API 認證閘：無 Cookie 401、登入後可過
```

前四支只打 `127.0.0.1:5200`；`test-authz` 自己起 5390–5393 四個實例（最後一個是沒設通行碼的本機模式），`test-caps` 只讀檔，`test-api-auth` 自起上游與閘，都不需要後端。`check` job 在每次 `push`／`PR` 跑這七支。更完整的二十二支（含寫入端點、離線、瀏覽器截圖）在私有開發資料夾 `KOLindex-dev`，不在這個 repo。

版本標記：目前可引用的標籤是 `v0.1.1`（`v0.1.0` 也在遠端）。推送 `v*` tag 會觸發 `.github/workflows/release.yml` 建 prerelease；若 Actions 在「Set up job」就失敗，要到倉庫 Settings → Actions 核對是否啟用，或在 GitHub 上手動 New release 貼上 `CHANGELOG.md` 對應段落。說明見 `CHANGELOG.md`。

## 安全需求

這裡寫的是必須遵守的需求。右邊的「現況」只描述這個倉庫現在做得到的範圍。沒有寫成現況的項目，不能當成已經完成。

| 需求 | 現況 |
|---|---|
| 正式模式或監聽位址不是 loopback 時，必須設定通行碼，否則拒絕啟動 | 已做。`KOL_PROD=1` 或 `HOST` 不是 loopback 時，沒有 `KOL_GATE` 就直接退出。反向代理後面也不能靠「容器內仍是 127.0.0.1」省略通行碼 |
| 角色只有 `viewer`、`reviewer`、`operator`。角色由伺服器決定，不接受瀏覽器自選 | 已做。角色來自 `KOL_ROLE`。登入表單送上來的角色不採用。一台行程同時只有一種角色 |
| `viewer` 只讀。`reviewer` 只能做審核裁決和 AI 事件 ack。`operator` 才能做其餘寫入、容器開關、Sherlock、LLM 代理 | `KOL_GATE` 開啟時，網頁行程對 `/api` 寫入回 `401` 或 `403`。按鈕由 `js/login.js` 的 `caps` 隱藏，隱藏不是授權 |
| 工作階段放在 HttpOnly cookie，不放到前端可讀的儲存 | Cookie 名稱 `kol_session`，`HttpOnly`、`SameSite=Lax`。`KOL_COOKIE_SECURE=1` 或反向代理送來 `https` 時才加 `Secure`。工作階段只在行程記憶體，重啟即失效 |
| 登入失敗要限速 | 同一來源連續失敗 5 次後，60 秒回 `429` |
| 沒有 `KOL_GATE` 的本機模式不得拿去對網際網路 | 不核對通行碼。角色與按鈕都是 `viewer`，寫入回 `403`。要在本機寫入，另外設 `KOL_DEV_OPERATOR=1`。這只限 loopback；監聽位址不是 loopback 時沒有通行碼會拒絕啟動 |
| 業務 API 自己也要驗身份。只在網頁代理擋一次不夠 | **半**。本倉庫提供 `packages/api-auth/authGuard.js` 與 `apps/api-gate`。`kolindex-api` 原始碼不在這裡，要在那台機器掛上。`KOL_PROD=1` 時網頁行程強制要 `KOL_GATE` |
| 控制面寫入使用 Bearer token，三種角色分開 | `apps/control/app.py`：`viewer` 不能寫，`reviewer` 只能 `POST /decisions`，`operator` 可打 `POST /intake`、`/artifacts`、`/events`、`/decisions`。正式環境 `KOL_PROD=1` 時必須連 PostgreSQL，不能退回 SQLite |
| 通行碼、token、Cookie、金鑰不進 Git、日誌、前端、Connector 設定 | `.env` 與 `infra/compose/.env` 被 gitignore。`secrets/api-tokens.example.yaml` 只有佔位，不能用來登入。age 公鑰還沒寫進 `.sops.yaml`，加密秘密檔還沒有 |
| 網頁容器不持有 Docker 控制權 | 容器內 `KOL_DOCKER`、`KOL_SHERLOCK`、`KOL_LLM` 固定為 `0`。不掛載 Docker socket，不用 privileged、host network、host PID，映像不用 `latest` |
| 容器開關只允許名單內的服務，而且只有 `operator` | 名單是 `web`、`postgres`、`meilisearch`、`sherlock`、`maigret`、`xhs-downloader`、`douyin-tiktok-api`。Redis 與 MinIO 仍在 `docker-compose.later.yml`，不在這份名單 |
| 開源容器不進資料網路，開機不自己抓取 | 它們使用 `oss` 網路，不加入 `data`，不讀資料庫密碼。Sherlock 與 Maigret 的行程是 `sleep`，不查用戶名。XHS 與 Douyin API 失敗兩次就不再自動重啟。douyin-dl 與麦田沒有可啟動的映像 |
| 開源容器的埠綁在宿主的 loopback，並有資源上限 | `5556` 和 `8000` 發佈到宿主的 `127.0.0.1`，不是只留在容器內部。同一台機器上的行程，包含尚未自帶認證的 `kolindex-api`，都能連到這兩個埠。`oss` 網路不是 internal，容器可以對外連線；對外 DNS 與 HTTP 審計還沒做。記憶體、CPU、pids 上限寫在主檔 `docker-compose.yml` 的 OSS 服務（`docker-compose.oss.yml` 只清 profiles 做舊指令相容） |
| Sherlock 查詢要限制用戶名，並留下查詢紀錄 | 用戶名只接受 `^[A-Za-z0-9._-]{2,32}$`。容器 512MB、90 秒逾時、`--cap-drop ALL`。每次查詢追加到 `KOL_NAS_ROOT/audit/sherlock.jsonl`，沒設時用倉庫下的 `data/nas/audit/`。這個檔被 gitignore，不進倉庫 |
| 改基礎設施、秘密、schema 或登入的人或代理，要有批准紀錄 | **未完成**。聊天裡的同意不是批准令牌。這個倉庫還沒有 `approval_token` 和 `agent_action_log` |
| 採集程式不直連 PostgreSQL、SQLite、Redis、MinIO、Meilisearch | **未完成**。新控制面的四個寫入端點不寫 SQLite。舊的 `kolindex-api` 仍可寫它自己的 SQLite |
| 寫入只追加。重複的原始內容用雜湊去重 | 控制面的 intake、artifact、change_event、decision 有拒絕更新和刪除的觸發器。相同 `content_hash` 不重複建檔 |
| 寫入失敗時原檔留在收件匣，重試兩次就停 | 控制面把失敗檔留在 `KOL_NAS_ROOT/inbox/`。同一路徑失敗兩次後停止並記一筆 `stopped` 事件 |
| 模型只產候選，不觸發採集、刪除或發布 | 線框生成不寫業務庫。標註要人確認後才算 confirmed。候選不建立新的抓取 |
| 只處理已公開內容。檔案裡的位置欄預設不入庫 | `media_original` 拒絕 `file_place`。貼文時間可當事實，檔案拍攝時間只能是候選 |
| 不建人臉向量，不推斷親屬、伴侶、健康、宗教 | 標籤只允許文字、物件、標誌、場景、內容安全。`body` 不得帶 `face`、`kinship`、`partner`、`health`、`religion`。同框與關係分析還沒做，這條尚未在畫面上落地 |
| 關係只記提及、合集、引用、同台，而且要人確認 | schema 有這四個值。確認必須是 `human`。功能本身未做 |
| 401 或連不上時，不得把示範資料留在畫面上當成真資料 | 已移除 `js/fixtures/demo.js` 與所有 fallback；401／500 清畫面，連不上保留上次真資料並在左下標示「後端離線」與時間 |
| 全鏈刪除要清掉資料庫、搜尋索引、NAS 檔案、衍生檔和收件匣 | **未完成**。現在沒有這條流程 |
| 日誌不記通行碼、Cookie、token、私鑰或未去敏的全文 | 這是需求。這個 README 沒有逐條掃過現有日誌 |

登入操作：設了 `KOL_GATE` 才會核對通行碼，角色用 `KOL_ROLE`。沒設時，在本機任填操作者名稱就能進，通行碼可留空。`npm run dev:bff`（在 `apps/web`）預設走這條開發開閘，並帶 `KOL_DEV_OPERATOR=1`，角色是 `operator`。直接跑 `tests/dev-server.mjs` 且沒設 `KOL_DEV_OPERATOR` 時角色是 `viewer`，寫入按鈕收起，寫入請求回 `403`。要測閘門時不要用 `dev:bff`，改直接帶 `KOL_GATE` 啟動。登出打 `POST /__auth/logout`。檢查指令是 `node tests/test-authz.mjs` 和 `node tests/test-caps.mjs`。

## 部署

`main` 通過檢查後，workflow 會把 `index2.html`、`css/`、`js/`、`fonts/` 發佈到 GitHub Pages。第一次需要在 **Settings → Pages → Source** 選 **GitHub Actions**（workflow 用 `GITHUB_TOKEN` 開 Pages 會因權限不足失敗，該步驟已設 `continue-on-error`）。

Pages 是純靜態，沒有 `/api`：接後端的分頁顯示未連線或空狀態，UI 生成也沒有代理可用。要看真實資料請在本機跑。

### 本機 NAS

這組服務要在家裡的 NAS 上跑，不靠 GitHub Pages。預設埠只聽 `127.0.0.1`，可用 `.env` 的 `*_BIND` 改。資料卷落在 NAS 的磁碟上。

**部署自動化（ADR-010）**

```bash
# 1) 多架構阻斷核對（需要 Docker；CI 每週一也會跑）
node scripts/nas/verify-multiarch.mjs --main-only --write-inventory

# 2) 拉起 Compose（見下方）
cd infra/compose && docker compose -p kolindex up -d

# 3) 備份：本機 7 份；異地目錄用環境變數（只寫在 NAS）
export KOL_BACKUP_OFFSITE=/path/to/other-disk/kolindex-backups
node scripts/nas/backup.mjs
```

排程範例在 `scripts/nas/schedule.example.md`。未設 `KOL_BACKUP_OFFSITE` 時結果只算本機備份，不得寫成異地完成。

```
copy infra\compose\.env.example infra\compose\.env

# 建議：智慧啟動（多架構核對 → config → up）
node scripts/nas/compose-smart.mjs
node scripts/nas/compose-smart.mjs --profiles oss
node scripts/nas/compose-smart.mjs --profiles oss,backup

# 或手動 profiles（單一 docker-compose.yml）
cd infra/compose
docker compose -p kolindex up -d --build
docker compose -p kolindex --profile oss up -d
docker compose -p kolindex --profile oss --profile backup up -d

# 舊寫法仍可用（-f oss 會清掉 OSS 的 profile 閘門，行為同以前）
docker compose -f docker-compose.yml -f docker-compose.oss.yml up -d --build
```

`.env` 只留在 NAS 上。三份 Compose 已收斂：`docker-compose.yml` 是單一真相（core／oss／backup／later profiles）；`docker-compose.oss.yml`、`docker-compose.later.yml` 只做相容覆寫。網頁映像標籤仍是 `kolindex-site:2026.11.24`。第一版預設只拉 web、PostgreSQL 16.16（pgvector 0.8.7）、Meilisearch v1.57.0；加 `--profile oss` 才開開源容器。Redis 與 MinIO 在 profile `later`，智慧腳本預設拒絕開啟。媒體放 `KOL_NAS_ROOT`。初始化 SQL 在 `postgres/init/`，只在空資料目錄第一次啟動時執行。

可在 `.env` 調整的項目：時區 `TZ`、業務 API 位址 `KOL_API`（留空則容器經 `host.docker.internal:5210` 找宿主機上的 API）、各服務的監聽位址（`WEB_BIND` 等，預設 `127.0.0.1`）、記憶體與 CPU 上限。上限是容器配額，不是這台機器的測量結果。日誌每個容器最多 3 個 10MB 檔。網頁容器把 `KOL_DOCKER`、`KOL_SHERLOCK`、`KOL_LLM` 固定為 `0`，也不掛 Docker socket。PostgreSQL 的資料目錄要讓容器內的 postgres 使用者可寫。慢查詢日誌由 `PG_LOG_MIN_DURATION_MS` 打開，預設 `0` 是為了開始記錄，不是已測量的門檻。兩週數據出來之前，不依這個日誌加索引。

控制面另開一個行程，不放進網頁容器。`KOL_TOKEN_VIEWER`、`KOL_TOKEN_REVIEWER`、`KOL_TOKEN_OPERATOR` 和 `KOL_DATABASE_URL` 寫進已被 gitignore 的環境檔，不要用 `set` 留在命令歷史裡。age 公鑰還沒換掉 `.sops.yaml` 裡的佔位，所以還沒有加密後的秘密檔。

```
python apps/control/app.py
```

沒有 `KOL_DATABASE_URL` 時，它把 SQLite 放在 `KOL_NAS_ROOT/buffer/`，只當 intake buffer。`KOL_PROD=1` 時拒絕這樣啟動。寫入要帶 `Authorization: Bearer`。viewer 不能寫，reviewer 可 `POST /decisions` 與確認帳號連結，operator 可打 intake／artifacts／events／decisions，以及建立人物主檔、`POST /posts`、`POST /media-index`。人物頁經 `/__control/subjects` 代理到這裡，並可讀 `/subjects/{id}/media` 看作品與圖片索引；帳號發現經 `/__discovery` 代理到 `KOL_DISCOVERY`（預設 `127.0.0.1:5221`）。PostgreSQL 初始化還有 `003-kol-index.sql`。圖片原檔仍在 `KOL_NAS_ROOT`，庫裡只存 checksum 與路徑。覆蓋缺口沒有測量前顯示「—」。明文範例在 `secrets/api-tokens.example.yaml`，不能拿來登入。

上線前先核對下面五項。判定和現況寫在 [PROJECT.md](PROJECT.md) 第 7 節。

| # | 檢查 |
|---|---|
| 1 | PostgreSQL、Meilisearch、Sherlock 的映像要有這台 NAS 的 CPU 架構。家用 NAS 常是 ARM。Redis 與 MinIO 不在第一版 |
| 2 | 這個階段用 Docker。規格裡的 rootless Podman 延後，等確認 NAS 的容器工具支援之後再改 |
| 3 | 若用 DDNS、QuickConnect 或 Tailscale 從外面看，先核對業務 API 自己有沒有認證。`KOL_GATE` 只擋這個網頁行程 |
| 4 | 媒體目錄和知識庫只給跑這個站的帳號讀，不開放給 NAS 上的其他家庭帳號 |
| 5 | 磁碟陣列不是備份。每日／排程跑 `node scripts/nas/backup.mjs`（本機 7 份）；設 `KOL_BACKUP_OFFSITE` 才算異地。上線前跑 `node scripts/nas/verify-multiarch.mjs` 核對 amd64＋arm64。細節：ADR-010、`docs/runbooks/nas-deploy-and-backup.md`、`scripts/nas/schedule.example.md` |

容器監測和開關不在網頁容器裡做，也不掛 Docker socket。在 NAS 上另開這個站的行程，並設 `KOL_DOCKER=1`：

```
set KOL_DOCKER=1
node tests/dev-server.mjs . 5200
```

容器開關的允許名單是 web、postgres、meilisearch、sherlock、maigret、xhs-downloader、douyin-tiktok-api，而且只有操作者能動。Redis 和 MinIO 不在第一版，也不在這份名單。

預設頁面聽 `127.0.0.1:5200`。網頁容器裡面聽 `0.0.0.0`，所以必須在 `.env` 設 `KOL_GATE`，否則行程拒絕啟動。角色用 `KOL_ROLE`（預設 `viewer`），名字用 `KOL_OPERATOR`；表單不能自選角色。前面再加你自己的反向代理。容器內 `KOL_PROD=1`：沒有自動重整、不列出目錄、預設不轉發 `/__llm`。沒有設定 `KOL_API` 時，收集與告警顯示未連線；已載入過就保留上次結果並標示時間，不把假資料留在畫面上。收集輪詢 60 秒，右欄 `rail.js` 是 15 秒。收集頁的 Sherlock 查詢仍要這個宿主行程，並在開源組件頁拉起映像或設 `KOL_SHERLOCK=1`。閒置中的 Sherlock 容器不會自己查用戶名。

開源組件用 profile `oss`（Maigret 另用 `backup`），專案名仍是 `kolindex`。它們使用 `oss` 網路，不加入 `data`，也不掛 Docker socket。埠只綁 `127.0.0.1`。工作目錄在 `KOL_NAS_ROOT/oss/`，不掛媒體庫，也不讀 `.env` 裡的資料庫密碼。Sherlock 和 Maigret 的行程是 `sleep infinity`，等系統以後下指令。XHS-Downloader 與 Douyin API 用官方預設行程聽著，開機不送出抓取；行程自己失敗兩次後不再自動重啟。

| 服務 | profile | 映像 | 起來之後做什麼 |
|---|---|---|---|
| `web`／`postgres`／`meilisearch` | （預設 core） | 見主 compose | 第一版常駐 |
| `sherlock` | `oss` | `sherlock/sherlock` 0.16.0 的固定摘要 | 閒置。收集頁查詢仍另開一次性容器 |
| `xhs-downloader` | `oss` | `joeanamier/xhs-downloader` 2.8 的固定摘要 | 官方預設行程，只聽 `127.0.0.1:5556`。不在開機時抓取 |
| `douyin-tiktok-api` | `oss` | `evil0ctal/douyin_tiktok_download_api` 5.1.13 的固定摘要 | 只有 API，只聽 `127.0.0.1:8000`。不含 browser、downloader、transcriber，不接 PostgreSQL |
| `maigret` | `backup` | `soxoj/maigret` 標籤 `327c2bc` 的固定摘要 | 閒置備援。不開 Web UI，收集頁不呼叫它 |
| `redis`／MinIO 候選 | `later` | 見主 compose | 第一版勿開；`compose-smart` 預設拒絕，需 `--allow-later` |

douyin-dl 沒有可釘住的 Docker Hub 映像，麦田沒有官方映像，主 compose 沒有它們。摘要是 2026-11-24 向 Docker Hub 讀到的 manifest list。是否已在目標 NAS 實際拉起，以該機 `compose ps`／多架構腳本輸出為準，不得手填。

**Compose 檔案角色**

| 檔案 | 角色 |
|---|---|
| `infra/compose/docker-compose.yml` | 單一真相：core／oss／backup／later |
| `infra/compose/docker-compose.oss.yml` | 相容覆寫：`-f` 疊加時清掉 OSS／backup 的 profile 閘門（行為同舊「全開」） |
| `infra/compose/docker-compose.later.yml` | 相容覆寫：後期服務定義已併入主檔 |
| `scripts/nas/compose-smart.mjs` | 受控智慧啟動：解析 profiles → 多架構核對 → `config` → `up` → `ps`（非自治 Agent） |

```
docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml --profile oss --profile backup up -d
# 等同舊寫法：
# docker compose --env-file infra/compose/.env -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.oss.yml up -d
```

角色規則、cookie 和尚未完成的項目見上面的「安全需求」。一台行程同時只有一種 `KOL_ROLE`。要同時給三種人用，就開三個實例，再用反向代理分流。

## 目錄

```
index2.html            監控台版面（單檔）
css/index2.css         原版樣式
css/ds/                設計系統：tokens → base → components → pages → unify／pixel
css/health.css         元件健康圖板
css/viz.css            基礎設施圖卡網格
css/*.css              各分頁樣式（studio／person／review／library／seats／queue／…）
js/index2.js           分頁切換、任務隊列資料橋、圖表、對話框
js/api.js              後端橋接（收集、告警）
js/rail.js             右欄監控面板 → /api/rail
js/seats.js            席位 Agent 編隊（大任務 → 經理拆分 → 席位）
js/mylike-intel.js     MyLike 規則洞察（候選／可選自動派席）
js/system.js           基礎設施／健康／Docker 控制繪製
js/*.js                各分頁邏輯（person／review／library／jobs／…）
scripts/nas/           NAS 部署：compose-smart、backup、verify-multiarch
infra/compose/         單一真相 compose＋oss／later 相容覆寫
fonts/                 自架 woff2（Chakra Petch、IBM Plex Mono）
tests/                 檢查腳本 + 零依賴 dev-server
screenshots/           README 用的截圖
```

## 已知限制

- 產出庫沒有後端列表（控制面缺 `GET /artifacts`），開起來是空狀態；統一管線只畫流程、不冒充耗時。任務隊列與席位編隊接真／本機編排資料。
- MyLike 深入分析是規則引擎，不是 LLM；「自動派席」只建立席位大任務候選，不會繞過 Policy／L3，也不直連 Vault／資料庫寫入。
- Compose 智慧啟動是受控腳本（核對 → config → up），不是自治基礎設施 Agent；`later`（Redis／MinIO）預設阻斷。
- 素材庫依賴本機已經抓下來的抖音媒體（數萬件作品、數十 GB），repo 裡沒有任何媒體檔；索引與媒體都只在本機。
- 只有八組寫入路徑（審核裁決、AI 事件 ack、收集認領／退回、席位派工與工單結果、MyLike 索引同步、素材庫補檔、圖片無損清理、圖片衍生層），其餘分頁唯讀。「產生衍生層」只新增 `<原檔>.q50.webp` 並記血緣，**原檔與 sha256 不動**，所以不會釋放空間；要省空間得另外決定原檔的保留政策。
- 外部依賴只有 jsdelivr 的 tippy.js／popper.js 與 highlight.js，三者都帶 sha384 SRI；離線時失效但頁面仍可載入。

# KOL-Index 項目文件

更新日期：2026-11-24。這份文件整理時間表、技術表、技術目標、格式要求和阻斷項。怎麼把站跑起來見 [README.md](README.md)。哪一頁是真資料、哪一頁還是示範，見 [ROADMAP.md](ROADMAP.md)。

規格基線是 KOL-SPEC-001 v4.1。README 裡的畫面語意對齊較早的 v2.2。兩份都還沒有逐條核對完成，不能把規格條文寫成這個倉庫已經做完。

## 1. 技術目標

產品是放在本機 NAS 上的人物索引與監控台。指定公開人物之後，把已公開的動態、圖片、影片收成一份可搜尋的檔案，並持續看有沒有新的公開變化。圈子和同標關係只是其中一個功能。

工作範圍是公開內容和已經入庫的媒體。模型只產出候選，人在審核台確認之後才寫進人物或關係。

| # | 功能 | 做什麼 | 現況 |
|---|---|---|---|
| 1 | 人物主檔 | 一個人一套檔案，下面掛已確認的各平台公開帳號 | **半** · 人物頁仍是抖音作者清單 |
| 2 | 帳號發現 | 從公開用戶名找出可能屬於同一人的其他公開頁，列成待確認 | **半** · 會呼叫的是 Sherlock。Maigret 降為 `backup` profile，不同時維護 |
| 3 | 公開時間軸 | 貼文、圖片、影片按時間排在同一條軸上，原始檔與整理結果分開 | **半** · 素材庫與人物頁有抖音作品。跨平台時間軸未做 |
| 4 | 圖片與影片分析 | 對 NAS 上已有的檔做文字、物件、標誌、場景和關鍵幀。時間和地點的寫法見下方紀錄表。同框紀錄要能回到那一張圖 | **假** · 分析未做。衍生層只另存縮圖，原檔不動 |
| 5 | 覆蓋與缺口 | 對照公開頁聲稱的作品量和已入庫數量，看出哪一段時間還空 | **假** · 未做。沒有這張對照表之前，不把「已挖全」寫成事實 |
| 6 | 變化監控 | 已建檔的人物出現新的公開動態或關係候選時，進事件列表等人看 | **半** · 審核台和告警表在。自動產生器未做 |
| 7 | 社交群組 | 把反覆一起出現的已確認公開帳號收成一個群組。成員是帳號。依據是公開標籤、提及、合集、引用和已確認的同框 | **假** · 排在覆蓋缺口和變化監控之後 |
| 8 | 任務看板 | 發現、入庫、重解析、分類都進同一塊看板，帶狀態、逾時和停止 | **半** · 看板已聚合排程、複核和席位。模型監督標籤尚未分成「已接線」和「已看過」 |
| 9 | 本機運行 | NAS 上的資料庫、搜尋、媒體目錄、磁碟用量和容器狀態能在頁上看到 | **半** · 元件健康是 `GET /__health/components`，回應帶 `duration_ms`。磁碟用量來自 `/api/rail`，沒回應就顯示「—」 |
| 10 | 審核與刪除 | 歸戶、同框和關係由人裁決。保存期限到期或收到刪除要求時，能沿整條鏈清掉 | **半** · 審核裁決已有。全鏈刪除未做 |
| 11 | 個人知識庫 | 每個人一份知識庫。已確認的事實和尚未確認的候選分開存放，每筆都寫明證據和出處 | **半** · 初始化 SQL 已寫在 `infra/compose/postgres/init`。資料庫還沒跑過這份 SQL，也沒有程式寫入 |
| 12 | 開源整合 | 用 GitHub 上的開源項目補採集、發現、畫面和評估。每個項目先登記倉庫、授權和版本，再決定能不能跑 | **半** · Sherlock 會被呼叫。XHS-Downloader 與 Douyin_TikTok_Download_API 在 profile `oss`。Maigret 只在 profile `backup` |

開源整合用來補本項目還沒有的能力。新項目先寫進「開源組件」頁：官方倉庫、授權、固定版本。沒有官方映像或 Dockerfile 的，只保留說明。會跑的程式不使用 `latest`。

| 狀態 | 項目 | 倉庫 | 補的能力 |
|---|---|---|---|
| 會呼叫 | Sherlock 0.16.0 | `sherlock-project/sherlock` | 公開用戶名在其站點清單上的頁面。要 `KOL_SHERLOCK=1`，由本機 Docker 跑完即退出。同一摘要也在 `docker-compose.oss.yml` |
| 已寫入 Compose，預設不啟動 | XHS-Downloader 2.8 | `JoeanAmier/XHS-Downloader` | 小紅書採集候選。只聽 `127.0.0.1`，不接資料網路 |
| 已寫入 Compose，預設不啟動 | Douyin_TikTok_Download_API 5.1.13 | `Evil0ctal/Douyin_TikTok_Download_API` | 只有 API 映像。不接本專案資料庫，不含上游的 browser、downloader、transcriber |
| 未寫入 Compose | douyin-dl | `Achaiccccc/douyin-dl` | 沒有可釘住的 Docker Hub 映像。不在這裡建置 |
| 已寫入 Compose，預設不啟動 | Maigret `327c2bc` | `soxoj/maigret` | 備援。不跟 Sherlock 同時維護。profile 是 `backup` |
| 只登記來源 | 麦田 | `CzzzzzzJ/mdldm-maitian` | 自有帳號的發布工作台。沒有官方映像，不在這裡啟動 |
| 已接畫面，不載入上游套件 | Tippy.js、Popper、IBM Plex、Chakra Petch | 見開源組件頁 | 提示、定位、字型。圖表和圖示改由頁內實作 |
| 骨架，未取代現用畫面 | Next.js、React、TypeScript | `apps/web` 的鎖檔 | 之後的網頁工程 |

MediaCrawler、feedgrab、sociopath 沒有收進執行清單：沒有可核對的官方映像。Scrapling 只登記為沙箱候選。

一張圖進知識庫時，先看來源，再決定能不能當事實：

| 紀錄 | 來源等級 | 能不能當事實 |
|---|---|---|
| 時間 | 貼文公開時間 | 可當事實，註明出處 |
| 時間 | 檔案裡的拍攝時間 | 候選。與貼文時間並存，不覆蓋。標明來自檔案元數據 |
| 地點 | 貼文上的公開地點標籤 | 可當事實，註明出處 |
| 地點 | 檔案裡的位置欄 | 預設不寫入知識庫。要先確認這段元數據已經隨貼文公開；保留時降到城市級，標成受限，並經人工核准 |
| 同框 | 標題、提及、標籤寫明的已建檔帳號 | 候選。審核後才連到社交群組 |
| 同框 | 審核人指認的已建檔帳號 | 候選。審核後才連到社交群組 |
| 關係 | 任何來源 | 一直是候選，直到審核台確認 |

圖像分析的標籤限於文字、一般物件、標誌、場景和內容安全。社交群組寫的是帳號和帳號組成的圈子。知識庫裡的候選不觸發新的抓取。

知識庫的文件和向量都放在 PostgreSQL。文件欄位是 `jsonb`，向量欄位是 pgvector，維度尚未固定。規格第 5 節的資料庫是 PostgreSQL，第一版不引入 Qdrant。MongoDB 不進入這組 Compose。

| 約束 | 做到什麼程度算數 | 現況 |
|---|---|---|
| 控制面與資料分開 | 採集程式不直連任何資料服務，只經控制面 API 寫入 | **半** · `apps/control/app.py` 的四個寫入端點不寫 SQLite。舊的 kolindex-api 仍可寫它自己的 SQLite |
| 同框範圍 | 只對已經建檔的目標公開帳號成立。畫面裡的路人、家屬、未成年人不建紀錄、不指認 | **假** · 分析功能未做，這條尚未落地 |
| 關係類型 | 只記公開可陳述的協作：提及、合集、引用、同台。不推斷親屬、伴侶、健康、宗教 | **假** · 關係功能未做 |
| 模型只產候選 | 模型輸出不觸發採集、刪除或發布 | **半** · 文件已寫明。線框生成不會寫業務庫；其餘模型路徑未接 |
| 任務可追蹤 | 每筆工作有狀態、逾時和停止條件。失敗兩次就停，不無限重試 | **半** · 排程與席位有狀態。全站尚未統一 |
| 數字來自測量 | 畫面上的數量要能指出 API 或健康檢查。沒有來源就顯示「—」 | **半** · 基礎設施與部分看板已接。示範頁仍在 |
| 秘密不進倉庫 | 通行碼、金鑰、Cookie 只放在 NAS 的環境檔 | **真** · `.env` 被 gitignore |

GitHub Pages 只發靜態畫面。正式運行在家裡的 NAS。分頁細節見 ROADMAP。

## 2. 技術表

### 2.1 這個倉庫現在用的

| 層 | 技術 | 狀態 | 位置 |
|---|---|---|---|
| 現用畫面 | HTML、CSS、原生 JavaScript | 真 | `index2.html`、`css/`、`js/` |
| 本機站 | Node，零依賴 `tests/dev-server.mjs` | 真 | 預設 `127.0.0.1:5200` |
| 業務資料 | `kolindex-api` 的 `node:sqlite` | 真 | 另一個 repo。表數以該 repo 為準，本檔不另寫死 |
| 關聯資料與知識庫 | PostgreSQL 16.16，pgvector 0.8.7 | 待確認 | 映像 `pgvector/pgvector@sha256:484e838076e04939d27d3e176e91c86eea96236126023be8d3059761122e579f`。amd64 與 arm64 的 `PG_VERSION` 都是 `16.16-1.pgdg12+1`，2026-11-24 讀自登錄檔。業務 API 未接。知識庫 SQL 只在空資料目錄第一次啟動時執行 |
| 快取 | Redis 7.4.7 | 假 | 第一版不啟動。定義在 `infra/compose/docker-compose.later.yml`，等 Celery |
| 物件儲存 | 不使用 MinIO | 假 | 媒體放 `KOL_NAS_ROOT`。映像留在 `docker-compose.later.yml`，不隨主 Compose 啟動 |
| 搜尋 | Meilisearch v1.57.0 | 半 | 衍生索引。重建指令 `node scripts/rebuild-meilisearch.mjs` |
| 本機媒體 | `KOL_NAS_ROOT`，頁面讀同源 `/media` | 半 | 沒設時用倉庫下的 `data/nas` |
| 容器 | Docker Compose | 真 | `infra/compose/docker-compose.yml`。網頁映像是 `infra/compose/Dockerfile`，容器內不掛 Docker socket |
| 帳號發現 | Sherlock 官方映像 0.16.0，固定摘要 | 半 | 只在設了 `KOL_SHERLOCK=1` 的本機行程 |
| 開源候選容器 | Sherlock、XHS-Downloader、Douyin_TikTok_Download_API | 半 | `docker-compose.oss.yml` 的 profile `oss`。Maigret 只在 profile `backup` |
| 登入 | `KOL_GATE` 與 `KOL_ROLE` | 半 | 擋在這個網頁行程。業務 API 自身的認證待確認 |
| 另一套畫面骨架 | Next.js 16.4.6、React 19.3.1、TypeScript 5.9.3 | 假 | `apps/web`。尚未取代 `index2.html` |

### 2.2 規格 v4.1 要求、這個倉庫尚未當成完成狀態

| 層 | 規格要求 |
|---|---|
| 畫面 | Next.js、TypeScript |
| API | FastAPI、Python 3.12 |
| 非同步 | Celery |
| 秘密 | Vault，或 SOPS + age |
| 沙箱 | 獨立機器，優先 rootless Podman |
| 觀測 | OpenTelemetry、Prometheus、Grafana、Loki 或同等方案 |
| 政策 | Python 純函數與版本化 YAML |

第一版不引入 Kubernetes、K3s、Qdrant、LangGraph、多 Agent、Terraform、Ansible、多雲 Broker。

## 3. 時間表

下表的週數是規格裡的工期基準，不是已排定的日曆。2+3+3+2+4+4+3+2+2+3＝28 週，另加 2 週緩衝，共 30 週。起算日待確認。若起算日定為 2026-12-07，30 週後是 2027-07-05。2027-02-06 前後的春節要降產能，緩衝優先放在那段。v4.1 條文尚未逐條核對。

| 階段 | 基準 | 內容 | 這個倉庫的狀態 |
|---|---|---|---|
| M0 | 2 週 | 範圍、C4、資料流、STRIDE、資料分類、狀態機、ADR | **半** · 追蹤中的文件是本檔、README、ROADMAP。`/docs` 被 gitignore，裡面有沒有完整 M0，待確認 |
| M0.5 | 3 週 | 沙箱、mTLS、Egress、供應鏈掃描 | **待確認** · 未開始 |
| M1 | 3 週 | 控制面、身份、RBAC、計劃、批准、政策、審計 | **半** · 只有本機通行碼和三種角色 |
| M2 | 2 週 | Connector 登記、不可變版本 | **假** · 頁面上是清單，不是登記庫 |
| M3 | 4 週 | 沙箱執行、Intake、斷點、清理 | **待確認** · 未開始 |
| M4 | 4 週 | 初始 Connector、熔斷、限流 | **待確認** · 未開始 |
| M5 | 3 週 | 模型隔離、OCR、Vision、固定 Schema | **半** · 只有線框生成代理 |
| M6 | 2 週 | 成本帳、TTL、停止開關 | **待確認** · 未開始 |
| M7 | 2 週 | 全鏈刪除、回滾、故障演練 | **待確認** · 未開始 |
| 穩定化 | 3 週 | 效能、安全、驗收、文件 | **半** · 進行中的是原型文件與靜態檢查 |

## 4. 格式要求

| 項目 | 要求 |
|---|---|
| 語言 | 繁體中文。程式裡的識別名維持英文 |
| 日期 | `YYYY-MM-DD` |
| 狀態詞 | **真**：有 API 或健康檢查。**半**：只有一部分接上。**假**：重新整理就還原的示範。**待確認**：還沒測量 |
| 數字 | 寫出來就要能指出來源。沒有來源就寫「—」或「待確認」 |
| 映像 | `名稱@sha256:摘要`。還沒讀到摘要的，寫明發行版標籤，不寫 `latest` |
| 秘密 | 不寫進 Markdown、Git、日誌或前端 |
| 表格 | 一張表只講一類事情：目標、技術、時間或格式 |
| 連結 | 現況指向 README 或 ROADMAP。規格條文不改寫成完成紀錄 |
| 變更 | 改文件時同時改會互相矛盾的段落 |

## 5. 文件怎麼分工

| 文件 | 負責 |
|---|---|
| `PROJECT.md` | 時間表、技術表、技術目標、格式要求、阻斷項 |
| `README.md` | 安裝、執行、部署、目錄 |
| `ROADMAP.md` | 十二個分頁的真假和缺口 |
| `infra/compose/docker-compose.yml` | NAS 上實際會拉起的服務 |

## 6. 阻斷項

這些不是單一頁面的真假，單獨列在這裡。解除之前，不把對應能力寫成已經完成。

| 項目 | 影響 | 狀態 | 解除條件 |
|---|---|---|---|
| 業務 API 自身的認證 | `KOL_GATE` 擋在網頁行程。直連 `kolindex-api` 的認證方式，本倉庫未核對 | **待確認** | 在該 repo 核對寫入端點是否驗身份，並寫進 ROADMAP |
| 帶登入態的瀏覽器採集 | ROADMAP 記載 MyLike 同步走本機 Chrome。本倉庫沒有該後端，無法在這裡關閉 | **待確認** | 後端 repo 說明這條路徑的範圍，或停止它 |
| 磁碟與衍生層 | 本倉庫的衍生層另存檔，不改原檔。後端是否另有覆蓋原檔的壓縮，未在這裡核對 | **待確認** | 對照 `kolindex-api` 的壓縮實作 |
| 401 與示範資料 | `js/api.js` 對收集與告警的 401 會清卡片並回到登入閘 | **半** | 其餘模組是否在 401 時也清掉示範資料，待逐支核對 |
| 採集與資料同域 | 採集可寫入 SQLite | **假** | 採集只經控制面 API 寫入 |

## 7. NAS 上線前要核對

| # | 檢查 | 為什麼要核對 |
|---|---|---|
| 1 | 映像是否含這台 NAS 的 CPU 架構 | 家用 NAS 常是 ARM。第一版要核對 PostgreSQL、Meilisearch、Sherlock |
| 2 | 這個階段用 Docker | 規格寫優先 rootless Podman。家用 NAS 的容器工具對 Podman 的支援待確認。此階段先用 Docker，Podman 延後，並在這裡記上一筆 |
| 3 | 從外面看這台 NAS 的途徑 | 若用 DDNS、QuickConnect 或 Tailscale 對外，`KOL_GATE` 只擋到網頁行程。業務 API 的認證就更要先核對 |
| 4 | 媒體目錄的檔案權限 | 家庭共用一台 NAS 時，媒體和知識庫只給跑這個站的帳號讀 |
| 5 | 備份 | 磁碟陣列壞掉不等於還有備份。異地備份和還原演練仍待確認 |

MinIO 不在第一版主 Compose。映像仍在 `infra/compose/docker-compose.later.yml`，標籤是 `RELEASE.2025-10-15T17-29-55Z`。sha256 在 2026-11-24 沒有補上：這台開發機沒有 Docker，向 Quay 要 manifest 回 401。

```
docker pull quay.io/minio/minio:RELEASE.2025-10-15T17-29-55Z
docker image inspect --format "{{index .RepoDigests 0}}" quay.io/minio/minio:RELEASE.2025-10-15T17-29-55Z
```

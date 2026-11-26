# 功能現況與未實作清單

更新：2026-11-24。圖例：**真**＝打後端真實資料；**半**＝部分接真、其餘示範；**假**＝`js/index2.js` 的 FIXTURES 或記憶體陣列，重新整理就還原。

## 一、十二個分頁

| # | 分頁 | 現況 | 資料來源 | 還缺什麼 |
|---|---|---|---|---|
| 01 | 任務收集 | 真 | `GET /api/collect`、認領／退回寫 `collect_decision` + `audit_log` | 收集項目前只來自抖音作者索引（candidate 帳號），沒有其他平台。**邊界**：認領只做工作分派（assignee/state），不改 `identity_state`、不建 `person`；`confirmed` 只能由審核台的人類裁決產生 |
| 02 | 任務隊列 | 真 | 五條車道吃 `/api/jobs`、`/api/review/queue`、`/api/mylike/job`、`/api/seats`、`/api/library/download/job`；下方派工與席位面板吃 `/api/rail`、`/api/seats` | 沒有自己的 queue 表，是各真資料源的聚合視圖；派工仍要去席位頁按，這一頁唯讀 |
| 03 | 感測上下文 | 假 | `js/sense.js` 示範樣本（平台熱度／關鍵詞／情緒／事件候選） | UI 已重構；仍無真實採集特徵庫，數字標示範，不得當測量事實 |
| 04 | 產出庫 | 假 | `index2.js:825` 的 `OUTPUTS` 陣列、假編輯器 | 沒有產出物表／檔案儲存，存檔只改記憶體 |
| 05 | 席位執行 | 半 | 上方 fleet 八席真的跑（`GET/POST /api/seats`，`seat`／`seat_task` 表）；下方 80 席、角色目錄、里程碑仍是示範 | 席位是規則型掃描器（rule-v1），不是 LLM agent；80 席 STANDARD_ROLES 沒有後端 |
| 06 | 統一管線 | 假 | `FIXTURES.slots`（8 槽位、配額、lock TTL）+ 假事件流 | 沒有實際的管線執行器；`slot` 相關都是前端動畫 |
| 07 | 基礎設施 | 半 | 連接器 `GET /api/health/connectors`、排程 `GET /api/jobs`、容器開關要 `KOL_DOCKER=1` | 元件健康已拆成 Topics `#/health` 與 SSR `/ops/health`。第一版 Compose 只有網頁、PostgreSQL、Meilisearch。Redis 與 MinIO 不啟動 |
| 07b | 元件健康 | 真 | `GET /__health/components`；側欄卡可開 `#/health` | Docker 監測仍要 `KOL_DOCKER=1`；未設探測顯示「未設定」 |
| 08 | 開源組件 | 半 | 靜態清單 + `GET /__oss/status` + 工具台 `POST /__oss/run`（Sherlock／Maigret） | 沒有授權掃描。小紅書／抖音發現仍是 `not_enabled`，抓取固定 `off` |
| 09 | UI 生成 | 真 | `POST /__llm` 本地代理 → OpenAI 相容 API（需 `.env` 的 `LLM_API_KEY`） | 產物是線框圖 JSON，不是可執行頁面；沒金鑰時只顯示示範線框 |
| 10 | 人物檔案 | 半 | 人物主檔：`/__control/subjects`；抖音索引：`/api/library/authors` | 主檔可建人物、掛候選帳號、呼叫 `/__discovery`。覆蓋缺口仍無測量。抖音／小紅書發現仍是 `not_enabled` |
| 11 | 審核台 | 真 | `review_task`、`POST /api/review/:id/verdict`、`GET /api/audit` | 佇列只有 6 筆人工造的候選；沒有真正的 F2 產生的 review_task |
| 12 | 素材庫 | 真 | `GET /api/library`、`/api/library/authors`、`/api/library/:id`、MyLike 同步、無損清理、衍生層 | 1,361 件只有索引沒有本機檔；14 個收藏夾未索引；影片未處理。**衍生層不改原檔**（新增 `<原檔>.q50.webp` + `media_derivative` 血緣），所以不省空間 |

右欄監控（`/api/rail`）是真的：佇列深度、槽位、dispatcher、`audit_log`、儲存。但 **告警面板 0 筆**——`alert` 表在清掉示範資料後沒有產生器。

## 二、後端對照規格書 v2.2（25 表）

目前 **24 張表**（16 張對得上規格 + 8 張自建：`douyin_item`、`collect_decision`、`seat`、`seat_task`、`media_opt`、`media_derivative`、`mylike_folder`、`mylike_run`）。**規格書缺 9 張**：

`post_version`、`relation`、`avatar_reference`、`avatar_match`、`ai_label`、`media_inspection`、`subject_embedding`、`category_prototype`、`notification_delivery`。

端點（約 50 支）已實作：collect、review、ai events/ack、audit、jobs、library（含 authors／months／author／download／optimize／derivative）、rail、seats、health/connectors、mylike 系列、digest/latest。**規格書列了但沒做**：

- `POST /api/discover`（F1 跨平台發現）
- `POST /api/accounts/{id}/sync`（F3 單帳號同步）
- `GET /api/events`（SSE；目前全是輪詢）
- `POST /api/takedown`（下架）

工程面：PostgreSQL 是單一真相（ADR-009）。控制面設 `KOL_DATABASE_URL=postgres…` 時讀寫都走 PG；歷史 SQLite 用 `scripts/migrate_sqlite_to_postgres.py` 匯入，過渡期用 `scripts/reconcile_sqlite_postgres.py` 對帳。部分舊畫面仍代理 `kolindex-api` 的 `/api/*`，對帳通過前不得把那裡的數字當最終真相。Meilisearch 是可重建的衍生索引。Redis 與 MinIO 不在第一版 Compose。開源容器在 `infra/compose/docker-compose.oss.yml`，不進 `data` 網路。登入是 dev-server 的 `KOL_GATE` 和三種角色；沒設通行碼時是 `viewer`。運行位置是本機 NAS。開發約束以 v4.1 為準。下面的表數對照仍是畫面語意 v2.2 的 25 表。

## 三、未實作的功能（依優先級）

最近一輪（2026-11-25）：**整體版面再平衡** — 三欄在 1440 是 `248 + 810 + 372`，素材庫 1440 排四欄、收集頁表單與清單歸位、分頁籤在 1280 可橫向捲動、1024 頂欄回到單列、感測頁三卡一列、窄高視窗左軌不再被截斷。

**P0 治理（開發約束 v4.1；這一清單裡的表還沒建）**

1. 寫入端點自己的認證：**半**。網頁層 `KOL_PROD=1` 強制 `KOL_GATE`。`packages/api-auth` + `apps/api-gate` 已可擋直連 `5210`，但要掛到實際跑 `kolindex-api` 的機器上；那個 repo 目前不在本倉庫。還缺 `agent_action_log`
2. 缺 6 張治理表：`asset_registry`、`connector_registry`、`approval_token`、`cost_ledger`、`egress_policy`、`agent_action_log`
3. 多實例無選主：8 席 auto 模式若起兩個後端會重複派工（鐵律①）；需要 DB／檔案鎖 + fencing token
4. 保留政策未掛鉤：`retention_days` 沒有排程清理，`deletion_tombstone` 沒流程
5. 「本帳號點讚／收藏」是私有行為訊號（規格白名單只允許 ⚫ 遊客可見）：目前素材庫就是這批資料，屬於個人封存而非目標網紅監控；要不要繼續保留需明確決定

**P1 可信度**（把剩下的示範頁接真）

1. ~~任務隊列接真~~ 已完成（2026-11-24：五條車道、8 格 KPI、派工與席位面板；`test-queue.mjs` 27 項）
2. 基礎設施：DOCKER 子頁改成讀 `docker ps`（或至少讀一個 JSON），ECS／帳量／成本預算改真或移除
3. 產出庫：建 `output` 表 + `GET/POST /api/outputs`，編輯器落盤
4. 感測上下文：需要真正的採集資料，否則刪掉或標示為示範
5. 統一管線：`slot`／lock 的後端狀態（現在只有前端動畫）
6. 開源組件：改讀 `package.json`／CDN 清單與授權

**P2 抓取與媒體**

7. 14 個抖音收藏夾（約 1.2 萬筆）尚未抓索引
8. 1,361 件缺檔未下載（F: 剩約 10.5 GB，下載鈕已 disabled）
9. 影片完全沒處理（衍生層只做圖集 `kind='gallery'`）
10. 沒有縮圖管線（480px WebP）：目前直接吃原圖，列表載入慢
11. MyLike 同步只補索引、不下載；沒有排程自動同步
12. `index.json` 的 60 秒重建不在這個 repo。素材索引若仍靠那份 JSON，不能把它當成 PostgreSQL 的副本

**P3 規格書功能（F1–F12）**

13. F1 跨平台發現（小紅書／微博／YouTube／TikTok 的搜尋與帳號列舉）
14. F2 歸戶打分（0.35 頭像重用 + 0.35 bio 相似 + 0.20 名稱 + 0.10 活躍；>0.85 確認、0.5–0.85 送審、<0.5 排除）
15. F3–F6 採集器（目前完全沒有非抖音的 connector；`crawl_job` 的 10 筆是種子資料）
16. F11 分診／F12 閘門（`review_task` 只有 6 筆人工資料，沒有自動產生）
17. 跨平台統一時間軸（人物檔案現在只有抖音）
18. 頭像 hamming、OpenCLIP 媒體檢查、bge-m3 主體 embedding、分類原型
19. 告警產生器（`alert` 表空、`ai_event` 0 筆）
20. digest／notification_delivery／takedown
21. 人物頁的 timeline 端點存在，但 `person` 0 筆所以恆空

**P4 工程**

22. Postgres + RLS（M0 驗收前提）
23. API 認證與 CORS 收斂
24. SSE 取代輪詢（現在 rail 15s、seats 1.5s、jobs 60s…）
25. 後端 CI（前端 repo 已有 Actions；後端 repo 還沒有 workflow）
26. 備份異地化 · **半** · `scripts/nas/backup.mjs` 本機預設 7 份；設 `KOL_BACKUP_OFFSITE` 才算異地。多架構核對 `verify-multiarch.mjs`＋CI `multiarch-images.yml`。還原演練仍待實做紀錄（ADR-010）

## 四、要講清楚的幾件事

- **席位不是 AI agent**：八席跑的是六種規則掃描（素材庫、審核、收集、排程、磁碟、審計），沒有模型推理。要做成 LLM agent 需要 `.env` 的 `LLM_API_KEY` 與每人 token 預算。
- **智能層邊界**：發現結果有確定性 `confidence` 排序；控制面 `GET /intelligence/inbox` 聚合相似待審與覆蓋缺口。模型仍無工具、不自動合併、不因候選開啟抖音／小紅書抓取。
- **人物＝抖音作者，不是規格書的人**：`person` 表是空的，F2 歸戶完全沒做；人物檔案頁是「抖音作者索引」的包裝。
- **抓取靠本機 MyLike + CDP**：`kolindex-api` 會開 9222 的 Chrome DevTools 連線，換到伺服器要重寫。
- **GitHub Pages 是靜態的**：沒有 `/api`，線上版所有真資料頁都會退回示範資料。
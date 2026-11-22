# 功能現況與未實作清單

更新：2026-11-23。圖例：**真**＝打後端真實資料；**半**＝部分接真、其餘示範；**假**＝`js/index2.js` 的 FIXTURES 或記憶體陣列，重新整理就還原。

## 一、十二個分頁

| # | 分頁 | 現況 | 資料來源 | 還缺什麼 |
|---|---|---|---|---|
| 01 | 任務收集 | 真 | `GET /api/collect`、認領／退回寫 `collect_decision` + `audit_log` | 收集項目前只來自抖音作者索引（candidate 帳號），沒有其他平台。**邊界**：認領只做工作分派（assignee/state），不改 `identity_state`、不建 `person`；`confirmed` 只能由審核台的人類裁決產生 |
| 02 | 任務隊列 | 假 | `FIXTURES.tasks` + `requestAnimationFrame` 假調度（80 張卡、lane 移動、波形） | 後端沒有「任務隊列」語意的表；要嘛接 `crawl_job`（排程工作）要嘛新建 queue 表 |
| 03 | 感測上下文 | 假 | `index2.js:1846` 的 `sensors` 記憶體資料、`renderKnowledge()` | 沒有採集器、沒有特徵庫，卡片上的數字是寫死的 |
| 04 | 產出庫 | 假 | `index2.js:825` 的 `OUTPUTS` 陣列、假編輯器 | 沒有產出物表／檔案儲存，存檔只改記憶體 |
| 05 | 席位執行 | 半 | 上方 fleet 八席真的跑（`GET/POST /api/seats`，`seat`／`seat_task` 表）；下方 80 席、角色目錄、里程碑仍是示範 | 席位是規則型掃描器（rule-v1），不是 LLM agent；80 席 STANDARD_ROLES 沒有後端 |
| 06 | 統一管線 | 假 | `FIXTURES.slots`（8 槽位、配額、lock TTL）+ 假事件流 | 沒有實際的管線執行器；`slot` 相關都是前端動畫 |
| 07 | 基礎設施 | 半 | 連接器 `GET /api/health/connectors`、排程工作 `GET /api/jobs` 是真資料 | **DOCKER／ECS／帳量／成本預算四個子頁全是寫死的**（容器名、CPU、¥6,180 預算） |
| 08 | 開源組件 | 假 | 靜態清單與授權字串 | 沒有解析器、沒有授權掃描 |
| 09 | UI 生成 | 真 | `POST /__llm` 本地代理 → OpenAI 相容 API（需 `.env` 的 `LLM_API_KEY`） | 產物是線框圖 JSON，不是可執行頁面；沒金鑰時只顯示示範線框 |
| 10 | 人物檔案 | 半 | `GET /api/library/authors` 等，抖音作者 18,953 位 | **沒有跨平台歸戶**（`person` 表 0 筆）、沒有 F2 打分、沒有小紅書／微博／YouTube |
| 11 | 審核台 | 真 | `review_task`、`POST /api/review/:id/verdict`、`GET /api/audit` | 佇列只有 6 筆人工造的候選；沒有真正的 F2 產生的 review_task |
| 12 | 素材庫 | 真 | `GET /api/library`、`/api/library/authors`、`/api/library/:id`、MyLike 同步、無損清理、衍生層 | 954 件只有索引沒有本機檔；14 個收藏夾未索引；影片未處理。**衍生層不改原檔**（新增 `<原檔>.q50.webp` + `media_derivative` 血緣），所以不省空間 |

右欄監控（`/api/rail`）是真的：佇列深度、槽位、dispatcher、`audit_log`、儲存。但 **告警面板 0 筆**——`alert` 表在清掉示範資料後沒有產生器。

## 二、後端對照規格書 v2.2（25 表）

目前 **24 張表**（16 張對得上規格 + 8 張自建：`douyin_item`、`collect_decision`、`seat`、`seat_task`、`media_opt`、`media_derivative`、`mylike_folder`、`mylike_run`）。**規格書缺 9 張**：

`post_version`、`relation`、`avatar_reference`、`avatar_match`、`ai_label`、`media_inspection`、`subject_embedding`、`category_prototype`、`notification_delivery`。

端點（約 50 支）已實作：collect、review、ai events/ack、audit、jobs、library（含 authors／months／author／download／optimize／derivative）、rail、seats、health/connectors、mylike 系列、digest/latest。**規格書列了但沒做**：

- `POST /api/discover`（F1 跨平台發現）
- `POST /api/accounts/{id}/sync`（F3 單帳號同步）
- `GET /api/events`（SSE；目前全是輪詢）
- `POST /api/takedown`（下架）

工程面：SQLite（非 Postgres）、**沒有認證**、沒有 RLS、沒有 Docker、後端只在 Windows 本機跑。

## 三、未實作的功能（依優先級）

**P0 治理（規格 v4.0，原型全缺）**

1. 寫入端點沒有認證／RBAC：八組寫入（審核裁決、AI 事件 ack、收集認領／退回、席位派工、MyLike 同步、補檔、無損清理、衍生層）都只靠本機綁 127.0.0.1；生產需要本機 token + 角色 + `agent_action_log`
2. 缺 6 張治理表：`asset_registry`、`connector_registry`、`approval_token`、`cost_ledger`、`egress_policy`、`agent_action_log`
3. 多實例無選主：8 席 auto 模式若起兩個後端會重複派工（鐵律①）；需要 DB／檔案鎖 + fencing token
4. 保留政策未掛鉤：`retention_days` 沒有排程清理，`deletion_tombstone` 沒流程
5. 「本帳號點讚／收藏」是私有行為訊號（規格白名單只允許 ⚫ 遊客可見）：目前素材庫就是這批資料，屬於個人封存而非目標網紅監控；要不要繼續保留需明確決定

**P1 可信度**（把剩下的示範頁接真）

1. 任務隊列接 `GET /api/jobs`（後端現成，最省力）
2. 基礎設施：DOCKER 子頁改成讀 `docker ps`（或至少讀一個 JSON），ECS／帳量／成本預算改真或移除
3. 產出庫：建 `output` 表 + `GET/POST /api/outputs`，編輯器落盤
4. 感測上下文：需要真正的採集資料，否則刪掉或標示為示範
5. 統一管線：`slot`／lock 的後端狀態（現在只有前端動畫）
6. 開源組件：改讀 `package.json`／CDN 清單與授權

**P2 抓取與媒體**

7. 14 個抖音收藏夾（約 1.2 萬筆）尚未抓索引
8. 954 件缺檔未下載（F: 只剩 5.5 GB，下載鈕已 disabled）
9. 影片完全沒處理（衍生層只做圖集 `kind='gallery'`）
10. 沒有縮圖管線（480px WebP）：目前直接吃原圖，列表載入慢
11. MyLike 同步只補索引、不下載；沒有排程自動同步
12. `index.json` 67 MB + 每 60 秒重建的 loop，不是長久做法

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
26. 備份異地化（目前只有本機 7 份）

## 四、要講清楚的幾件事

- **席位不是 AI agent**：八席跑的是六種規則掃描（素材庫、審核、收集、排程、磁碟、審計），沒有模型推理。要做成 LLM agent 需要 `.env` 的 `LLM_API_KEY` 與每人 token 預算。
- **人物＝抖音作者，不是規格書的人**：`person` 表是空的，F2 歸戶完全沒做；人物檔案頁是「抖音作者索引」的包裝。
- **抓取靠本機 MyLike + CDP**：`kolindex-api` 會開 9222 的 Chrome DevTools 連線，換到伺服器要重寫。
- **GitHub Pages 是靜態的**：沒有 `/api`，線上版所有真資料頁都會退回示範資料。
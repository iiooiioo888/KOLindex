# ADR-006 資料面收斂

- 狀態：已接受為本階段決定
- 日期：2026-11-24

## 決定

PostgreSQL 是唯一真相。文件放 `jsonb`，向量放 pgvector。Meilisearch 只放可重建的搜尋索引。媒體放 `KOL_NAS_ROOT` 的檔案，加上 checksum 與媒體表。MinIO 不進第一版。Redis 等到 Celery 進場再加。秘密用 SOPS 與 age，不建 Vault。

| 存放處 | 角色 | 壞了怎麼辦 |
|---|---|---|
| PostgreSQL | 真相 | 從備份還原。不能從其他存放處回推 |
| `KOL_NAS_ROOT` 檔案 | 真相（原始位元） | 從備份還原。checksum 對不上就標失敗 |
| Meilisearch | 衍生 | `node scripts/rebuild-meilisearch.mjs --input export.json` |
| SQLite buffer | 過渡 | 搬進 PostgreSQL 後刪除 |
| Redis | 第一版不啟用 | 沒有資料要救 |
| MinIO | 第一版不啟用 | 沒有資料要救 |

全鏈刪除要清這些地方，正常寫入端點不能改、不能刪：

1. PostgreSQL 的內容表。刪除走另外的管理路徑，先追加一筆刪除紀錄，再由那條路徑移除內容。四個寫入端點本身不提供修改或刪除。
2. `KOL_NAS_ROOT/inbox/` 與 `KOL_NAS_ROOT/media/` 裡對應 checksum 的檔案。
3. Meilisearch 索引 `kolindex_media`。
4. SQLite buffer 裡同一筆的複本（還在過渡期時）。
5. 瀏覽器裡這個人的畫面狀態。重新整理後不得再出現。

不在清單裡的：MinIO、Redis、Vault。第一版沒有這些存放處。

## 為什麼

四個服務一起當真相時，刪除和重建都會漏。搜尋索引和物件儲存都可以從 PostgreSQL 與 NAS 檔案再做出來。向量不需要另一套資料庫，pgvector 就在 PostgreSQL 裡。規格第一版不引入 Qdrant，這個決定也不引入 MongoDB。

## 代價

已有的 Compose 若曾經拉起 MinIO 或 Redis，那兩個目錄不再由第一版 `docker compose up` 啟動。裡面的檔案不會被這份決定自動刪掉。Meilisearch 的主金鑰仍然要放在 NAS 的環境檔。age 的收件人公鑰寫進 `.sops.yaml` 之前，秘密檔還不能加密。

## 何時重審

Celery 的任務協調要進場時，再把 Redis 加回來，而且只當協調，不當真相。若 NAS 檔案的備份演練失敗，再重審媒體是否改放物件儲存。

## 2026-11-26 補充

SQLite／PostgreSQL 雙軌收斂見 ADR-009。運維入口：

```text
python scripts/migrate_sqlite_to_postgres.py --sqlite <sqlite路徑>
python scripts/reconcile_sqlite_postgres.py --sqlite <sqlite路徑>
GET /__control/truth/status
```

已有 PostgreSQL 資料目錄須補跑 `infra/compose/postgres/init/004-truth-reconcile.sql`。

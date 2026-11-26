# ADR-009 SQLite → PostgreSQL 單一真相

- 狀態：已接受
- 日期：2026-11-26
- 關聯：ADR-004、ADR-006

## 決定

1. **PostgreSQL（含 pgvector）是唯一業務真相。** 控制面在 `KOL_DATABASE_URL` 為 `postgres…` 時，讀寫都走 PostgreSQL，不再靜默落到 SQLite。
2. **SQLite 只剩兩種過渡角色：**
   - 本倉庫控制面 buffer（未設 PG 且非 `KOL_PROD=1`）
   - 外部 `kolindex-api` 的歷史庫（只作遷移來源，不作畫面真相）
3. **遷移單向：** `scripts/migrate_sqlite_to_postgres.py` 只 SQLite → PostgreSQL，不回寫。
4. **過渡期對帳：** `scripts/reconcile_sqlite_postgres.py` 比對筆數與 `content_hash`／`checksum`，結果寫入 `data_reconcile_runs`／`data_reconcile_gaps`。
5. **無法映射的舊表**進 `legacy_sqlite_rows`（jsonb + content_hash），不發明未核對的 35 張業務表。
6. **前端讀取：** 人物／控制面資料經 `/__control/*` 讀控制面；控制面接 PG 後即讀 PG。舊 `/api/*`（kolindex-api SQLite）在遷移與對帳通過前可並存，但文件與 `/truth/status` 標明它們不是真相。

## 為什麼

雙庫無對帳會讓人數、作品數、審核狀態出現兩套數字。控制面先前在設了 PG URL 時仍用 SQLite `connect()`，等於宣稱 PG 真相卻未落地。先把寫入與讀取接到同一後端，再用遷移／對帳收斂歷史。

## 代價

- 需要固定版本 `psycopg[binary]==3.2.4`。
- 已有 PG 資料目錄要手動執行 `infra/compose/postgres/init/004-truth-reconcile.sql`。
- `kolindex-api` 專屬表（審核、席位工單等）在映射完成前只進 legacy，畫面若仍打舊 `/api/*` 會暫時與 PG 不一致——以對帳腳本缺口為準。

## 何時重審

對帳連續兩週 `ok=true` 且無新的 `hash_missing_in_pg`，並且業務畫面不再依賴 `/api/*` 讀 SQLite 時，刪除 buffer、停止掛載外部 SQLite 路徑。

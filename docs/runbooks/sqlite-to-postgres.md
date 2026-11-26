# Runbook：SQLite → PostgreSQL 單一真相

## 前置

1. Compose 已起 PostgreSQL（pgvector 映像）。
2. 若資料目錄不是新建，手動執行一次：

```bash
psql "$KOL_DATABASE_URL" -f infra/compose/postgres/init/004-truth-reconcile.sql
```

3. 控制面環境：

```bash
set KOL_DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5432/kolindex
set KOL_PROD=1
pip install -r apps/control/requirements.txt
```

## 遷移（單向）

```bash
# 控制面 buffer
python scripts/migrate_sqlite_to_postgres.py --sqlite data/nas/buffer/control.sqlite --source-db control-buffer

# 外部 kolindex-api
python scripts/migrate_sqlite_to_postgres.py --sqlite PATH/to/kolindex-api.sqlite --source-db kolindex-api
```

可先 `--dry-run`。未映射表進入 `legacy_sqlite_rows`，不發明新業務表。

## 對帳（過渡期建議排程）

```bash
python scripts/reconcile_sqlite_postgres.py --sqlite PATH/to.sqlite --source-db kolindex-api --schedule-note hourly
```

結束碼：`0` 一致、`1` 有缺口、`2` 設定錯誤。缺口寫入 `data_reconcile_gaps`（content_hash／筆數）。

Windows 工作排程或 cron 範例（每小時）：

```text
0 * * * * cd /path/KOLindex && KOL_DATABASE_URL=postgresql://… python scripts/reconcile_sqlite_postgres.py --sqlite /path/api.sqlite --schedule-note hourly
```

## 驗證

```bash
curl -H "Authorization: Bearer $KOL_TOKEN_VIEWER" http://127.0.0.1:5220/truth/status
```

`truth` 必須是 `postgres`。人物頁讀 `/__control/subjects`，不再把 SQLite 人數當真相。

## 回滾

遷移不回寫 SQLite。若 PG 寫入有誤：從 PG 備份還原，保留 SQLite 檔案作來源，修好後重跑遷移（`ON CONFLICT`／唯一鍵會跳過已存在列）。

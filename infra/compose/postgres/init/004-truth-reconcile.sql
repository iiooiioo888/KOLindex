-- 單一真相收斂：對齊控制面欄位、對帳簿、未映射 legacy 暫存。
-- 空目錄第一次啟動會跑；已有庫請另外執行一次。

-- media_similarity_links：補 id，與控制面 SQLite 形狀對齊
ALTER TABLE media_similarity_links ADD COLUMN IF NOT EXISTS id text;
UPDATE media_similarity_links
  SET id = 'msim_' || seq::text
  WHERE id IS NULL OR btrim(id) = '';
CREATE UNIQUE INDEX IF NOT EXISTS media_similarity_links_id_uidx
  ON media_similarity_links (id);
ALTER TABLE media_similarity_links ALTER COLUMN source_id SET DEFAULT 'control';

-- 對帳執行紀錄（可更新：這是運維表，不是業務 append-only）
CREATE TABLE IF NOT EXISTS data_reconcile_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source_label text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('migrate', 'reconcile')),
  ok boolean NOT NULL DEFAULT false,
  sqlite_path text,
  notes text NOT NULL DEFAULT '',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS data_reconcile_gaps (
  id bigserial PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES data_reconcile_runs (id) ON DELETE CASCADE,
  domain text NOT NULL,
  gap_kind text NOT NULL CHECK (gap_kind IN (
    'count_mismatch', 'hash_missing_in_pg', 'hash_missing_in_sqlite', 'unmapped_table', 'error'
  )),
  content_hash text,
  sqlite_count bigint,
  pg_count bigint,
  detail text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_reconcile_gaps_run_idx ON data_reconcile_gaps (run_id);

-- 無法直接映射的 kolindex-api / 舊 SQLite 列，以 jsonb 暫存，帶 content_hash 供對帳
CREATE TABLE IF NOT EXISTS legacy_sqlite_rows (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_db text NOT NULL,
  source_table text NOT NULL,
  source_pk text NOT NULL,
  content_hash text,
  payload jsonb NOT NULL,
  UNIQUE (source_db, source_table, source_pk)
);

CREATE INDEX IF NOT EXISTS legacy_sqlite_rows_hash_idx
  ON legacy_sqlite_rows (content_hash)
  WHERE content_hash IS NOT NULL;

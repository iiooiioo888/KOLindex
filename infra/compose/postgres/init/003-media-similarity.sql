-- 圖片相似關聯。空目錄第一次啟動會跑；已有庫要另外執行一次。
-- 只追加。相似度達到門檻只建 waiting_review，不合併人物。

CREATE TABLE IF NOT EXISTS media_similarity_links (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  left_media_id text NOT NULL,
  right_media_id text NOT NULL,
  score double precision NOT NULL CHECK (score >= 0 AND score <= 1),
  kind text NOT NULL CHECK (kind IN ('near_duplicate', 'copy_suspect')),
  status text NOT NULL CHECK (status IN ('waiting_review', 'confirmed', 'rejected', 'deferred')),
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  policy_version text NOT NULL,
  reason text NOT NULL,
  UNIQUE (left_media_id, right_media_id, tool_name, tool_version),
  CHECK (left_media_id <> right_media_id),
  CHECK (left_media_id < right_media_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'media_similarity_links_append_only'
  ) THEN
    CREATE TRIGGER media_similarity_links_append_only
      BEFORE UPDATE OR DELETE ON media_similarity_links
      FOR EACH ROW EXECUTE FUNCTION kol_reject_mutation();
  END IF;
END $$;

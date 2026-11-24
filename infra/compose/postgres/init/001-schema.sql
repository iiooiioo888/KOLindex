-- 空資料目錄第一次啟動才會跑。已有資料目錄時，用同一份檔在庫裡執行一次。
-- 寫入端點只准 INSERT。不在這裡加查詢用索引：還沒有兩週測量。

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE OR REPLACE FUNCTION kol_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only';
END;
$$;

CREATE TABLE intake (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  captured_at timestamptz NOT NULL,
  content_hash text NOT NULL UNIQUE,
  storage_path text NOT NULL
);

CREATE TABLE artifact (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  original_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('thumb', 'keyframe', 'ocr', 'vision')),
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE change_event (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  before_ref text,
  after_ref text,
  diff_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL CHECK (state IN (
    'queued', 'running', 'succeeded', 'failed', 'stopped', 'timeout', 'cancelled', 'waiting_review'
  )),
  policy_version text NOT NULL
);

CREATE TABLE decision (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  target_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('confirm', 'reject', 'defer')),
  reason text NOT NULL,
  reviewer text NOT NULL,
  decided_at timestamptz NOT NULL
);

CREATE TABLE media_original (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  source_url text NOT NULL,
  captured_at timestamptz NOT NULL,
  checksum text NOT NULL UNIQUE,
  storage_path text NOT NULL,
  time_source text NOT NULL CHECK (time_source IN ('public_post', 'file_time')),
  time_status text NOT NULL CHECK (time_status IN ('fact', 'candidate')),
  place_source text,
  place_text text,
  CHECK (
    (time_source = 'public_post' AND time_status = 'fact')
    OR (time_source = 'file_time' AND time_status = 'candidate')
  ),
  CHECK (place_text IS NULL OR place_source = 'public_post'),
  CHECK (place_source IS NULL OR place_source <> 'file_place')
);

CREATE TABLE media_derivative (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  original_id bigint NOT NULL REFERENCES media_original (seq),
  kind text NOT NULL CHECK (kind IN ('thumb', 'keyframe', 'ocr', 'vision')),
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE observation (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  derivative_id bigint NOT NULL REFERENCES media_derivative (seq),
  label text NOT NULL CHECK (label IN ('text', 'object', 'logo', 'scene', 'safety')),
  origin text NOT NULL CHECK (origin IN ('model', 'human')),
  status text NOT NULL CHECK (status IN ('candidate', 'confirmed')),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  relation_kind text CHECK (relation_kind IN ('mention', 'collection', 'citation', 'same_stage')),
  subject_ref text,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector,
  CHECK (status <> 'confirmed' OR origin = 'human'),
  CHECK (relation_kind IS NULL OR status = 'candidate' OR origin = 'human'),
  CHECK (NOT (body ? 'face' OR body ? 'kinship' OR body ? 'partner' OR body ? 'health' OR body ? 'religion'))
);

CREATE TABLE evidence_link (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  observation_id bigint NOT NULL REFERENCES observation (seq),
  original_id bigint NOT NULL REFERENCES media_original (seq),
  frame_no integer,
  box jsonb,
  text_span text,
  CHECK (frame_no IS NOT NULL OR box IS NOT NULL OR text_span IS NOT NULL)
);

CREATE TABLE knowledge_document (
  seq bigserial PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source_id text NOT NULL,
  original_id bigint REFERENCES media_original (seq),
  body jsonb NOT NULL,
  embedding vector,
  CHECK (NOT (body ? 'face' OR body ? 'kinship' OR body ? 'partner' OR body ? 'health' OR body ? 'religion'))
);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'intake', 'artifact', 'change_event', 'decision',
    'media_original', 'media_derivative', 'observation', 'evidence_link', 'knowledge_document'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kol_reject_mutation()',
      tbl || '_append_only', tbl
    );
  END LOOP;
END $$;

-- KOL 作品與媒體索引。人物／帳號在 002-subjects.sql。
-- 這裡只存索引與路徑，原始圖片仍在 KOL_NAS_ROOT。
-- 空目錄第一次啟動會跑；已有庫要另外執行一次。

CREATE TABLE IF NOT EXISTS indexed_posts (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES platform_accounts (id),
  subject_id text REFERENCES subjects (id),
  platform text NOT NULL CHECK (platform IN (
    'bilibili', 'douyin', 'xiaohongshu', 'tiktok', 'weibo', 'youtube', 'other'
  )),
  external_post_id text NOT NULL,
  published_at timestamptz,
  title text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  content_hash text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_post_id)
);

CREATE TABLE IF NOT EXISTS media_index (
  id text PRIMARY KEY,
  subject_id text REFERENCES subjects (id),
  account_id text REFERENCES platform_accounts (id),
  post_id text REFERENCES indexed_posts (id),
  media_kind text NOT NULL CHECK (media_kind IN ('image', 'video', 'gallery', 'avatar', 'other')),
  checksum text NOT NULL UNIQUE,
  storage_path text NOT NULL,
  source_url text NOT NULL DEFAULT '',
  bytes bigint,
  width integer,
  height integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  time_source text NOT NULL CHECK (time_source IN ('public_post', 'file_time')),
  time_status text NOT NULL CHECK (time_status IN ('fact', 'candidate')),
  CHECK (
    (time_source = 'public_post' AND time_status = 'fact')
    OR (time_source = 'file_time' AND time_status = 'candidate')
  )
);

CREATE INDEX IF NOT EXISTS media_index_subject_idx ON media_index (subject_id);
CREATE INDEX IF NOT EXISTS media_index_account_idx ON media_index (account_id);
CREATE INDEX IF NOT EXISTS indexed_posts_subject_idx ON indexed_posts (subject_id);

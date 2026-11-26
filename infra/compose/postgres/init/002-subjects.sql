-- 人物主檔與平台帳號。空目錄第一次啟動會跑；已有庫要另外執行一次。
-- indexed_posts / claimed_posts 不在這裡硬寫，覆蓋缺口要有來源才顯示數字。

CREATE TABLE IF NOT EXISTS subjects (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS platform_accounts (
  id text PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN (
    'bilibili', 'douyin', 'xiaohongshu', 'tiktok', 'weibo', 'youtube', 'other'
  )),
  external_account_id text NOT NULL,
  display_name text NOT NULL,
  profile_url text NOT NULL DEFAULT '',
  UNIQUE (platform, external_account_id)
);

CREATE TABLE IF NOT EXISTS subject_account_links (
  subject_id text NOT NULL REFERENCES subjects (id),
  account_id text NOT NULL REFERENCES platform_accounts (id),
  link_status text NOT NULL CHECK (link_status IN ('candidate', 'confirmed', 'rejected')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by text NOT NULL,
  PRIMARY KEY (subject_id, account_id)
);

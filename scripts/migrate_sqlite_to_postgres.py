#!/usr/bin/env python3
"""單向遷移：SQLite → PostgreSQL。

用途：
  1) 控制面 buffer（intake / artifact / change_event / decision / subjects / …）
  2) 外部 kolindex-api SQLite：能映射的表寫入對應 PG 表；不能映射的進 legacy_sqlite_rows

不回寫 SQLite。遷移後請跑 reconcile_sqlite_postgres.py。

範例：
  set KOL_DATABASE_URL=postgresql://kol:kol@127.0.0.1:5432/kolindex
  python scripts/migrate_sqlite_to_postgres.py --sqlite data/nas/buffer/control.sqlite
  python scripts/migrate_sqlite_to_postgres.py --sqlite E:/path/to/kolindex-api.sqlite --source-db kolindex-api
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "control"))

from db import connect, is_postgres, production_blocks_sqlite  # noqa: E402


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def row_hash(payload: dict) -> str:
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


# sqlite 表 → (pg 表, 欄位對應 list[(sqlite_col, pg_col)] 或 None=同名交集)
MAPPED = {
    "intake": ("intake", ["source_id", "captured_at", "content_hash", "storage_path", "recorded_at"]),
    "artifact": ("artifact", ["source_id", "original_id", "kind", "tool_name", "tool_version", "params", "recorded_at"]),
    "change_event": ("change_event", ["source_id", "before_ref", "after_ref", "diff_fields", "state", "policy_version", "recorded_at"]),
    "decision": ("decision", ["source_id", "target_id", "action", "reason", "reviewer", "decided_at", "recorded_at"]),
    "subjects": ("subjects", ["id", "display_name", "created_at", "updated_at", "note"]),
    "platform_accounts": ("platform_accounts", ["id", "platform", "external_account_id", "display_name", "profile_url"]),
    "subject_account_links": ("subject_account_links", ["subject_id", "account_id", "link_status", "linked_at", "linked_by"]),
    "indexed_posts": (
        "indexed_posts",
        [
            "id", "account_id", "subject_id", "platform", "external_post_id",
            "published_at", "title", "caption", "source_url", "content_hash", "captured_at",
        ],
    ),
    "media_index": (
        "media_index",
        [
            "id", "subject_id", "account_id", "post_id", "media_kind", "checksum",
            "storage_path", "source_url", "bytes", "width", "height", "captured_at",
            "time_source", "time_status",
        ],
    ),
    "media_similarity_links": (
        "media_similarity_links",
        [
            "id", "source_id", "left_media_id", "right_media_id", "score", "kind", "status",
            "tool_name", "tool_version", "policy_version", "reason", "recorded_at",
        ],
    ),
}

# 常見業務別名 → 映射表（kolindex-api 可能用不同表名）
ALIASES = {
    "posts": "indexed_posts",
    "media": "media_index",
    "authors": None,  # 進 legacy
    "review_task": None,
    "audit_log": None,
    "seat_task": None,
    "crawl_job": None,
}


def sqlite_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def table_cols(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def ensure_reconcile_schema(pg) -> None:
    pg.execute(
        """
        CREATE TABLE IF NOT EXISTS data_reconcile_runs (
          id bigserial PRIMARY KEY,
          started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz,
          source_label text NOT NULL,
          mode text NOT NULL,
          ok boolean NOT NULL DEFAULT false,
          sqlite_path text,
          notes text NOT NULL DEFAULT '',
          summary jsonb NOT NULL DEFAULT '{}'::jsonb
        )
        """
    )
    pg.execute(
        """
        CREATE TABLE IF NOT EXISTS data_reconcile_gaps (
          id bigserial PRIMARY KEY,
          run_id bigint NOT NULL REFERENCES data_reconcile_runs (id) ON DELETE CASCADE,
          domain text NOT NULL,
          gap_kind text NOT NULL,
          content_hash text,
          sqlite_count bigint,
          pg_count bigint,
          detail text NOT NULL DEFAULT '',
          recorded_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    pg.execute(
        """
        CREATE TABLE IF NOT EXISTS legacy_sqlite_rows (
          seq bigserial PRIMARY KEY,
          recorded_at timestamptz NOT NULL DEFAULT now(),
          source_db text NOT NULL,
          source_table text NOT NULL,
          source_pk text NOT NULL,
          content_hash text,
          payload jsonb NOT NULL,
          UNIQUE (source_db, source_table, source_pk)
        )
        """
    )
    pg.execute("ALTER TABLE media_similarity_links ADD COLUMN IF NOT EXISTS id text")
    pg.commit()


def insert_mapped(pg, sqlite_conn: sqlite3.Connection, table: str, pg_table: str, cols: list[str], dry: bool) -> dict:
    have = table_cols(sqlite_conn, table)
    use = [c for c in cols if c in have]
    if not use:
        return {"table": table, "pg": pg_table, "copied": 0, "skipped": "no_columns"}
    rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
    copied = 0
    for r in rows:
        payload = {c: r[c] for c in use}
        if pg_table == "artifact" and "params" in payload and not isinstance(payload["params"], str):
            payload["params"] = json.dumps(payload["params"], ensure_ascii=False)
        if pg_table == "change_event" and "diff_fields" in payload and not isinstance(payload["diff_fields"], str):
            payload["diff_fields"] = json.dumps(payload["diff_fields"], ensure_ascii=False)
        if pg_table == "media_similarity_links":
            payload.setdefault("source_id", "control")
            if not payload.get("id"):
                payload["id"] = "msim_import_" + row_hash(payload)[:16]
        placeholders = ",".join(["?"] * len(payload))
        colnames = ",".join(payload.keys())
        sql = f"INSERT INTO {pg_table} ({colnames}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
        if not dry:
            # jsonb 欄位：artifact.params / change_event.diff_fields 在 PG 是 jsonb
            vals = []
            for k, v in payload.items():
                if k in {"params", "diff_fields"} and isinstance(v, str):
                    try:
                        vals.append(json.loads(v))
                    except json.JSONDecodeError:
                        vals.append(v)
                else:
                    vals.append(v)
            # ON CONFLICT DO NOTHING 需要衝突目標；改用例外吞掉
            try:
                simple = f"INSERT INTO {pg_table} ({colnames}) VALUES ({placeholders})"
                pg.execute(simple, vals)
            except Exception as exc:
                msg = str(exc).lower()
                if "duplicate" in msg or "unique" in msg or "conflict" in msg:
                    continue
                raise
            copied += 1
        else:
            copied += 1
    if not dry:
        pg.commit()
    return {"table": table, "pg": pg_table, "copied": copied, "columns": use}


def insert_legacy(pg, source_db: str, table: str, sqlite_conn: sqlite3.Connection, dry: bool) -> dict:
    rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
    cols = [d[0] for d in sqlite_conn.execute(f"PRAGMA table_info({table})").fetchall()]
    pk_cols = [d[1] for d in sqlite_conn.execute(f"PRAGMA table_info({table})").fetchall() if d[5]]
    copied = 0
    for r in rows:
        payload = {c: r[c] for c in cols}
        if pk_cols:
            source_pk = "|".join(str(payload.get(c, "")) for c in pk_cols)
        else:
            source_pk = row_hash(payload)[:32]
        ch = None
        for key in ("content_hash", "checksum", "hash", "sha256"):
            if payload.get(key):
                ch = str(payload[key])
                break
        if not ch:
            ch = row_hash(payload)
        if dry:
            copied += 1
            continue
        try:
            pg.execute(
                """
                INSERT INTO legacy_sqlite_rows (source_db, source_table, source_pk, content_hash, payload)
                VALUES (?,?,?,?,?::jsonb)
                """,
                (source_db, table, source_pk, ch, json.dumps(payload, ensure_ascii=False, default=str)),
            )
            copied += 1
        except Exception as exc:
            msg = str(exc).lower()
            if "duplicate" in msg or "unique" in msg:
                continue
            # 某些驅動要傳 dict
            try:
                pg.execute(
                    """
                    INSERT INTO legacy_sqlite_rows (source_db, source_table, source_pk, content_hash, payload)
                    VALUES (?,?,?,?,?)
                    """,
                    (source_db, table, source_pk, ch, json.dumps(payload, ensure_ascii=False, default=str)),
                )
                copied += 1
            except Exception as exc2:
                if "duplicate" in str(exc2).lower() or "unique" in str(exc2).lower():
                    continue
                raise
    if not dry:
        pg.commit()
    return {"table": table, "pg": "legacy_sqlite_rows", "copied": copied}


def migrate(sqlite_path: Path, source_db: str, dry: bool) -> dict:
    production_blocks_sqlite()
    if not is_postgres():
        raise SystemExit("請設定 KOL_DATABASE_URL=postgresql://… 再遷移")
    if not sqlite_path.is_file():
        raise SystemExit(f"找不到 SQLite：{sqlite_path}")

    sqlite_conn = sqlite3.connect(str(sqlite_path))
    sqlite_conn.row_factory = sqlite3.Row
    summary: dict = {
        "started_at": utc_now(),
        "sqlite": str(sqlite_path),
        "source_db": source_db,
        "dry_run": dry,
        "mapped": [],
        "legacy": [],
        "unmapped": [],
    }

    with connect() as pg:
        ensure_reconcile_schema(pg)
        run = pg.execute(
            """
            INSERT INTO data_reconcile_runs (source_label, mode, ok, sqlite_path, notes, summary)
            VALUES (?,?,?,?,?,?::jsonb)
            RETURNING id
            """,
            (source_db, "migrate", False, str(sqlite_path), "in_progress", "{}"),
        ).fetchone()
        # db.Cursor adds RETURNING seq automatically for INSERT — but we used RETURNING id
        # If lastrowid path fired incorrectly... We used explicit RETURNING id so fetchone works.
        run_id = run["id"] if run and "id" in run else (run[0] if run else None)
        if run_id is None:
            # fallback: our Cursor may have double-RETURNING; re-query
            run_id = pg.execute(
                "SELECT id FROM data_reconcile_runs ORDER BY id DESC LIMIT 1"
            ).fetchone()["id"]
        pg.commit()

        for table in sqlite_tables(sqlite_conn):
            target = MAPPED.get(table)
            if not target and table in ALIASES:
                alias = ALIASES[table]
                if alias is None:
                    result = insert_legacy(pg, source_db, table, sqlite_conn, dry)
                    summary["legacy"].append(result)
                    pg.execute(
                        """
                        INSERT INTO data_reconcile_gaps (run_id, domain, gap_kind, detail)
                        VALUES (?,?,?,?)
                        """,
                        (run_id, table, "unmapped_table", "aliased_to_legacy"),
                    )
                    continue
                target = MAPPED.get(alias)
            if target:
                pg_table, cols = target
                summary["mapped"].append(insert_mapped(pg, sqlite_conn, table, pg_table, cols, dry))
            else:
                result = insert_legacy(pg, source_db, table, sqlite_conn, dry)
                summary["legacy"].append(result)
                summary["unmapped"].append(table)
                if not dry:
                    pg.execute(
                        """
                        INSERT INTO data_reconcile_gaps (run_id, domain, gap_kind, detail)
                        VALUES (?,?,?,?)
                        """,
                        (run_id, table, "unmapped_table", "stored_in_legacy_sqlite_rows"),
                    )

        summary["finished_at"] = utc_now()
        if not dry:
            pg.execute(
                """
                UPDATE data_reconcile_runs
                SET finished_at=?, ok=true, notes=?, summary=?::jsonb
                WHERE id=?
                """,
                (utc_now(), "migrate_done", json.dumps(summary, ensure_ascii=False), run_id),
            )
            pg.commit()

    sqlite_conn.close()
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description="SQLite → PostgreSQL 單向遷移")
    ap.add_argument("--sqlite", required=True, help="來源 SQLite 路徑")
    ap.add_argument("--source-db", default="control-buffer", help="來源標籤（寫入 legacy / 對帳）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    summary = migrate(Path(args.sqlite).resolve(), args.source_db, args.dry_run)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

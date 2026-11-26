#!/usr/bin/env python3
"""過渡期對帳：比對 SQLite 與 PostgreSQL 的筆數與 content_hash。

範例：
  set KOL_DATABASE_URL=postgresql://kol:kol@127.0.0.1:5432/kolindex
  python scripts/reconcile_sqlite_postgres.py --sqlite data/nas/buffer/control.sqlite
  python scripts/reconcile_sqlite_postgres.py --sqlite E:/api/data.sqlite --source-db kolindex-api --schedule-note "hourly"

結束碼：0=一致；1=有缺口；2=設定錯誤。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "control"))

from db import connect, is_postgres  # noqa: E402

# domain → (sqlite 表, pg 表, hash 欄)
DOMAINS = [
    ("intake", "intake", "intake", "content_hash"),
    ("decision", "decision", "decision", None),  # 無 hash：只比筆數
    ("artifact", "artifact", "artifact", None),
    ("change_event", "change_event", "change_event", None),
    ("indexed_posts", "indexed_posts", "indexed_posts", "content_hash"),
    ("media_index", "media_index", "media_index", "checksum"),
    ("subjects", "subjects", "subjects", None),
    ("platform_accounts", "platform_accounts", "platform_accounts", None),
    ("media_similarity_links", "media_similarity_links", "media_similarity_links", None),
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def count_sqlite(conn: sqlite3.Connection, table: str) -> int | None:
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    except sqlite3.Error:
        return None


def hashes_sqlite(conn: sqlite3.Connection, table: str, col: str) -> set[str]:
    try:
        rows = conn.execute(
            f"SELECT {col} FROM {table} WHERE {col} IS NOT NULL AND TRIM({col}) <> ''"
        ).fetchall()
        return {str(r[0]) for r in rows}
    except sqlite3.Error:
        return set()


def count_pg(pg, table: str) -> int | None:
    try:
        row = pg.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()
        return int(row["n"])
    except Exception:
        try:
            pg.rollback()
        except Exception:
            pass
        return None


def hashes_pg(pg, table: str, col: str) -> set[str]:
    try:
        rows = pg.execute(
            f"SELECT {col} AS h FROM {table} WHERE {col} IS NOT NULL AND btrim({col}::text) <> ''"
        ).fetchall()
        return {str(r["h"]) for r in rows}
    except Exception:
        try:
            pg.rollback()
        except Exception:
            pass
        return set()


def reconcile(sqlite_path: Path, source_label: str, note: str) -> tuple[dict, int]:
    if not is_postgres():
        print("需要 KOL_DATABASE_URL=postgresql://…", file=sys.stderr)
        return {}, 2
    if not sqlite_path.is_file():
        print(f"找不到 SQLite：{sqlite_path}", file=sys.stderr)
        return {}, 2

    sqlite_conn = sqlite3.connect(str(sqlite_path))
    gaps: list[dict] = []
    domains: list[dict] = []

    with connect() as pg:
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
        run = pg.execute(
            """
            INSERT INTO data_reconcile_runs (source_label, mode, ok, sqlite_path, notes, summary)
            VALUES (?,?,false,?,?,'{}'::jsonb) RETURNING id
            """,
            (source_label, "reconcile", str(sqlite_path), note or "reconcile"),
        ).fetchone()
        run_id = run["id"]
        pg.commit()

        for domain, sqlite_table, pg_table, hash_col in DOMAINS:
            sc = count_sqlite(sqlite_conn, sqlite_table)
            pc = count_pg(pg, pg_table)
            entry = {
                "domain": domain,
                "sqlite_table": sqlite_table,
                "pg_table": pg_table,
                "sqlite_count": sc,
                "pg_count": pc,
                "hash_col": hash_col,
                "missing_in_pg": [],
                "missing_in_sqlite": [],
            }
            if sc is None and pc is None:
                domains.append(entry)
                continue
            if sc is not None and pc is not None and sc != pc:
                gap = {
                    "domain": domain,
                    "gap_kind": "count_mismatch",
                    "sqlite_count": sc,
                    "pg_count": pc,
                    "detail": f"count sqlite={sc} pg={pc}",
                }
                gaps.append(gap)
                pg.execute(
                    """
                    INSERT INTO data_reconcile_gaps
                      (run_id, domain, gap_kind, sqlite_count, pg_count, detail)
                    VALUES (?,?,?,?,?,?)
                    """,
                    (run_id, domain, "count_mismatch", sc, pc, gap["detail"]),
                )

            if hash_col and sc is not None:
                sh = hashes_sqlite(sqlite_conn, sqlite_table, hash_col)
                ph = hashes_pg(pg, pg_table, hash_col)
                only_sqlite = sorted(sh - ph)
                only_pg = sorted(ph - sh)
                entry["missing_in_pg"] = only_sqlite[:50]
                entry["missing_in_sqlite"] = only_pg[:50]
                for h in only_sqlite:
                    gaps.append(
                        {
                            "domain": domain,
                            "gap_kind": "hash_missing_in_pg",
                            "content_hash": h,
                        }
                    )
                    pg.execute(
                        """
                        INSERT INTO data_reconcile_gaps
                          (run_id, domain, gap_kind, content_hash, sqlite_count, pg_count, detail)
                        VALUES (?,?,?,?,?,?,?)
                        """,
                        (run_id, domain, "hash_missing_in_pg", h, sc, pc, hash_col),
                    )
                for h in only_pg:
                    gaps.append(
                        {
                            "domain": domain,
                            "gap_kind": "hash_missing_in_sqlite",
                            "content_hash": h,
                        }
                    )
                    pg.execute(
                        """
                        INSERT INTO data_reconcile_gaps
                          (run_id, domain, gap_kind, content_hash, sqlite_count, pg_count, detail)
                        VALUES (?,?,?,?,?,?,?)
                        """,
                        (run_id, domain, "hash_missing_in_sqlite", h, sc, pc, hash_col),
                    )
            domains.append(entry)

        # legacy 暫存筆數（只報，不對 SQLite 表）
        legacy_n = count_pg(pg, "legacy_sqlite_rows")
        summary = {
            "started_at": utc_now(),
            "source_label": source_label,
            "sqlite": str(sqlite_path),
            "domains": domains,
            "gap_count": len(gaps),
            "legacy_sqlite_rows": legacy_n,
            "notes": note,
            "finished_at": utc_now(),
        }
        ok = len(gaps) == 0
        pg.execute(
            """
            UPDATE data_reconcile_runs
            SET finished_at=?, ok=?, summary=?::jsonb, notes=?
            WHERE id=?
            """,
            (utc_now(), ok, json.dumps(summary, ensure_ascii=False), note or ("ok" if ok else "gaps"), run_id),
        )
        pg.commit()

    sqlite_conn.close()
    return summary, (0 if not gaps else 1)


def main() -> int:
    ap = argparse.ArgumentParser(description="SQLite ↔ PostgreSQL 對帳")
    ap.add_argument("--sqlite", required=True)
    ap.add_argument("--source-db", default="control-buffer")
    ap.add_argument("--schedule-note", default="", help="例如 hourly / cron 標記")
    args = ap.parse_args()
    summary, code = reconcile(Path(args.sqlite).resolve(), args.source_db, args.schedule_note)
    if summary:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())

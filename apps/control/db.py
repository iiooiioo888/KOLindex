"""控制面資料庫。PostgreSQL 是真相；未設時才用 SQLite buffer。"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Sequence


def database_url() -> str:
    return (os.environ.get("KOL_DATABASE_URL") or "").strip()


def is_postgres() -> bool:
    return database_url().startswith("postgres")


def production_blocks_sqlite() -> None:
    if os.environ.get("KOL_PROD") == "1" and not is_postgres():
        raise SystemExit("正式環境的真相必須是 PostgreSQL")


def nas_root() -> Path:
    raw = os.environ.get("KOL_NAS_ROOT") or str(Path(__file__).resolve().parents[2] / "data" / "nas")
    root = Path(raw).resolve()
    (root / "inbox").mkdir(parents=True, exist_ok=True)
    (root / "buffer").mkdir(parents=True, exist_ok=True)
    return root


def sqlite_path() -> Path:
    url = database_url()
    if url.startswith("sqlite:///"):
        return Path(url[len("sqlite:///") :]).resolve()
    return nas_root() / "buffer" / "control.sqlite"


def qmark_to_percent(sql: str) -> str:
    """把 sqlite 風格 ? 佔位改成 psycopg %s。不處理字串字面裡的 ?。"""
    out: list[str] = []
    i = 0
    in_single = False
    while i < len(sql):
        ch = sql[i]
        if ch == "'":
            out.append(ch)
            if in_single and i + 1 < len(sql) and sql[i + 1] == "'":
                out.append("'")
                i += 2
                continue
            in_single = not in_single
            i += 1
            continue
        if ch == "?" and not in_single:
            out.append("%s")
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


class Row(dict):
    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class Cursor:
    def __init__(self, backend: str, raw: Any):
        self.backend = backend
        self.raw = raw
        self.lastrowid: int | None = None
        self._rows: list[Row] | None = None

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> "Cursor":
        params = tuple(params or ())
        if self.backend == "postgres":
            adapted = qmark_to_percent(sql)
            self.raw.execute(adapted, params)
            self.lastrowid = None
            if " RETURNING " in adapted.upper():
                rows = self._materialize_pg()
                if rows and "seq" in rows[0]:
                    self.lastrowid = int(rows[0]["seq"])
                self._rows = rows
            else:
                self._rows = None
            return self
        # SQLite：拿掉 RETURNING，改用 lastrowid（舊版 SQLite 無 RETURNING）
        sqlite_sql = sql
        upper = sql.upper()
        if " RETURNING " in upper:
            sqlite_sql = sql[: upper.index(" RETURNING ")].rstrip()
        self.raw.execute(sqlite_sql, params)
        self.lastrowid = self.raw.lastrowid
        self._rows = None
        return self

    def _materialize_pg(self) -> list[Row]:
        desc = self.raw.description or []
        names = [d[0] for d in desc]
        return [Row(zip(names, row)) for row in self.raw.fetchall()]

    def executemany(self, sql: str, seq_of_params: Iterable[Sequence[Any]]) -> "Cursor":
        if self.backend == "postgres":
            self.raw.executemany(qmark_to_percent(sql), list(seq_of_params))
        else:
            self.raw.executemany(sql, list(seq_of_params))
        self._rows = None
        return self

    def _materialize(self) -> list[Row]:
        if self._rows is not None:
            return self._rows
        if self.backend == "postgres":
            self._rows = self._materialize_pg()
        else:
            fetched = self.raw.fetchall()
            self._rows = [Row(dict(r)) for r in fetched]
        return self._rows

    def fetchone(self) -> Row | None:
        rows = self._materialize()
        return rows[0] if rows else None

    def fetchall(self) -> list[Row]:
        return self._materialize()


class Connection:
    def __init__(self, backend: str, raw: Any):
        self.backend = backend
        self.raw = raw

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> Cursor:
        if self.backend == "postgres":
            cur = self.raw.cursor()
            wrapper = Cursor(self.backend, cur)
            wrapper.execute(sql, params)
            return wrapper
        upper = sql.upper()
        sqlite_sql = sql
        if " RETURNING " in upper:
            sqlite_sql = sql[: upper.index(" RETURNING ")].rstrip()
        cur = self.raw.execute(sqlite_sql, tuple(params or ()))
        wrapper = Cursor(self.backend, cur)
        wrapper.lastrowid = cur.lastrowid
        return wrapper

    def executemany(self, sql: str, seq_of_params: Iterable[Sequence[Any]]) -> Cursor:
        if self.backend == "postgres":
            cur = self.raw.cursor()
            wrapper = Cursor(self.backend, cur)
            wrapper.executemany(sql, seq_of_params)
            return wrapper
        cur = self.raw.executemany(sql, list(seq_of_params))
        return Cursor(self.backend, cur)

    def executescript(self, script: str) -> None:
        if self.backend != "sqlite":
            raise RuntimeError("executescript 只用於 sqlite buffer")
        self.raw.executescript(script)

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def close(self) -> None:
        self.raw.close()

    def __enter__(self) -> "Connection":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type:
            try:
                self.rollback()
            except Exception:
                pass
        self.close()


def connect() -> Connection:
    if is_postgres():
        try:
            import psycopg
        except ImportError as exc:  # pragma: no cover
            raise SystemExit("PostgreSQL 需要 psycopg：pip install 'psycopg[binary]==3.2.4'") from exc
        raw = psycopg.connect(database_url())
        return Connection("postgres", raw)
    path = sqlite_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(path)
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys=ON")
    return Connection("sqlite", raw)


def truth_label() -> str:
    return "postgres" if is_postgres() else "sqlite-buffer"

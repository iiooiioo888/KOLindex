"""控制面。四個寫入端點只追加。SQLite 只在未設 PostgreSQL 時當 intake buffer。"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import sys

from db import (  # noqa: E402
    connect,
    is_postgres,
    nas_root,
    production_blocks_sqlite,
    truth_label,
)

POLICY_DIR = Path(__file__).resolve().parents[2] / "packages" / "policy"
sys.path.insert(0, str(POLICY_DIR))
from evaluate import classify_media_similarity, classify_source, evaluate, load_policy  # noqa: E402

POLICY = load_policy(POLICY_DIR / "policy.yaml")
STATES = set(POLICY["task_states"])


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db(conn) -> None:
    if getattr(conn, "backend", "sqlite") == "postgres":
        return
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS intake (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at TEXT NOT NULL,
          source_id TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          content_hash TEXT NOT NULL UNIQUE,
          storage_path TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artifact (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at TEXT NOT NULL,
          source_id TEXT NOT NULL,
          original_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          tool_version TEXT NOT NULL,
          params TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS change_event (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at TEXT NOT NULL,
          source_id TEXT NOT NULL,
          before_ref TEXT,
          after_ref TEXT,
          diff_fields TEXT NOT NULL,
          state TEXT NOT NULL,
          policy_version TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS decision (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at TEXT NOT NULL,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT NOT NULL,
          reviewer TEXT NOT NULL,
          decided_at TEXT NOT NULL
        );
        CREATE TRIGGER IF NOT EXISTS intake_no_update BEFORE UPDATE ON intake BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS intake_no_delete BEFORE DELETE ON intake BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS artifact_no_update BEFORE UPDATE ON artifact BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS artifact_no_delete BEFORE DELETE ON artifact BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS change_event_no_update BEFORE UPDATE ON change_event BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS change_event_no_delete BEFORE DELETE ON change_event BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS decision_no_update BEFORE UPDATE ON decision BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS decision_no_delete BEFORE DELETE ON decision BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TABLE IF NOT EXISTS subjects (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS platform_accounts (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          external_account_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          profile_url TEXT NOT NULL DEFAULT '',
          UNIQUE(platform, external_account_id)
        );
        CREATE TABLE IF NOT EXISTS subject_account_links (
          subject_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          link_status TEXT NOT NULL,
          linked_at TEXT NOT NULL,
          linked_by TEXT NOT NULL,
          PRIMARY KEY (subject_id, account_id),
          FOREIGN KEY (subject_id) REFERENCES subjects(id),
          FOREIGN KEY (account_id) REFERENCES platform_accounts(id)
        );
        CREATE TABLE IF NOT EXISTS indexed_posts (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          subject_id TEXT,
          platform TEXT NOT NULL,
          external_post_id TEXT NOT NULL,
          published_at TEXT,
          title TEXT NOT NULL DEFAULT '',
          caption TEXT NOT NULL DEFAULT '',
          source_url TEXT NOT NULL DEFAULT '',
          content_hash TEXT,
          captured_at TEXT NOT NULL,
          UNIQUE(platform, external_post_id),
          FOREIGN KEY (account_id) REFERENCES platform_accounts(id),
          FOREIGN KEY (subject_id) REFERENCES subjects(id)
        );
        CREATE TABLE IF NOT EXISTS media_index (
          id TEXT PRIMARY KEY,
          subject_id TEXT,
          account_id TEXT,
          post_id TEXT,
          media_kind TEXT NOT NULL,
          checksum TEXT NOT NULL UNIQUE,
          storage_path TEXT NOT NULL,
          source_url TEXT NOT NULL DEFAULT '',
          bytes INTEGER,
          width INTEGER,
          height INTEGER,
          captured_at TEXT NOT NULL,
          time_source TEXT NOT NULL,
          time_status TEXT NOT NULL,
          FOREIGN KEY (subject_id) REFERENCES subjects(id),
          FOREIGN KEY (account_id) REFERENCES platform_accounts(id),
          FOREIGN KEY (post_id) REFERENCES indexed_posts(id)
        );
        CREATE TABLE IF NOT EXISTS media_similarity_links (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL DEFAULT 'control',
          left_media_id TEXT NOT NULL,
          right_media_id TEXT NOT NULL,
          score REAL NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          tool_version TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          reason TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          UNIQUE(left_media_id, right_media_id, tool_name, tool_version),
          FOREIGN KEY (left_media_id) REFERENCES media_index(id),
          FOREIGN KEY (right_media_id) REFERENCES media_index(id)
        );
        CREATE TRIGGER IF NOT EXISTS media_similarity_no_update
          BEFORE UPDATE ON media_similarity_links BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS media_similarity_no_delete
          BEFORE DELETE ON media_similarity_links BEGIN SELECT RAISE(ABORT, 'append-only'); END;
        """
    )
    conn.commit()


def role_of(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="login_required")
    token = authorization[len("Bearer ") :]
    pairs = (
        ("viewer", os.environ.get("KOL_TOKEN_VIEWER", "")),
        ("reviewer", os.environ.get("KOL_TOKEN_REVIEWER", "")),
        ("operator", os.environ.get("KOL_TOKEN_OPERATOR", "")),
    )
    for role, expected in pairs:
        if expected and hmac.compare_digest(token, expected):
            return role
    raise HTTPException(status_code=401, detail="login_required")


def require(role: str, allowed: set[str]) -> None:
    if role not in allowed:
        raise HTTPException(status_code=403, detail="forbidden")


def inside_inbox(path: Path) -> Path:
    inbox = (nas_root() / "inbox").resolve()
    target = path.resolve()
    if inbox not in target.parents and target != inbox:
        raise HTTPException(status_code=400, detail="path")
    return target


class IntakeIn(BaseModel):
    source_id: str = Field(min_length=1, max_length=80)
    captured_at: str
    content_hash: str = Field(min_length=64, max_length=64)
    storage_path: str


class ArtifactIn(BaseModel):
    source_id: str
    original_id: int
    kind: str
    tool_name: str
    tool_version: str
    params: dict = Field(default_factory=dict)


class EventIn(BaseModel):
    source_id: str
    before_ref: str | None = None
    after_ref: str | None = None
    diff_fields: list[str] = Field(default_factory=list)
    state: str
    failures: int = 0


class DecisionIn(BaseModel):
    source_id: str
    target_id: str
    action: str
    reason: str = Field(min_length=1)
    reviewer: str
    decided_at: str


_ALLOWED_PLATFORMS = {"bilibili", "douyin", "xiaohongshu", "tiktok", "weibo", "youtube", "other"}
_LINK_STATUS = {"candidate", "confirmed", "rejected"}


class SubjectIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=400)


class AccountLinkIn(BaseModel):
    platform: str
    external_account_id: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=120)
    profile_url: str = Field(default="", max_length=500)
    link_status: str = "candidate"
    linked_by: str = Field(default="operator", max_length=80)


class PostIndexIn(BaseModel):
    platform: str
    external_account_id: str = Field(min_length=1, max_length=120)
    external_post_id: str = Field(min_length=1, max_length=160)
    subject_id: str | None = None
    published_at: str | None = None
    title: str = Field(default="", max_length=300)
    caption: str = Field(default="", max_length=4000)
    source_url: str = Field(default="", max_length=800)
    content_hash: str | None = Field(default=None, max_length=64)


class MediaIndexIn(BaseModel):
    checksum: str = Field(min_length=64, max_length=64)
    storage_path: str = Field(min_length=1, max_length=500)
    media_kind: str = "image"
    subject_id: str | None = None
    platform: str | None = None
    external_account_id: str | None = None
    post_id: str | None = None
    source_url: str = Field(default="", max_length=800)
    bytes: int | None = None
    width: int | None = None
    height: int | None = None
    time_source: str = "public_post"
    time_status: str = "fact"


class MediaSimilarityIn(BaseModel):
    left_media_id: str = Field(min_length=1, max_length=80)
    right_media_id: str = Field(min_length=1, max_length=80)
    score: float = Field(ge=0, le=1)
    tool_name: str = Field(min_length=1, max_length=80)
    tool_version: str = Field(min_length=1, max_length=40)


_MEDIA_KINDS = {"image", "video", "gallery", "avatar", "other"}


def new_id(prefix: str) -> str:
    return f"{prefix}_{hashlib.sha256(f'{prefix}:{now()}:{os.urandom(8).hex()}'.encode()).hexdigest()[:16]}"


def subject_row(conn: sqlite3.Connection, subject_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM subjects WHERE id=?", (subject_id,)).fetchone()
    if not row:
        return None
    links = conn.execute(
        """
        SELECT a.platform, a.external_account_id, a.display_name, a.profile_url,
               l.link_status, l.linked_at, l.linked_by
        FROM subject_account_links l
        JOIN platform_accounts a ON a.id = l.account_id
        WHERE l.subject_id=?
        ORDER BY l.linked_at DESC
        """,
        (subject_id,),
    ).fetchall()
    accounts = [dict(item) for item in links]
    confirmed = sum(1 for item in accounts if item["link_status"] == "confirmed")
    posts = conn.execute(
        "SELECT COUNT(*) AS n FROM indexed_posts WHERE subject_id=?",
        (subject_id,),
    ).fetchone()["n"]
    media = conn.execute(
        "SELECT COUNT(*) AS n FROM media_index WHERE subject_id=?",
        (subject_id,),
    ).fetchone()["n"]
    pending = conn.execute(
        """
        SELECT COUNT(*) AS n FROM media_similarity_links l
        JOIN media_index a ON a.id = l.left_media_id
        JOIN media_index b ON b.id = l.right_media_id
        WHERE l.status='waiting_review'
          AND (a.subject_id=? OR b.subject_id=?)
        """,
        (subject_id, subject_id),
    ).fetchone()["n"]
    return {
        "id": row["id"],
        "display_name": row["display_name"],
        "note": row["note"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "accounts": accounts,
        "coverage": {
            "confirmed_accounts": confirmed,
            "candidate_accounts": len(accounts) - confirmed,
            "indexed_posts": int(posts),
            "media_assets": int(media),
            "similarity_pending": int(pending),
            "claimed_posts": None,
            "gap": None,
        },
        "source": "control.subjects",
    }


def create_app() -> FastAPI:
    app = FastAPI()
    started = datetime.now(timezone.utc)

    @app.middleware("http")
    async def time_request(request, call_next):
        import time

        t0 = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Duration-Ms"] = str(int((time.perf_counter() - t0) * 1000))
        return response

    @app.on_event("startup")
    def startup() -> None:
        production_blocks_sqlite()
        if is_postgres():
            # 結構由 infra/compose/postgres/init 負責；這裡只確認可連。
            with connect() as conn:
                conn.execute("SELECT 1")
            return
        with connect() as conn:
            init_db(conn)

    @app.get("/__health/components")
    def health(authorization: str | None = Header(default=None)):
        import time

        role_of(authorization)
        t0 = time.perf_counter()
        truth = truth_label()
        duration = int((time.perf_counter() - t0) * 1000)
        return {
            "ok": True,
            "duration_ms": duration,
            "items": [
                {"id": "truth", "name": "資料真相", "state": "up", "role": truth},
                {"id": "policy", "name": "政策", "state": "up", "role": POLICY["version"]},
            ],
            "started_at": started.isoformat(),
            "truth": truth,
            "read_path": "postgres" if is_postgres() else "sqlite-buffer",
        }

    @app.post("/intake")
    def intake(body: IntakeIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        target = inside_inbox(Path(body.storage_path))
        if not target.is_file():
            raise HTTPException(status_code=400, detail="missing_file")
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != body.content_hash:
            raise HTTPException(status_code=400, detail="hash")
        with connect() as conn:
            init_db(conn)
            found = conn.execute("SELECT seq, recorded_at FROM intake WHERE content_hash=?", (body.content_hash,)).fetchone()
            if found:
                return {"seq": found["seq"], "deduped": True, "recorded_at": found["recorded_at"]}
            cur = conn.execute(
                "INSERT INTO intake (recorded_at, source_id, captured_at, content_hash, storage_path) VALUES (?,?,?,?,?) RETURNING seq",
                (now(), body.source_id, body.captured_at, body.content_hash, str(target)),
            )
            conn.commit()
            seq = cur.lastrowid if cur.lastrowid is not None else (cur.fetchone() or {}).get("seq")
            return {"seq": seq, "deduped": False, "recorded_at": now()}

    @app.post("/artifacts")
    def artifacts(body: ArtifactIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        if body.kind not in {"thumb", "keyframe", "ocr", "vision"}:
            raise HTTPException(status_code=400, detail="kind")
        with connect() as conn:
            init_db(conn)
            params_val = body.params if is_postgres() else json.dumps(body.params, ensure_ascii=False)
            cur = conn.execute(
                "INSERT INTO artifact (recorded_at, source_id, original_id, kind, tool_name, tool_version, params) VALUES (?,?,?,?,?,?,?) RETURNING seq",
                (now(), body.source_id, body.original_id, body.kind, body.tool_name, body.tool_version, params_val),
            )
            conn.commit()
            seq = cur.lastrowid if cur.lastrowid is not None else (cur.fetchone() or {}).get("seq")
            return {"seq": seq}

    @app.post("/events")
    def events(body: EventIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        decision = evaluate(POLICY, {"state": body.state, "failures": body.failures})
        state = decision["state"] if decision["action"] == "stop" else body.state
        if state not in STATES:
            raise HTTPException(status_code=400, detail="state")
        with connect() as conn:
            init_db(conn)
            diff_val = body.diff_fields if is_postgres() else json.dumps(body.diff_fields)
            cur = conn.execute(
                "INSERT INTO change_event (recorded_at, source_id, before_ref, after_ref, diff_fields, state, policy_version) VALUES (?,?,?,?,?,?,?) RETURNING seq",
                (now(), body.source_id, body.before_ref, body.after_ref, diff_val, state, POLICY["version"]),
            )
            conn.commit()
            seq = cur.lastrowid if cur.lastrowid is not None else (cur.fetchone() or {}).get("seq")
            return {"seq": seq, "state": state, "policy_version": POLICY["version"], "action": decision["action"]}

    @app.post("/decisions")
    def decisions(body: DecisionIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"reviewer", "operator"})
        if body.action not in {"confirm", "reject", "defer"}:
            raise HTTPException(status_code=400, detail="action")
        with connect() as conn:
            init_db(conn)
            cur = conn.execute(
                "INSERT INTO decision (recorded_at, source_id, target_id, action, reason, reviewer, decided_at) VALUES (?,?,?,?,?,?,?) RETURNING seq",
                (now(), body.source_id, body.target_id, body.action, body.reason, body.reviewer, body.decided_at),
            )
            conn.commit()
            seq = cur.lastrowid if cur.lastrowid is not None else (cur.fetchone() or {}).get("seq")
            return {"seq": seq}

    @app.get("/subjects")
    def list_subjects(authorization: str | None = Header(default=None), q: str = ""):
        role_of(authorization)
        needle = q.strip().lower()
        with connect() as conn:
            init_db(conn)
            rows = conn.execute("SELECT id FROM subjects ORDER BY updated_at DESC").fetchall()
            items = []
            for row in rows:
                item = subject_row(conn, row["id"])
                if not item:
                    continue
                if needle and needle not in item["display_name"].lower() and needle not in item["id"].lower():
                    continue
                items.append(item)
            return {"ok": True, "total": len(items), "items": items, "source": "control.subjects"}

    @app.post("/subjects")
    def create_subject(body: SubjectIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        name = body.display_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="name")
        sid = new_id("sub")
        stamp = now()
        with connect() as conn:
            init_db(conn)
            conn.execute(
                "INSERT INTO subjects (id, display_name, created_at, updated_at, note) VALUES (?,?,?,?,?)",
                (sid, name, stamp, stamp, body.note.strip()),
            )
            conn.commit()
            return subject_row(conn, sid)

    @app.get("/subjects/{subject_id}")
    def get_subject(subject_id: str, authorization: str | None = Header(default=None)):
        role_of(authorization)
        with connect() as conn:
            init_db(conn)
            item = subject_row(conn, subject_id)
            if not item:
                raise HTTPException(status_code=404, detail="not_found")
            return item

    @app.post("/subjects/{subject_id}/accounts")
    def link_account(subject_id: str, body: AccountLinkIn, authorization: str | None = Header(default=None)):
        role = role_of(authorization)
        require(role, {"reviewer", "operator"})
        platform = body.platform.strip().lower()
        if platform not in _ALLOWED_PLATFORMS:
            raise HTTPException(status_code=400, detail="platform")
        status = body.link_status.strip().lower()
        if status not in _LINK_STATUS:
            raise HTTPException(status_code=400, detail="link_status")
        if status == "confirmed" and role not in {"reviewer", "operator"}:
            raise HTTPException(status_code=403, detail="forbidden")
        external_id = body.external_account_id.strip()
        display = body.display_name.strip()
        if not external_id or not display:
            raise HTTPException(status_code=400, detail="account")
        stamp = now()
        with connect() as conn:
            init_db(conn)
            subject = conn.execute("SELECT id FROM subjects WHERE id=?", (subject_id,)).fetchone()
            if not subject:
                raise HTTPException(status_code=404, detail="not_found")
            existing = conn.execute(
                "SELECT id FROM platform_accounts WHERE platform=? AND external_account_id=?",
                (platform, external_id),
            ).fetchone()
            if existing:
                account_id = existing["id"]
                conn.execute(
                    "UPDATE platform_accounts SET display_name=?, profile_url=? WHERE id=?",
                    (display, body.profile_url.strip(), account_id),
                )
            else:
                account_id = new_id("acc")
                conn.execute(
                    "INSERT INTO platform_accounts (id, platform, external_account_id, display_name, profile_url) VALUES (?,?,?,?,?)",
                    (account_id, platform, external_id, display, body.profile_url.strip()),
                )
            conn.execute(
                """
                INSERT INTO subject_account_links (subject_id, account_id, link_status, linked_at, linked_by)
                VALUES (?,?,?,?,?)
                ON CONFLICT(subject_id, account_id) DO UPDATE SET
                  link_status=excluded.link_status,
                  linked_at=excluded.linked_at,
                  linked_by=excluded.linked_by
                """,
                (subject_id, account_id, status, stamp, body.linked_by.strip() or role),
            )
            conn.execute("UPDATE subjects SET updated_at=? WHERE id=?", (stamp, subject_id))
            conn.commit()
            return subject_row(conn, subject_id)

    @app.post("/posts")
    def index_post(body: PostIndexIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        platform = body.platform.strip().lower()
        if platform not in _ALLOWED_PLATFORMS:
            raise HTTPException(status_code=400, detail="platform")
        stamp = now()
        with connect() as conn:
            init_db(conn)
            account = conn.execute(
                "SELECT id FROM platform_accounts WHERE platform=? AND external_account_id=?",
                (platform, body.external_account_id.strip()),
            ).fetchone()
            if not account:
                raise HTTPException(status_code=404, detail="account_not_found")
            subject_id = body.subject_id
            if subject_id:
                if not conn.execute("SELECT id FROM subjects WHERE id=?", (subject_id,)).fetchone():
                    raise HTTPException(status_code=404, detail="subject_not_found")
            else:
                linked = conn.execute(
                    """
                    SELECT subject_id FROM subject_account_links
                    WHERE account_id=? AND link_status='confirmed'
                    ORDER BY linked_at DESC LIMIT 1
                    """,
                    (account["id"],),
                ).fetchone()
                subject_id = linked["subject_id"] if linked else None
            existing = conn.execute(
                "SELECT id FROM indexed_posts WHERE platform=? AND external_post_id=?",
                (platform, body.external_post_id.strip()),
            ).fetchone()
            if existing:
                return {
                    "ok": True,
                    "deduped": True,
                    "id": existing["id"],
                    "subject_id": subject_id,
                    "source": "control.indexed_posts",
                }
            post_id = new_id("post")
            conn.execute(
                """
                INSERT INTO indexed_posts (
                  id, account_id, subject_id, platform, external_post_id, published_at,
                  title, caption, source_url, content_hash, captured_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    post_id,
                    account["id"],
                    subject_id,
                    platform,
                    body.external_post_id.strip(),
                    body.published_at,
                    body.title.strip(),
                    body.caption.strip(),
                    body.source_url.strip(),
                    body.content_hash,
                    stamp,
                ),
            )
            if subject_id:
                conn.execute("UPDATE subjects SET updated_at=? WHERE id=?", (stamp, subject_id))
            conn.commit()
            return {
                "ok": True,
                "deduped": False,
                "id": post_id,
                "subject_id": subject_id,
                "source": "control.indexed_posts",
            }

    @app.post("/media-index")
    def index_media(body: MediaIndexIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        kind = body.media_kind.strip().lower()
        if kind not in _MEDIA_KINDS:
            raise HTTPException(status_code=400, detail="media_kind")
        if body.time_source not in {"public_post", "file_time"}:
            raise HTTPException(status_code=400, detail="time_source")
        if body.time_status not in {"fact", "candidate"}:
            raise HTTPException(status_code=400, detail="time_status")
        if body.time_source == "public_post" and body.time_status != "fact":
            raise HTTPException(status_code=400, detail="time_rule")
        if body.time_source == "file_time" and body.time_status != "candidate":
            raise HTTPException(status_code=400, detail="time_rule")
        path = Path(body.storage_path)
        if path.is_absolute():
            root = nas_root()
            try:
                path.resolve().relative_to(root)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="path") from exc
        stamp = now()
        with connect() as conn:
            init_db(conn)
            existing = conn.execute(
                "SELECT id, subject_id FROM media_index WHERE checksum=?",
                (body.checksum.lower(),),
            ).fetchone()
            if existing:
                return {
                    "ok": True,
                    "deduped": True,
                    "id": existing["id"],
                    "subject_id": existing["subject_id"],
                    "source": "control.media_index",
                }
            account_id = None
            if body.platform and body.external_account_id:
                platform = body.platform.strip().lower()
                if platform not in _ALLOWED_PLATFORMS:
                    raise HTTPException(status_code=400, detail="platform")
                account = conn.execute(
                    "SELECT id FROM platform_accounts WHERE platform=? AND external_account_id=?",
                    (platform, body.external_account_id.strip()),
                ).fetchone()
                if not account:
                    raise HTTPException(status_code=404, detail="account_not_found")
                account_id = account["id"]
            subject_id = body.subject_id
            if subject_id and not conn.execute("SELECT id FROM subjects WHERE id=?", (subject_id,)).fetchone():
                raise HTTPException(status_code=404, detail="subject_not_found")
            if body.post_id and not conn.execute("SELECT id FROM indexed_posts WHERE id=?", (body.post_id,)).fetchone():
                raise HTTPException(status_code=404, detail="post_not_found")
            media_id = new_id("media")
            conn.execute(
                """
                INSERT INTO media_index (
                  id, subject_id, account_id, post_id, media_kind, checksum, storage_path,
                  source_url, bytes, width, height, captured_at, time_source, time_status
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    media_id,
                    subject_id,
                    account_id,
                    body.post_id,
                    kind,
                    body.checksum.lower(),
                    body.storage_path.strip(),
                    body.source_url.strip(),
                    body.bytes,
                    body.width,
                    body.height,
                    stamp,
                    body.time_source,
                    body.time_status,
                ),
            )
            if subject_id:
                conn.execute("UPDATE subjects SET updated_at=? WHERE id=?", (stamp, subject_id))
            conn.commit()
            return {
                "ok": True,
                "deduped": False,
                "id": media_id,
                "subject_id": subject_id,
                "source": "control.media_index",
            }

    @app.get("/subjects/{subject_id}/media")
    def list_subject_media(subject_id: str, authorization: str | None = Header(default=None)):
        role_of(authorization)
        with connect() as conn:
            init_db(conn)
            if not conn.execute("SELECT id FROM subjects WHERE id=?", (subject_id,)).fetchone():
                raise HTTPException(status_code=404, detail="not_found")
            posts = conn.execute(
                """
                SELECT id, platform, external_post_id, title, published_at, source_url, captured_at
                FROM indexed_posts WHERE subject_id=?
                ORDER BY captured_at DESC LIMIT 100
                """,
                (subject_id,),
            ).fetchall()
            media = conn.execute(
                """
                SELECT id, media_kind, checksum, storage_path, source_url, bytes, width, height,
                       post_id, captured_at, time_source, time_status
                FROM media_index WHERE subject_id=?
                ORDER BY captured_at DESC LIMIT 200
                """,
                (subject_id,),
            ).fetchall()
            links = conn.execute(
                """
                SELECT l.id, l.left_media_id, l.right_media_id, l.score, l.kind, l.status,
                       l.tool_name, l.tool_version, l.policy_version, l.reason, l.recorded_at,
                       a.subject_id AS left_subject_id, b.subject_id AS right_subject_id,
                       a.checksum AS left_checksum, b.checksum AS right_checksum
                FROM media_similarity_links l
                JOIN media_index a ON a.id = l.left_media_id
                JOIN media_index b ON b.id = l.right_media_id
                WHERE a.subject_id=? OR b.subject_id=?
                ORDER BY l.recorded_at DESC LIMIT 100
                """,
                (subject_id, subject_id),
            ).fetchall()
            return {
                "ok": True,
                "subject_id": subject_id,
                "posts": [dict(row) for row in posts],
                "media": [dict(row) for row in media],
                "similarity_links": [dict(row) for row in links],
                "source": "control.media_index",
            }

    @app.post("/media-similarity")
    def report_media_similarity(body: MediaSimilarityIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        left_id, right_id = body.left_media_id, body.right_media_id
        if left_id == right_id:
            raise HTTPException(status_code=400, detail="same_media")
        if left_id > right_id:
            left_id, right_id = right_id, left_id
        with connect() as conn:
            init_db(conn)
            left = conn.execute("SELECT * FROM media_index WHERE id=?", (left_id,)).fetchone()
            right = conn.execute("SELECT * FROM media_index WHERE id=?", (right_id,)).fetchone()
            if not left or not right:
                raise HTTPException(status_code=404, detail="media_not_found")
            decision = classify_media_similarity(
                POLICY,
                score=float(body.score),
                left_subject_id=left["subject_id"],
                right_subject_id=right["subject_id"],
                left_account_id=left["account_id"],
                right_account_id=right["account_id"],
            )
            if decision["action"] == "skip":
                return {
                    "ok": True,
                    "created": False,
                    "decision": decision,
                    "source": "control.media_similarity",
                }
            if decision["action"] != "candidate" or decision.get("auto_confirm"):
                raise HTTPException(status_code=400, detail="policy_rejected")
            existing = conn.execute(
                """
                SELECT id, kind, status FROM media_similarity_links
                WHERE left_media_id=? AND right_media_id=? AND tool_name=? AND tool_version=?
                """,
                (left_id, right_id, body.tool_name.strip(), body.tool_version.strip()),
            ).fetchone()
            if existing:
                return {
                    "ok": True,
                    "created": False,
                    "deduped": True,
                    "id": existing["id"],
                    "kind": existing["kind"],
                    "status": existing["status"],
                    "decision": decision,
                    "source": "control.media_similarity",
                }
            link_id = new_id("msim")
            stamp = now()
            conn.execute(
                """
                INSERT INTO media_similarity_links (
                  id, source_id, left_media_id, right_media_id, score, kind, status,
                  tool_name, tool_version, policy_version, reason, recorded_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    link_id,
                    "control",
                    left_id,
                    right_id,
                    float(body.score),
                    decision["kind"],
                    decision["status"],
                    body.tool_name.strip(),
                    body.tool_version.strip(),
                    decision["policy_version"],
                    decision["reason"],
                    stamp,
                ),
            )
            conn.commit()
            return {
                "ok": True,
                "created": True,
                "id": link_id,
                "kind": decision["kind"],
                "status": decision["status"],
                "decision": decision,
                "note": "只建待審候選。copy_suspect 不合併人物；near_duplicate 也不自動確認。",
                "source": "control.media_similarity",
            }

    @app.get("/media-similarity")
    def list_media_similarity(
        authorization: str | None = Header(default=None),
        status: str = "waiting_review",
        kind: str = "",
    ):
        role_of(authorization)
        with connect() as conn:
            init_db(conn)
            clauses = []
            args: list = []
            if status:
                clauses.append("l.status=?")
                args.append(status)
            if kind:
                clauses.append("l.kind=?")
                args.append(kind)
            where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
            rows = conn.execute(
                f"""
                SELECT l.id, l.left_media_id, l.right_media_id, l.score, l.kind, l.status,
                       l.tool_name, l.tool_version, l.policy_version, l.reason, l.recorded_at,
                       a.subject_id AS left_subject_id, b.subject_id AS right_subject_id
                FROM media_similarity_links l
                JOIN media_index a ON a.id = l.left_media_id
                JOIN media_index b ON b.id = l.right_media_id
                {where}
                ORDER BY l.recorded_at DESC LIMIT 200
                """,
                args,
            ).fetchall()
            return {
                "ok": True,
                "total": len(rows),
                "items": [dict(row) for row in rows],
                "source": "control.media_similarity",
            }

    @app.get("/intelligence/inbox")
    def intelligence_inbox(authorization: str | None = Header(default=None)):
        """聚合待審訊號。只列候選，不自動合併、不觸發採集。"""
        role_of(authorization)
        with connect() as conn:
            init_db(conn)
            items: list[dict] = []
            links = conn.execute(
                """
                SELECT l.id, l.score, l.kind, l.status, l.reason, l.recorded_at,
                       a.subject_id AS left_subject_id, b.subject_id AS right_subject_id,
                       ls.display_name AS left_name, rs.display_name AS right_name
                FROM media_similarity_links l
                JOIN media_index a ON a.id = l.left_media_id
                JOIN media_index b ON b.id = l.right_media_id
                LEFT JOIN subjects ls ON ls.id = a.subject_id
                LEFT JOIN subjects rs ON rs.id = b.subject_id
                WHERE l.status='waiting_review'
                ORDER BY l.score DESC, l.recorded_at DESC
                LIMIT 50
                """
            ).fetchall()
            for row in links:
                priority = 90 if row["kind"] == "copy_suspect" else 70
                items.append(
                    {
                        "id": f"sim:{row['id']}",
                        "kind": row["kind"],
                        "priority": priority,
                        "title": (
                            "抄襲／搬運嫌疑"
                            if row["kind"] == "copy_suspect"
                            else "近似重複待審"
                        ),
                        "detail": row["reason"] or "",
                        "score": row["score"],
                        "subject_ids": [
                            x for x in (row["left_subject_id"], row["right_subject_id"]) if x
                        ],
                        "subject_names": [
                            x for x in (row["left_name"], row["right_name"]) if x
                        ],
                        "recorded_at": row["recorded_at"],
                        "action": "review_similarity",
                    }
                )
            thin = conn.execute(
                """
                SELECT s.id, s.display_name, s.updated_at,
                       COALESCE(SUM(CASE WHEN l.link_status='confirmed' THEN 1 ELSE 0 END), 0) AS confirmed,
                       COALESCE(COUNT(l.account_id), 0) AS linked,
                       (SELECT COUNT(*) FROM indexed_posts p WHERE p.subject_id=s.id) AS posts,
                       (SELECT COUNT(*) FROM media_index m WHERE m.subject_id=s.id) AS media
                FROM subjects s
                LEFT JOIN subject_account_links l ON l.subject_id = s.id
                GROUP BY s.id
                HAVING confirmed = 0
                ORDER BY s.updated_at DESC
                LIMIT 30
                """
            ).fetchall()
            for row in thin:
                gap = "no_account" if int(row["linked"] or 0) == 0 else "no_confirmed"
                items.append(
                    {
                        "id": f"cov:{row['id']}",
                        "kind": "coverage_gap",
                        "priority": 55 if gap == "no_account" else 45,
                        "title": "覆蓋缺口：尚無已確認帳號",
                        "detail": (
                            f"linked={row['linked']} posts={row['posts']} media={row['media']}"
                        ),
                        "score": None,
                        "subject_ids": [row["id"]],
                        "subject_names": [row["display_name"]],
                        "recorded_at": row["updated_at"],
                        "action": "discover_accounts",
                        "gap": gap,
                    }
                )
            items.sort(
                key=lambda item: (
                    -int(item["priority"]),
                    -(float(item["score"]) if item.get("score") is not None else 0.0),
                    str(item.get("recorded_at") or ""),
                )
            )
            return {
                "ok": True,
                "total": len(items),
                "items": items,
                "limits": {
                    "auto_confirm": False,
                    "llm_can_act": False,
                    "crawl_on_candidate": False,
                },
                "note": "候選匣只排序與提示。確認、合併、採集都要人工或已批准流程。",
                "source": "control.intelligence",
            }

    @app.get("/truth/status")
    def truth_status(authorization: str | None = Header(default=None)):
        """單一真相狀態。前端與對帳腳本都讀這裡，不再猜 SQLite／PG。"""
        role_of(authorization)
        truth = truth_label()
        counts: dict[str, int | None] = {}
        with connect() as conn:
            init_db(conn)
            for table in (
                "intake",
                "artifact",
                "change_event",
                "decision",
                "subjects",
                "platform_accounts",
                "indexed_posts",
                "media_index",
                "media_similarity_links",
            ):
                try:
                    row = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()
                    counts[table] = int(row["n"]) if row else 0
                except Exception:
                    counts[table] = None
            legacy = None
            reconcile_ok = None
            if is_postgres():
                try:
                    legacy = int(conn.execute("SELECT COUNT(*) AS n FROM legacy_sqlite_rows").fetchone()["n"])
                except Exception:
                    legacy = None
                try:
                    last = conn.execute(
                        """
                        SELECT id, ok, finished_at FROM data_reconcile_runs
                        WHERE mode='reconcile'
                        ORDER BY id DESC LIMIT 1
                        """
                    ).fetchone()
                    if last:
                        gap_n = conn.execute(
                            "SELECT COUNT(*) AS n FROM data_reconcile_gaps WHERE run_id=?",
                            (last["id"],),
                        ).fetchone()
                        reconcile_ok = {
                            "run_id": last["id"],
                            "ok": bool(last["ok"]),
                            "finished_at": str(last["finished_at"]) if last["finished_at"] else None,
                            "gaps": int(gap_n["n"]) if gap_n else 0,
                        }
                except Exception:
                    reconcile_ok = None
        return {
            "ok": True,
            "truth": truth,
            "read_path": truth,
            "postgres_required_in_prod": True,
            "counts": counts,
            "legacy_sqlite_rows": legacy,
            "last_reconcile": reconcile_ok,
            "migrate": "python scripts/migrate_sqlite_to_postgres.py --sqlite <path>",
            "reconcile": "python scripts/reconcile_sqlite_postgres.py --sqlite <path>",
            "note": "業務畫面應讀控制面／PostgreSQL。kolindex-api SQLite 只作遷移來源，不再當真相。",
        }

    return app


def deliver(post, payload: dict, policy: dict) -> dict:
    """採集器只打控制面。失敗累計到 max_failures 就停止，檔案留在 inbox。"""
    failures = 0
    last = None
    while failures < int(policy["max_failures"]):
        try:
            return post(payload)
        except Exception as exc:  # 網路或 5xx
            failures += 1
            last = exc
    stopped = evaluate(policy, {"state": "running", "failures": failures})
    event = {
        "source_id": payload.get("source_id", "producer"),
        "before_ref": payload.get("storage_path"),
        "after_ref": None,
        "diff_fields": ["deliver"],
        "state": "failed",
        "failures": failures,
    }
    return {"state": stopped["state"], "failures": failures, "event": event, "error": str(last)}


def source_status(kind: str, source: str) -> str:
    return classify_source(POLICY, kind, source)


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5220")))

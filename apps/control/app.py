"""控制面。四個寫入端點只追加。SQLite 只在未設 PostgreSQL 時當 intake buffer。"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import sys

POLICY_DIR = Path(__file__).resolve().parents[2] / "packages" / "policy"
sys.path.insert(0, str(POLICY_DIR))
from evaluate import classify_source, evaluate, load_policy  # noqa: E402

POLICY = load_policy(POLICY_DIR / "policy.yaml")
STATES = set(POLICY["task_states"])


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def nas_root() -> Path:
    raw = os.environ.get("KOL_NAS_ROOT") or str(Path(__file__).resolve().parents[2] / "data" / "nas")
    root = Path(raw).resolve()
    (root / "inbox").mkdir(parents=True, exist_ok=True)
    return root


def database_path() -> Path:
    url = os.environ.get("KOL_DATABASE_URL", "")
    if url.startswith("sqlite:///"):
        return Path(url[len("sqlite:///") :]).resolve()
    return nas_root() / "buffer" / "control.sqlite"


def production_blocks_sqlite() -> None:
    url = os.environ.get("KOL_DATABASE_URL", "")
    if os.environ.get("KOL_PROD") == "1" and not url.startswith("postgres"):
        raise SystemExit("正式環境的真相必須是 PostgreSQL")


def connect() -> sqlite3.Connection:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
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
        url = os.environ.get("KOL_DATABASE_URL", "")
        if url.startswith("postgres"):
            return
        with connect() as conn:
            init_db(conn)

    @app.get("/__health/components")
    def health(authorization: str | None = Header(default=None)):
        import time

        role_of(authorization)
        t0 = time.perf_counter()
        url = os.environ.get("KOL_DATABASE_URL", "")
        truth = "postgres" if url.startswith("postgres") else "sqlite-buffer"
        duration = int((time.perf_counter() - t0) * 1000)
        return {
            "ok": True,
            "duration_ms": duration,
            "items": [
                {"id": "truth", "name": "資料真相", "state": "up", "role": truth},
                {"id": "policy", "name": "政策", "state": "up", "role": POLICY["version"]},
            ],
            "started_at": started.isoformat(),
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
                "INSERT INTO intake (recorded_at, source_id, captured_at, content_hash, storage_path) VALUES (?,?,?,?,?)",
                (now(), body.source_id, body.captured_at, body.content_hash, str(target)),
            )
            conn.commit()
            return {"seq": cur.lastrowid, "deduped": False, "recorded_at": now()}

    @app.post("/artifacts")
    def artifacts(body: ArtifactIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        if body.kind not in {"thumb", "keyframe", "ocr", "vision"}:
            raise HTTPException(status_code=400, detail="kind")
        with connect() as conn:
            init_db(conn)
            cur = conn.execute(
                "INSERT INTO artifact (recorded_at, source_id, original_id, kind, tool_name, tool_version, params) VALUES (?,?,?,?,?,?,?)",
                (now(), body.source_id, body.original_id, body.kind, body.tool_name, body.tool_version, json.dumps(body.params, ensure_ascii=False)),
            )
            conn.commit()
            return {"seq": cur.lastrowid}

    @app.post("/events")
    def events(body: EventIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"operator"})
        decision = evaluate(POLICY, {"state": body.state, "failures": body.failures})
        state = decision["state"] if decision["action"] == "stop" else body.state
        if state not in STATES:
            raise HTTPException(status_code=400, detail="state")
        with connect() as conn:
            init_db(conn)
            cur = conn.execute(
                "INSERT INTO change_event (recorded_at, source_id, before_ref, after_ref, diff_fields, state, policy_version) VALUES (?,?,?,?,?,?,?)",
                (now(), body.source_id, body.before_ref, body.after_ref, json.dumps(body.diff_fields), state, POLICY["version"]),
            )
            conn.commit()
            return {"seq": cur.lastrowid, "state": state, "policy_version": POLICY["version"], "action": decision["action"]}

    @app.post("/decisions")
    def decisions(body: DecisionIn, authorization: str | None = Header(default=None)):
        require(role_of(authorization), {"reviewer", "operator"})
        if body.action not in {"confirm", "reject", "defer"}:
            raise HTTPException(status_code=400, detail="action")
        with connect() as conn:
            init_db(conn)
            cur = conn.execute(
                "INSERT INTO decision (recorded_at, source_id, target_id, action, reason, reviewer, decided_at) VALUES (?,?,?,?,?,?,?)",
                (now(), body.source_id, body.target_id, body.action, body.reason, body.reviewer, body.decided_at),
            )
            conn.commit()
            return {"seq": cur.lastrowid}

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

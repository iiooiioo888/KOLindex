"""政策純函數。相同政策與任務，得到相同動作。"""

from __future__ import annotations

import re
from pathlib import Path

STATES = (
    "queued",
    "running",
    "succeeded",
    "failed",
    "stopped",
    "timeout",
    "cancelled",
    "waiting_review",
)
TERMINAL = {"succeeded", "failed", "stopped", "cancelled"}


def load_policy(path: str | Path) -> dict:
    text = Path(path).read_text(encoding="utf-8")
    return parse_policy(text)


def parse_policy(text: str) -> dict:
    """只接受這個倉庫 policy.yaml 的子集：純量、清單、一層鍵。"""
    data: dict = {}
    key = None
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if line.startswith("  - "):
            if key is None:
                raise ValueError("清單沒有鍵")
            data.setdefault(key, []).append(_scalar(line[4:].strip()))
            continue
        if line.startswith(" ") or line.startswith("\t"):
            raise ValueError("不接受巢狀對應")
        if ":" not in line:
            raise ValueError("無法解析：" + line)
        name, value = line.split(":", 1)
        key = name.strip()
        value = value.strip()
        if value == "":
            data[key] = []
        else:
            data[key] = _scalar(value)
    required = ("version", "max_failures", "relation_whitelist", "label_whitelist", "kill_switch", "task_states")
    missing = [name for name in required if name not in data]
    if missing:
        raise ValueError("政策缺欄位：" + ",".join(missing))
    if list(data["task_states"]) != list(STATES):
        raise ValueError("任務狀態必須等於全站那一組")
    return data


def _scalar(value: str):
    if value in ("true", "false"):
        return value == "true"
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def evaluate(policy: dict, task: dict) -> dict:
    version = str(policy["version"])
    state = task.get("state")
    if state not in STATES:
        return {"action": "stop", "state": "stopped", "reason": "unknown_state", "policy_version": version}
    if policy.get("kill_switch") is True:
        return {"action": "stop", "state": "stopped", "reason": "kill_switch", "policy_version": version}
    failures = int(task.get("failures") or 0)
    if failures >= int(policy["max_failures"]):
        return {"action": "stop", "state": "stopped", "reason": "max_failures", "policy_version": version}
    if state in TERMINAL:
        return {"action": "hold", "state": state, "reason": "terminal", "policy_version": version}
    return {"action": "run", "state": state, "reason": "ok", "policy_version": version}


def classify_source(policy: dict, kind: str, source: str) -> str:
    """回傳 fact、candidate，或丟出 ValueError（不入庫）。"""
    if kind == "time" and source in policy.get("time_fact_sources", []):
        return "fact"
    if kind == "time" and source in policy.get("time_candidate_sources", []):
        return "candidate"
    if kind == "place" and source in policy.get("place_blocked_sources", []):
        raise ValueError("file_place")
    if kind == "place" and source in policy.get("place_fact_sources", []):
        return "fact"
    raise ValueError("unknown_source")


def allow_label(policy: dict, label: str) -> bool:
    return label in policy.get("label_whitelist", [])


def allow_relation(policy: dict, kind: str) -> bool:
    return kind in policy.get("relation_whitelist", [])

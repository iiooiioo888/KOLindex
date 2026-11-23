"""Sherlock 0.16.2 作為候選使用者名稱探測。

只使用安裝包內的 data.json，不拉遠端清單，不查 NSFW，不使用代理或 Cookie。
此版本本地清單只含本系統四個優先平台中的 TikTok。結果仍是 candidate，不是已確認帳號。
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from importlib.resources import files
from typing import Any
from urllib.parse import urlparse

from kolindex_discovery.models import AccountCandidate, PlatformSkip

PINNED_VERSION = "0.16.2"
SITE_TO_PLATFORM = {"TikTok": "tiktok"}
_USERNAME = re.compile(r"^[A-Za-z0-9._]{2,24}$")
_ALLOWED_HOSTS = {"www.tiktok.com", "tiktok.com"}
_TIMEOUT_SECONDS = 10

SherlockRun = Callable[..., dict[str, dict[str, Any]]]


def username_for_sherlock(query: str) -> str | None:
    if _USERNAME.fullmatch(query):
        return query
    return None


def select_sites(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for name, info in manifest.items():
        if name.startswith("$") or not isinstance(info, dict):
            continue
        if info.get("isNSFW"):
            continue
        if name in SITE_TO_PLATFORM:
            selected[name] = info
    return selected


def load_local_manifest() -> dict[str, Any]:
    from sherlock_project import __version__

    if __version__ != PINNED_VERSION:
        raise RuntimeError(f"sherlock-project {__version__} is not the pinned {PINNED_VERSION}")
    raw = files("sherlock_project.resources").joinpath("data.json").read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("sherlock data.json is not an object")
    return payload


def probe_username(
    query: str,
    *,
    run: SherlockRun | None = None,
    manifest: dict[str, Any] | None = None,
) -> tuple[list[AccountCandidate], list[PlatformSkip]]:
    username = username_for_sherlock(query)
    if username is None:
        return [], [
            PlatformSkip(
                platform="tiktok",
                status="not_enabled",
                detail="Sherlock 只接受 2–24 字的公開使用者名稱，不含空白",
            )
        ]

    try:
        loaded = load_local_manifest() if manifest is None else manifest
    except ImportError:
        return [], [
            PlatformSkip(
                platform="tiktok",
                status="error",
                detail=f"未安裝 sherlock-project=={PINNED_VERSION}",
            )
        ]
    except Exception as exc:
        return [], [PlatformSkip(platform="tiktok", status="error", detail=type(exc).__name__)]

    sites = select_sites(loaded)
    if "TikTok" not in sites:
        return [], [
            PlatformSkip(
                platform="tiktok",
                status="not_enabled",
                detail=f"sherlock {PINNED_VERSION} 本地清單沒有 TikTok",
            )
        ]

    try:
        results = (run or _run_sherlock)(username, sites)
    except Exception as exc:
        return [], [PlatformSkip(platform="tiktok", status="error", detail=type(exc).__name__)]

    site_result = results.get("TikTok") or {}
    status = getattr(getattr(site_result.get("status"), "status", None), "value", None)
    if status == "Claimed":
        profile = _public_tiktok_url(str(site_result.get("url_user") or ""))
        if profile is None:
            return [], [
                PlatformSkip(
                    platform="tiktok",
                    status="error",
                    detail="Sherlock 回傳的網址不是 TikTok HTTPS 個人頁",
                )
            ]
        return [
            AccountCandidate(
                platform="tiktok",
                external_account_id=username,
                display_name=username,
                profile_url=profile,
            )
        ], []
    if status == "Available":
        return [], [PlatformSkip(platform="tiktok", status="not_found", detail="username not claimed")]
    if status == "WAF":
        return [], [PlatformSkip(platform="tiktok", status="blocked", detail="waf")]
    if status == "Illegal":
        return [], [PlatformSkip(platform="tiktok", status="not_enabled", detail="username not allowed")]
    return [], [PlatformSkip(platform="tiktok", status="error", detail=status or "no result")]


def _public_tiktok_url(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_HOSTS:
        return None
    return url


def _run_sherlock(username: str, sites: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    from sherlock_project.notify import QueryNotify
    from sherlock_project.sherlock import sherlock

    return sherlock(
        username,
        sites,
        QueryNotify(),
        dump_response=False,
        proxy=None,
        timeout=_TIMEOUT_SECONDS,
    )

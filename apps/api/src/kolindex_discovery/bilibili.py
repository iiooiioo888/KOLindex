from __future__ import annotations

import httpx

from kolindex_discovery.models import AccountCandidate, PlatformSkip

_SEARCH_URL = "https://api.bilibili.com/x/web-interface/search/type"
_MAX_CANDIDATES = 10


def search_bilibili(client: httpx.Client, query: str) -> tuple[list[AccountCandidate], PlatformSkip | None]:
    """查 B 站公開使用者搜尋。不帶 Cookie，不簽名，不在被擋時重試。"""
    try:
        response = client.get(
            _SEARCH_URL,
            params={"search_type": "bili_user", "keyword": query},
            headers={"Accept": "application/json", "User-Agent": "KOL-IndexDiscovery/0.1"},
        )
    except httpx.HTTPError as exc:
        return [], PlatformSkip(platform="bilibili", status="error", detail=type(exc).__name__)

    if response.status_code == 429:
        return [], PlatformSkip(platform="bilibili", status="blocked", detail="rate limited")
    if response.status_code in {401, 403, 412}:
        return [], PlatformSkip(platform="bilibili", status="blocked", detail=f"http {response.status_code}")
    if response.status_code >= 500:
        return [], PlatformSkip(platform="bilibili", status="error", detail=f"http {response.status_code}")
    if response.status_code != 200:
        return [], PlatformSkip(platform="bilibili", status="error", detail=f"http {response.status_code}")

    try:
        payload = response.json()
    except ValueError:
        return [], PlatformSkip(platform="bilibili", status="error", detail="invalid json")

    code = payload.get("code")
    if code not in (0, None):
        return [], PlatformSkip(platform="bilibili", status="blocked", detail=f"api code {code}")

    rows = (payload.get("data") or {}).get("result") or []
    if not isinstance(rows, list) or not rows:
        return [], PlatformSkip(platform="bilibili", status="not_found", detail="no public user")

    candidates: list[AccountCandidate] = []
    for row in rows[:_MAX_CANDIDATES]:
        if not isinstance(row, dict) or row.get("mid") is None:
            continue
        account_id = str(row["mid"])
        name = str(row.get("uname") or account_id)
        candidates.append(
            AccountCandidate(
                platform="bilibili",
                external_account_id=account_id,
                display_name=name,
                profile_url=f"https://space.bilibili.com/{account_id}",
            )
        )
    if not candidates:
        return [], PlatformSkip(platform="bilibili", status="not_found", detail="no public user")
    return candidates, None

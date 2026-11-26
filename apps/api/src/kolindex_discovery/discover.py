from __future__ import annotations

import httpx

from kolindex_discovery.bilibili import search_bilibili
from kolindex_discovery.models import DiscoveryResponse, PlatformSkip
from kolindex_discovery.query import normalize_query
from kolindex_discovery.rank import rank_candidates
from kolindex_discovery.sherlock_probe import probe_username

_NOT_ENABLED = (
    PlatformSkip(
        platform="douyin",
        status="not_enabled",
        detail="官方開放平台尚未配置；Sherlock 0.16.2 本地清單也沒有抖音",
    ),
    PlatformSkip(
        platform="xiaohongshu",
        status="not_enabled",
        detail="使用協議尚未核對；Sherlock 0.16.2 本地清單沒有小紅書",
    ),
)


def discover_accounts(
    query: str,
    client: httpx.Client,
    *,
    username_probe=probe_username,
) -> DiscoveryResponse:
    text = normalize_query(query)
    candidates, skip = search_bilibili(client, text)
    found, sherlock_skips = username_probe(text)
    skipped = [*sherlock_skips, *_NOT_ENABLED]
    if skip is not None:
        skipped.insert(0, skip)
    ranked = rank_candidates(text, [*candidates, *found])
    return DiscoveryResponse(query=text, candidates=ranked, skipped=skipped)

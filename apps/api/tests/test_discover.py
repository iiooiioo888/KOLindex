import httpx
import pytest

from kolindex_discovery.discover import discover_accounts
from kolindex_discovery.query import InvalidQuery, normalize_query


def test_reject_url_query() -> None:
    with pytest.raises(InvalidQuery):
        normalize_query("https://example.com/user")


def test_bilibili_candidates_and_other_platforms_skipped() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.bilibili.com"
        assert request.url.params["keyword"] == "示例用户"
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "result": [
                        {"mid": 42, "uname": "示例用户"},
                        {"mid": 7, "uname": "另一個"},
                    ]
                },
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = discover_accounts("  示例用户  ", client)
    assert result.query == "示例用户"
    assert [item.external_account_id for item in result.candidates] == ["42", "7"]
    assert result.candidates[0].profile_url == "https://space.bilibili.com/42"
    assert result.candidates[0].status == "candidate"
    assert result.candidates[0].confidence == 0.95
    assert "exact_name" in result.candidates[0].match_reasons
    assert result.candidates[1].confidence < result.candidates[0].confidence
    assert result.candidates[0].confidence == 0.95
    assert "exact_name" in result.candidates[0].match_reasons
    assert result.candidates[1].confidence < result.candidates[0].confidence
    assert {item.platform for item in result.skipped} == {"douyin", "xiaohongshu", "tiktok"}


def test_sherlock_username_becomes_tiktok_candidate() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 0, "data": {"result": []}})

    def probe(query: str):
        from kolindex_discovery.models import AccountCandidate

        assert query == "public_name"
        return [
            AccountCandidate(
                platform="tiktok",
                external_account_id=query,
                display_name=query,
                profile_url=f"https://www.tiktok.com/@{query}",
            )
        ], []

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = discover_accounts("public_name", client, username_probe=probe)
    assert result.sherlock.version == "0.16.2"
    assert result.sherlock.state == "candidate"
    assert result.candidates[0].platform == "tiktok"


def test_bilibili_block_does_not_retry() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"code": -412, "message": "blocked"})

    def probe(query: str):
        from kolindex_discovery.models import PlatformSkip

        return [], [PlatformSkip(platform="tiktok", status="not_found", detail="username not claimed")]

    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = discover_accounts("name", client, username_probe=probe)
    assert result.candidates == []
    assert calls["n"] == 1
    bilibili = next(item for item in result.skipped if item.platform == "bilibili")
    assert bilibili.status == "blocked"

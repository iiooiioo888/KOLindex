from kolindex_discovery.sherlock_probe import probe_username, select_sites


class _Status:
    def __init__(self, value: str) -> None:
        self.value = value


class _Result:
    def __init__(self, value: str) -> None:
        self.status = _Status(value)


_MANIFEST = {
    "$schema": "ignore",
    "TikTok": {"url": "https://www.tiktok.com/@{}", "isNSFW": False},
    "GitHub": {"url": "https://github.com/{}", "isNSFW": False},
    "RedTube": {"url": "https://example.invalid/{}", "isNSFW": True},
}


def test_select_sites_keeps_only_tiktok() -> None:
    assert list(select_sites(_MANIFEST)) == ["TikTok"]


def test_non_username_does_not_query() -> None:
    found, skipped = probe_username("示例用户", run=lambda *_args: (_ for _ in ()).throw(AssertionError()))
    assert found == []
    assert skipped[0].platform == "tiktok"
    assert skipped[0].status == "not_enabled"


def test_claimed_tiktok_profile_is_candidate() -> None:
    def run(username: str, sites: dict) -> dict:
        assert username == "public.name"
        assert list(sites) == ["TikTok"]
        return {
            "TikTok": {
                "status": _Result("Claimed"),
                "url_user": "https://www.tiktok.com/@public.name",
            }
        }

    found, skipped = probe_username("public.name", run=run, manifest=_MANIFEST)
    assert skipped == []
    assert found[0].platform == "tiktok"
    assert found[0].status == "candidate"
    assert found[0].profile_url == "https://www.tiktok.com/@public.name"


def test_rejects_non_tiktok_url() -> None:
    def run(username: str, sites: dict) -> dict:
        return {"TikTok": {"status": _Result("Claimed"), "url_user": "https://evil.example/@public.name"}}

    found, skipped = probe_username("public.name", run=run, manifest=_MANIFEST)
    assert found == []
    assert skipped[0].status == "error"

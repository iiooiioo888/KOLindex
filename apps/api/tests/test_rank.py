from kolindex_discovery.models import AccountCandidate
from kolindex_discovery.rank import rank_candidates, score_name_match


def test_exact_name_outranks_weak() -> None:
    ranked = rank_candidates(
        "示例用户",
        [
            AccountCandidate(
                platform="bilibili",
                external_account_id="7",
                display_name="另一個",
                profile_url="https://space.bilibili.com/7",
            ),
            AccountCandidate(
                platform="bilibili",
                external_account_id="42",
                display_name="示例用户",
                profile_url="https://space.bilibili.com/42",
            ),
        ],
    )
    assert ranked[0].external_account_id == "42"
    assert ranked[0].confidence == 0.95
    assert "exact_name" in ranked[0].match_reasons
    assert ranked[1].confidence < ranked[0].confidence


def test_username_exact_boost() -> None:
    conf, reasons = score_name_match("public_name", "public_name")
    assert conf == 0.95
    assert "exact_name" in reasons

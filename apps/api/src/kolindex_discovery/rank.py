"""發現候選的確定性打分。只產排序訊號，不確認帳號、不觸發採集。"""

from __future__ import annotations

from kolindex_discovery.models import AccountCandidate


def _fold(text: str) -> str:
    return " ".join(str(text or "").casefold().split())


def score_name_match(query: str, display_name: str) -> tuple[float, list[str]]:
    q = _fold(query)
    n = _fold(display_name)
    if not q or not n:
        return 0.0, ["empty"]
    if q == n:
        return 0.95, ["exact_name"]
    if q in n or n in q:
        return 0.78, ["substring_name"]
    q_tokens = set(q.replace("_", " ").replace(".", " ").split())
    n_tokens = set(n.replace("_", " ").replace(".", " ").split())
    if q_tokens and n_tokens and q_tokens <= n_tokens:
        return 0.72, ["token_subset"]
    overlap = q_tokens & n_tokens
    if overlap:
        ratio = len(overlap) / max(len(q_tokens), len(n_tokens))
        return round(0.45 + 0.25 * ratio, 4), ["token_overlap"]
    return 0.35, ["weak_name"]


def annotate_candidate(query: str, candidate: AccountCandidate) -> AccountCandidate:
    confidence, reasons = score_name_match(query, candidate.display_name)
    if candidate.platform == "tiktok" and candidate.external_account_id == _fold(query).replace(" ", ""):
        confidence = max(confidence, 0.88)
        if "username_exact" not in reasons:
            reasons = ["username_exact", *reasons]
    payload = candidate.model_dump()
    payload["confidence"] = confidence
    payload["match_reasons"] = reasons
    return AccountCandidate.model_validate(payload)


def rank_candidates(query: str, candidates: list[AccountCandidate]) -> list[AccountCandidate]:
    ranked = [annotate_candidate(query, item) for item in candidates]
    ranked.sort(
        key=lambda item: (
            -float(item.confidence),
            item.platform,
            item.display_name.casefold(),
            item.external_account_id,
        )
    )
    return ranked

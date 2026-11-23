from __future__ import annotations

import re

_ALLOWED = re.compile(r"^[\w.\- \u4e00-\u9fff]{1,64}$", re.UNICODE)


class InvalidQuery(ValueError):
    pass


def normalize_query(value: str) -> str:
    text = " ".join(value.strip().split())
    if not text or not _ALLOWED.fullmatch(text):
        raise InvalidQuery("query must be a name or username, not a URL or command")
    if "://" in text or text.startswith("//"):
        raise InvalidQuery("query must not be a URL")
    return text

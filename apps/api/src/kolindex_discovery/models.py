from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Platform = Literal["bilibili", "douyin", "xiaohongshu", "tiktok"]
CandidateStatus = Literal["candidate"]
SkipStatus = Literal["not_enabled", "blocked", "error", "not_found"]


class DiscoveryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=64)


class AccountCandidate(BaseModel):
    platform: Platform
    external_account_id: str
    display_name: str
    profile_url: str
    status: CandidateStatus = "candidate"
    source_trust: Literal["public_platform"] = "public_platform"
    confidence: float = Field(default=0.5, ge=0, le=1)
    match_reasons: list[str] = Field(default_factory=list)


class PlatformSkip(BaseModel):
    platform: Platform
    status: SkipStatus
    detail: str


class SherlockUse(BaseModel):
    name: Literal["sherlock"] = "sherlock"
    version: Literal["0.16.2"] = "0.16.2"
    state: Literal["candidate"] = "candidate"
    manifest: Literal["packaged-local"] = "packaged-local"


class DiscoveryResponse(BaseModel):
    query: str
    candidates: list[AccountCandidate]
    skipped: list[PlatformSkip]
    sherlock: SherlockUse = Field(default_factory=SherlockUse)

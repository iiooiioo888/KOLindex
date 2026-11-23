from __future__ import annotations

import httpx
from fastapi import FastAPI, HTTPException

from kolindex_discovery.discover import discover_accounts
from kolindex_discovery.models import DiscoveryRequest, DiscoveryResponse
from kolindex_discovery.query import InvalidQuery

app = FastAPI(title="KOL-Index discovery", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/discovery", response_model=DiscoveryResponse)
def discovery(body: DiscoveryRequest) -> DiscoveryResponse:
    try:
        with httpx.Client(timeout=10.0, follow_redirects=False) as client:
            return discover_accounts(body.query, client)
    except InvalidQuery as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

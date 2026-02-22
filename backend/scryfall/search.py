import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "MTGLocalManager/1.0",
    "Accept": "application/json",
}

_client: Optional[httpx.AsyncClient] = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(headers=HEADERS, timeout=15.0)
    return _client


async def search_cards(q: str, page: int = 1, order: str = "name", unique: str = "cards") -> dict[str, Any]:
    """Proxy a search query to Scryfall's /cards/search endpoint."""
    client = get_client()
    params = {"q": q, "page": page, "order": order, "unique": unique}
    resp = await client.get("https://api.scryfall.com/cards/search", params=params)

    if resp.status_code == 404:
        return {"data": [], "total_cards": 0, "has_more": False, "next_page": None}

    resp.raise_for_status()
    return resp.json()

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from db import get_db
from models import CollectionCard
from scryfall.search import search_cards
from scryfall.annotate import annotate_cards
from scryfall.store import card_store

router = APIRouter()


@router.get("/autocomplete")
async def autocomplete(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Fast local name search against the in-memory card store.
    Returns lightweight card stubs for a dropdown.
    No Scryfall API call — purely in-memory, instant response.
    """
    q_lower = q.lower().strip()

    # Two-pass: prefix matches ranked above substring matches
    prefix, substring = [], []
    for card in card_store.cards_by_oracle.values():
        name_lower = card.get("name", "").lower()
        if name_lower.startswith(q_lower):
            prefix.append(card)
        elif q_lower in name_lower:
            substring.append(card)

    # Merge, dedupe by oracle_id, cap at limit
    seen: set[str] = set()
    matches = []
    for card in prefix + substring:
        oid = card.get("oracle_id", "")
        if oid not in seen:
            seen.add(oid)
            matches.append(card)
        if len(matches) >= limit:
            break

    annotated = await annotate_cards(matches, db)

    stubs = [
        {
            "id": c.get("id"),
            "oracle_id": c.get("oracle_id"),
            "name": c.get("name"),
            "mana_cost": c.get("mana_cost"),
            "type_line": c.get("type_line"),
            "cmc": c.get("cmc"),
            "colors": c.get("colors", []),
            "set": c.get("set"),
            "set_name": c.get("set_name"),
            "collector_number": c.get("collector_number"),
            "image_uri": card_store.get_image_uri(c),
            "image_uri_back": card_store.get_image_uri(c, face="back"),
            "prices": c.get("prices", {}),
            "_ownership": c.get("_ownership"),
        }
        for c in annotated
    ]
    return {"data": stubs, "total": len(stubs)}


@router.get("/search")
async def search(
    q: str = Query(..., description="Scryfall search syntax"),
    page: int = Query(1, ge=1),
    order: str = Query("name"),
    unique: str = Query("cards"),
    db: AsyncSession = Depends(get_db),
):
    """
    Proxy to Scryfall /cards/search, annotated with ownership data.
    Supports full Scryfall syntax: https://scryfall.com/docs/syntax
    """
    try:
        result = await search_cards(q, page=page, order=order, unique=unique)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Scryfall API error: {str(e)}")

    cards = result.get("data", [])
    annotated = await annotate_cards(cards, db)
    result["data"] = annotated
    return result


@router.get("/printings")
async def get_printings(
    oracle_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Return all printings of a card by oracle_id, sorted newest first."""
    printings = card_store.cards_by_oracle_all.get(oracle_id, [])
    if not printings:
        raise HTTPException(status_code=404, detail="No printings found")
    printings = sorted(printings, key=lambda c: c.get("released_at", ""), reverse=True)
    annotated = await annotate_cards(printings, db)

    # Per-printing owned quantity (scryfall_id specific)
    scryfall_ids = [c.get("id") for c in annotated if c.get("id")]
    coll_result = await db.execute(
        select(CollectionCard.scryfall_id, CollectionCard.quantity, CollectionCard.foil_quantity)
        .where(CollectionCard.scryfall_id.in_(scryfall_ids))
    )
    printing_qty = {row.scryfall_id: row.quantity + row.foil_quantity for row in coll_result}

    return {
        "data": [
            {
                "id": c.get("id"),
                "oracle_id": c.get("oracle_id"),
                "name": c.get("name"),
                "set": c.get("set"),
                "set_name": c.get("set_name"),
                "collector_number": c.get("collector_number"),
                "released_at": c.get("released_at"),
                "image_uri": card_store.get_image_uri(c),
                "prices": c.get("prices", {}),
                "scryfall_uri": c.get("scryfall_uri", ""),
                "related_uris": {"edhrec": (c.get("related_uris") or {}).get("edhrec")},
                "purchase_uris": {"tcgplayer": (c.get("purchase_uris") or {}).get("tcgplayer")},
                "_ownership": c.get("_ownership"),
                "_printing_owned": printing_qty.get(c.get("id"), 0),
            }
            for c in annotated
        ]
    }


@router.get("/{scryfall_id}")
async def get_card(scryfall_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single card by Scryfall ID from the local bulk store."""
    card = card_store.get_by_id(scryfall_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    annotated = await annotate_cards([card], db)
    return annotated[0]

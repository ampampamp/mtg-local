"""
Annotates Scryfall card objects with ownership and cross-deck availability data.
"""
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import CollectionCard, DeckCard, Deck


async def annotate_cards(cards: list[dict], db: AsyncSession) -> list[dict]:
    """Add ownership data to a list of Scryfall card objects."""
    oracle_ids = [c.get("oracle_id") for c in cards if c.get("oracle_id")]
    if not oracle_ids:
        return cards

    owned_map = await _get_owned_map(oracle_ids, db)
    usage_map = await _get_usage_map(oracle_ids, db)

    for card in cards:
        oid = card.get("oracle_id")
        owned = owned_map.get(oid, {"qty": 0, "foil_qty": 0})
        usage = usage_map.get(oid, [])
        total_in_use = sum(u["quantity"] for u in usage)
        total_owned = owned["qty"] + owned["foil_qty"]

        card["_ownership"] = {
            "owned": total_owned,
            "owned_normal": owned["qty"],
            "owned_foil": owned["foil_qty"],
            "in_use": min(total_in_use, total_owned),
            "available": max(0, total_owned - total_in_use),
            "decks": usage,
        }

    return cards


async def _get_owned_map(oracle_ids: list[str], db: AsyncSession) -> dict:
    result = await db.execute(
        select(CollectionCard).where(CollectionCard.oracle_id.in_(oracle_ids))
    )
    rows = result.scalars().all()
    owned = defaultdict(lambda: {"qty": 0, "foil_qty": 0})
    for row in rows:
        owned[row.oracle_id]["qty"] += row.quantity
        owned[row.oracle_id]["foil_qty"] += row.foil_quantity
    return owned


async def _get_usage_map(oracle_ids: list[str], db: AsyncSession) -> dict:
    result = await db.execute(
        select(DeckCard, Deck.name)
        .join(Deck, DeckCard.deck_id == Deck.id)
        .where(DeckCard.oracle_id.in_(oracle_ids))
        .where(DeckCard.board == "mainboard")
    )
    rows = result.all()
    usage = defaultdict(list)
    for deck_card, deck_name in rows:
        usage[deck_card.oracle_id].append({
            "deck_id": deck_card.deck_id,
            "deck_name": deck_name,
            "quantity": deck_card.quantity,
        })
    return usage

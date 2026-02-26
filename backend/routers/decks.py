import re
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy.orm import selectinload

from db import get_db
from models import Deck, DeckCard, CollectionCard
from scryfall.store import card_store
from scryfall.annotate import annotate_cards

router = APIRouter()

FORMATS = ["commander", "modern", "standard", "legacy", "vintage", "pioneer",
           "pauper", "draft", "sealed", "custom"]
BOARDS = ["mainboard", "sideboard", "maybeboard", "commander"]


class CreateDeck(BaseModel):
    name: str
    format: str = "commander"
    description: str = ""
    decklist: str = ""
    commander_scryfall_id: str = ""


class UpsertDeckCard(BaseModel):
    oracle_id: Optional[str] = None
    scryfall_id: Optional[str] = None
    name: str
    quantity: int = 1
    board: str = "mainboard"
    tags: list[str] = []


class MoveCard(BaseModel):
    oracle_id: str
    from_board: str
    to_board: str


class ImportDecklist(BaseModel):
    text: str
    board: str = "mainboard"


@router.get("")
async def list_decks(db: AsyncSession = Depends(get_db)):
    count_sub = (
        select(DeckCard.deck_id, func.sum(DeckCard.quantity).label("card_count"))
        .where(DeckCard.board.in_(["mainboard", "commander"]))
        .group_by(DeckCard.deck_id)
        .subquery()
    )
    result = await db.execute(
        select(Deck, count_sub.c.card_count)
        .outerjoin(count_sub, Deck.id == count_sub.c.deck_id)
        .order_by(Deck.updated_at.desc())
    )
    rows = result.all()
    return {"data": [
        {
            "id": d.id, "name": d.name, "format": d.format,
            "description": d.description,
            "card_count": card_count or 0,
            "created_at": d.created_at, "updated_at": d.updated_at,
        }
        for d, card_count in rows
    ]}


def _parse_decklist(text: str, deck_id: int, board: str) -> tuple[list[DeckCard], list[dict]]:
    """Parse a decklist text and return (cards_to_add, failed_lines)."""
    imported_cards, failed = [], []
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    seen: dict[tuple, DeckCard] = {}  # (oracle_id, board) -> DeckCard

    for line in lines:
        if line.startswith("//") or line.startswith("#"):
            continue

        line = re.sub(r'\s*\*[^*]+\*\s*$', '', line).strip()

        full_match = re.match(r"^(\d+)x?\s+(.+?)\s+\(([A-Z0-9]+)\)\s+([A-Z0-9-]+)\s*$", line, re.IGNORECASE)
        simple_match = re.match(r"^(\d+)x?\s+(.+?)\s*$", line, re.IGNORECASE)
        match = full_match or simple_match
        if not match:
            failed.append({"line": line, "reason": "Could not parse"})
            continue

        qty = int(match.group(1))
        name = match.group(2).strip()
        oracle_id, scryfall_id = None, None

        if full_match:
            card_data = card_store.get_by_set_collector(full_match.group(3), full_match.group(4))
            if card_data:
                oracle_id = card_data.get("oracle_id")
                scryfall_id = card_data.get("id")
                name = card_data.get("name", name)

        if not oracle_id:
            for c in card_store.cards_by_oracle.values():
                if c.get("name", "").lower() == name.lower():
                    oracle_id = c.get("oracle_id")
                    scryfall_id = c.get("id")
                    break

        if not oracle_id:
            failed.append({"line": line, "reason": f"Card '{name}' not found"})
            continue

        key = (oracle_id, board)
        if key in seen:
            seen[key].quantity += qty
        else:
            dc = DeckCard(deck_id=deck_id, oracle_id=oracle_id, scryfall_id=scryfall_id,
                          name=name, quantity=qty, board=board)
            seen[key] = dc
            imported_cards.append(dc)

    return imported_cards, failed


@router.post("")
async def create_deck(body: CreateDeck, db: AsyncSession = Depends(get_db)):
    deck = Deck(name=body.name, format=body.format, description=body.description)
    db.add(deck)
    await db.flush()

    commander_oracle_id = None
    if body.commander_scryfall_id.strip():
        card_data = card_store.get_by_id(body.commander_scryfall_id)
        if card_data:
            commander_oracle_id = card_data.get("oracle_id")
            db.add(DeckCard(
                deck_id=deck.id,
                oracle_id=commander_oracle_id,
                scryfall_id=body.commander_scryfall_id,
                name=card_data.get("name", ""),
                quantity=1,
                board="commander",
            ))

    if body.decklist.strip():
        cards, _ = _parse_decklist(body.decklist, deck.id, "mainboard")
        for card in cards:
            # Don't duplicate the commander in mainboard
            if commander_oracle_id and card.oracle_id == commander_oracle_id:
                continue
            db.add(card)

    await db.commit()
    await db.refresh(deck)
    return {"id": deck.id, "name": deck.name}


@router.put("/{deck_id}/commander")
async def set_commander(deck_id: int, body: UpsertDeckCard, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Deck).where(Deck.id == deck_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Deck not found")

    oracle_id = body.oracle_id
    scryfall_id = body.scryfall_id
    if not oracle_id and scryfall_id:
        card_data = card_store.get_by_id(scryfall_id)
        if card_data:
            oracle_id = card_data.get("oracle_id")
    if not oracle_id:
        raise HTTPException(status_code=404, detail="Card not found")

    await db.execute(delete(DeckCard).where(DeckCard.deck_id == deck_id, DeckCard.board == "commander"))
    # Also remove from mainboard/maybeboard so the commander isn't double-counted
    await db.execute(delete(DeckCard).where(DeckCard.deck_id == deck_id, DeckCard.oracle_id == oracle_id, DeckCard.board != "commander"))
    db.add(DeckCard(
        deck_id=deck_id,
        oracle_id=oracle_id,
        scryfall_id=scryfall_id,
        name=body.name,
        quantity=1,
        board="commander",
    ))
    await db.commit()
    return {"status": "ok"}


@router.get("/{deck_id}")
async def get_deck(deck_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Deck).where(Deck.id == deck_id).options(selectinload(Deck.cards))
    )
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    cards_out = []
    for dc in deck.cards:
        card_data = (
            card_store.get_by_id(dc.scryfall_id) if dc.scryfall_id
            else card_store.get_by_oracle(dc.oracle_id)
        ) or {}
        cards_out.append({
            "id": dc.id,
            "oracle_id": dc.oracle_id,
            "scryfall_id": dc.scryfall_id,
            "name": dc.name,
            "quantity": dc.quantity,
            "board": dc.board,
            "tags": [t.strip() for t in (dc.tags or "").split(",") if t.strip()],
            "image_uri": card_store.get_image_uri(card_data) if card_data else None,
            "mana_cost": card_data.get("mana_cost", ""),
            "type_line": card_data.get("type_line", ""),
            "cmc": card_data.get("cmc", 0),
            "colors": card_data.get("colors", []),
            "prices": card_data.get("prices", {}),
        })

    # Annotate with ownership — mainboard and sideboard separately
    mini_cards = [{"oracle_id": c["oracle_id"], "_idx": i} for i, c in enumerate(cards_out)]
    annotated_mini = await annotate_cards(mini_cards, db)
    for mini, full in zip(annotated_mini, cards_out):
        full["_ownership"] = mini.get("_ownership", {})

    commander_oracle_ids = {c["oracle_id"] for c in cards_out if c["board"] == "commander"}
    mainboard = [c for c in cards_out if c["board"] == "mainboard" and c["oracle_id"] not in commander_oracle_ids]
    sideboard = [c for c in cards_out if c["board"] == "sideboard"]
    missing = [
        c for c in mainboard
        if c.get("_ownership", {}).get("owned", 0) < c["quantity"]
    ]

    return {
        "id": deck.id,
        "name": deck.name,
        "format": deck.format,
        "description": deck.description,
        "created_at": deck.created_at,
        "updated_at": deck.updated_at,
        "cards": cards_out,
        "stats": {
            "total_cards": sum(c["quantity"] for c in mainboard) + len(commander_oracle_ids),
            "sideboard_cards": sum(c["quantity"] for c in sideboard),
            "missing_cards": len(missing),
            "total_price": sum(
                float(c["prices"].get("usd") or 0) * c["quantity"]
                for c in mainboard + sideboard
            ),
        }
    }


@router.put("/{deck_id}")
async def update_deck(deck_id: int, body: CreateDeck, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Deck).where(Deck.id == deck_id))
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    deck.name = body.name
    deck.format = body.format
    deck.description = body.description
    await db.commit()
    return {"status": "updated"}


class PatchDeck(BaseModel):
    name: str


@router.patch("/{deck_id}")
async def patch_deck(deck_id: int, body: PatchDeck, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Deck).where(Deck.id == deck_id))
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    deck.name = body.name
    await db.commit()
    return {"status": "updated"}


@router.delete("/{deck_id}")
async def delete_deck(deck_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(DeckCard).where(DeckCard.deck_id == deck_id))
    await db.execute(delete(Deck).where(Deck.id == deck_id))
    await db.commit()
    return {"status": "deleted"}


@router.post("/{deck_id}/cards")
async def upsert_deck_card(deck_id: int, body: UpsertDeckCard, db: AsyncSession = Depends(get_db)):
    if body.board not in BOARDS:
        raise HTTPException(status_code=400, detail=f"Board must be one of {BOARDS}")

    oracle_id = body.oracle_id
    scryfall_id = body.scryfall_id

    if not oracle_id and scryfall_id:
        card_data = card_store.get_by_id(scryfall_id)
        if card_data:
            oracle_id = card_data.get("oracle_id")

    if not oracle_id:
        for c in card_store.cards_by_oracle.values():
            if c.get("name", "").lower() == body.name.lower():
                oracle_id = c.get("oracle_id")
                if not scryfall_id:
                    scryfall_id = c.get("id")
                break

    if not oracle_id:
        raise HTTPException(status_code=404, detail=f"Card '{body.name}' not found in card store")

    result = await db.execute(
        select(DeckCard).where(
            DeckCard.deck_id == deck_id,
            DeckCard.oracle_id == oracle_id,
            DeckCard.board == body.board,
        )
    )
    existing = result.scalar_one_or_none()

    tags_str = ",".join(t.strip().lower() for t in body.tags if t.strip())

    if existing:
        existing.quantity = body.quantity
        existing.scryfall_id = scryfall_id or existing.scryfall_id
        existing.tags = tags_str
    else:
        db.add(DeckCard(
            deck_id=deck_id,
            oracle_id=oracle_id,
            scryfall_id=scryfall_id,
            name=body.name,
            quantity=body.quantity,
            board=body.board,
            tags=tags_str,
        ))

    await db.commit()
    return {"status": "ok"}


@router.post("/{deck_id}/cards/move")
async def move_card(deck_id: int, body: MoveCard, db: AsyncSession = Depends(get_db)):
    """Move a card from one board to another, merging quantity if card already exists on target board."""
    if body.from_board not in BOARDS or body.to_board not in BOARDS:
        raise HTTPException(status_code=400, detail=f"Board must be one of {BOARDS}")
    if body.from_board == body.to_board:
        return {"status": "no-op"}

    # Find the source card
    src_result = await db.execute(
        select(DeckCard).where(
            DeckCard.deck_id == deck_id,
            DeckCard.oracle_id == body.oracle_id,
            DeckCard.board == body.from_board,
        )
    )
    src = src_result.scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Card not found in source board")

    # Check if card already exists on target board — merge if so
    dst_result = await db.execute(
        select(DeckCard).where(
            DeckCard.deck_id == deck_id,
            DeckCard.oracle_id == body.oracle_id,
            DeckCard.board == body.to_board,
        )
    )
    dst = dst_result.scalar_one_or_none()

    if dst:
        dst.quantity += src.quantity
        if src.tags:
            existing_tags = set(dst.tags.split(",")) if dst.tags else set()
            merged = existing_tags | set(src.tags.split(","))
            dst.tags = ",".join(t for t in merged if t)
    else:
        db.add(DeckCard(
            deck_id=deck_id,
            oracle_id=src.oracle_id,
            scryfall_id=src.scryfall_id,
            name=src.name,
            quantity=src.quantity,
            board=body.to_board,
            tags=src.tags,
        ))

    await db.delete(src)
    await db.commit()
    return {"status": "moved"}


@router.delete("/{deck_id}/cards/{oracle_id}")
async def remove_deck_card(deck_id: int, oracle_id: str, board: str = "mainboard", db: AsyncSession = Depends(get_db)):
    await db.execute(
        delete(DeckCard).where(
            DeckCard.deck_id == deck_id,
            DeckCard.oracle_id == oracle_id,
            DeckCard.board == board,
        )
    )
    await db.commit()
    return {"status": "deleted"}


@router.get("/{deck_id}/missing")
async def get_missing_cards(deck_id: int, db: AsyncSession = Depends(get_db)):
    """Cards in mainboard you don't own enough of (cross-deck availability aware). Sideboard excluded."""
    deck_resp = await get_deck(deck_id, db)
    missing = []
    for card in deck_resp["cards"]:
        if card["board"] != "mainboard":
            continue
        ownership = card.get("_ownership", {})
        owned = ownership.get("owned", 0)
        needed = card["quantity"]
        if owned < needed:
            missing.append({
                **card,
                "need_to_acquire": needed - owned,
            })
    return {"data": missing, "total": len(missing)}


@router.post("/{deck_id}/import")
async def import_decklist(deck_id: int, body: ImportDecklist, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Deck).where(Deck.id == deck_id))
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    # Get existing commander oracle_id to exclude it from mainboard imports
    cmd_result = await db.execute(
        select(DeckCard.oracle_id).where(DeckCard.deck_id == deck_id, DeckCard.board == "commander")
    )
    commander_oracle_id = cmd_result.scalar_one_or_none()

    imported, failed = [], []
    lines = [l.strip() for l in body.text.strip().splitlines() if l.strip()]

    for line in lines:
        if line.startswith("//") or line.startswith("#"):
            continue

        # Strip foil/finish markers like *F*, *E* before parsing
        line = re.sub(r'\s*\*[^*]+\*\s*$', '', line).strip()

        # Try "1 Card Name (SET) 123" first, fall back to "1 Card Name"
        # Collector numbers can be alphanumeric+hyphen e.g. A25-92, CON-115
        full_match = re.match(r"^(\d+)x?\s+(.+?)\s+\(([A-Z0-9]+)\)\s+([A-Z0-9-]+)\s*$", line, re.IGNORECASE)
        simple_match = re.match(r"^(\d+)x?\s+(.+?)\s*$", line, re.IGNORECASE)
        match = full_match or simple_match
        if not match:
            failed.append({"line": line, "reason": "Could not parse"})
            continue

        qty = int(match.group(1))
        name = match.group(2).strip()
        oracle_id, scryfall_id = None, None

        if full_match:
            card_data = card_store.get_by_set_collector(full_match.group(3), full_match.group(4))
            if card_data:
                oracle_id = card_data.get("oracle_id")
                scryfall_id = card_data.get("id")
                name = card_data.get("name", name)

        # Fall back to name lookup if set+collector not found or not provided
        if not oracle_id:
            for c in card_store.cards_by_oracle.values():
                if c.get("name", "").lower() == name.lower():
                    oracle_id = c.get("oracle_id")
                    scryfall_id = c.get("id")
                    break

        if not oracle_id:
            failed.append({"line": line, "reason": f"Card '{name}' not found"})
            continue

        # Skip commander card — it lives in its own board
        if commander_oracle_id and oracle_id == commander_oracle_id:
            continue

        result2 = await db.execute(
            select(DeckCard).where(
                DeckCard.deck_id == deck_id,
                DeckCard.oracle_id == oracle_id,
                DeckCard.board == body.board,
            )
        )
        existing = result2.scalar_one_or_none()
        if existing:
            existing.quantity += qty
        else:
            db.add(DeckCard(
                deck_id=deck_id, oracle_id=oracle_id, scryfall_id=scryfall_id,
                name=name, quantity=qty, board=body.board,
            ))
        imported.append(name)

    await db.commit()
    return {"imported": len(imported), "failed": failed}

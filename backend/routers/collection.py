import csv
import io

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from db import get_db
from models import CollectionCard
from scryfall.store import card_store
from scryfall.annotate import annotate_cards

router = APIRouter()

CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"]


CONDITION_MAP = {
    "mint": "NM",
    "near mint": "NM",
    "good (lightly played)": "LP",
    "lightly played": "LP",
    "played": "MP",
    "moderately played": "MP",
    "heavily played": "HP",
    "poor": "DMG",
    "damaged": "DMG",
}
CONDITION_ORDER = ["NM", "LP", "MP", "HP", "DMG"]


class UpsertCollectionCard(BaseModel):
    scryfall_id: str
    quantity: int = 0
    foil_quantity: int = 0
    condition: str = "NM"


class ImportRequest(BaseModel):
    csv: str
    mode: str = "append"  # "append" or "replace"


@router.get("")
async def list_collection(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CollectionCard).order_by(CollectionCard.name))
    rows = result.scalars().all()

    # Enrich with live card data from store and ownership info
    cards_out = []
    for row in rows:
        card_data = card_store.get_by_id(row.scryfall_id) or {}
        cards_out.append({
            "id": row.id,
            "scryfall_id": row.scryfall_id,
            "oracle_id": row.oracle_id,
            "name": row.name,
            "set_code": row.set_code,
            "collector_number": row.collector_number,
            "quantity": row.quantity,
            "foil_quantity": row.foil_quantity,
            "condition": row.condition,
            "image_uri": card_store.get_image_uri(card_data) if card_data else None,
            "prices": card_data.get("prices", {}),
            "set_name": card_data.get("set_name", ""),
        })

    # Annotate with cross-deck availability
    oracle_ids = [c["oracle_id"] for c in cards_out if c.get("oracle_id")]
    if oracle_ids:
        # Build minimal card-like dicts for annotate_cards
        mini_cards = [{"oracle_id": c["oracle_id"], "_idx": i} for i, c in enumerate(cards_out)]
        annotated = await annotate_cards(mini_cards, db)
        for mini, full in zip(annotated, cards_out):
            full["_ownership"] = mini.get("_ownership", {})

    return {"data": cards_out, "total": len(cards_out)}


@router.post("")
async def upsert_card(body: UpsertCollectionCard, db: AsyncSession = Depends(get_db)):
    if body.condition not in CONDITIONS:
        raise HTTPException(status_code=400, detail=f"Invalid condition. Must be one of {CONDITIONS}")

    # Look up card in store
    card_data = card_store.get_by_id(body.scryfall_id)
    if not card_data:
        raise HTTPException(status_code=404, detail="Card not found in local card store")

    result = await db.execute(
        select(CollectionCard).where(CollectionCard.scryfall_id == body.scryfall_id)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.quantity = body.quantity
        existing.foil_quantity = body.foil_quantity
        existing.condition = body.condition
    else:
        new_card = CollectionCard(
            scryfall_id=body.scryfall_id,
            oracle_id=card_data.get("oracle_id", ""),
            name=card_data.get("name", ""),
            set_code=card_data.get("set", ""),
            collector_number=card_data.get("collector_number", ""),
            quantity=body.quantity,
            foil_quantity=body.foil_quantity,
            condition=body.condition,
        )
        db.add(new_card)

    await db.commit()
    return {"status": "ok", "scryfall_id": body.scryfall_id}


@router.delete("/{scryfall_id}")
async def remove_card(scryfall_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(
        delete(CollectionCard).where(CollectionCard.scryfall_id == scryfall_id)
    )
    await db.commit()
    return {"status": "deleted"}


@router.post("/import")
async def import_collection(body: ImportRequest, db: AsyncSession = Depends(get_db)):
    if body.mode not in ("append", "replace"):
        raise HTTPException(status_code=400, detail="mode must be 'append' or 'replace'")

    reader = csv.DictReader(io.StringIO(body.csv))

    # Group rows by (edition, collector_number), accumulating qty and foil_qty
    groups: dict[tuple, dict] = {}
    for row in reader:
        lang = row.get("Language", "English") or "English"
        if lang.lower() != "english":
            continue

        edition = (row.get("Edition") or "").lower().strip()
        collector_number = (row.get("Collector Number") or "").strip()
        if not edition or not collector_number:
            continue

        try:
            count = int(row.get("Count") or "0")
        except ValueError:
            count = 0
        if count <= 0:
            continue

        is_foil = (row.get("Foil") or "").lower().strip() == "foil"
        condition_str = (row.get("Condition") or "").strip().lower()
        condition = CONDITION_MAP.get(condition_str, "NM")
        name = (row.get("Name") or "").strip()

        key = (edition, collector_number)
        if key not in groups:
            groups[key] = {"qty": 0, "foil_qty": 0, "condition": condition, "name": name}

        g = groups[key]
        if is_foil:
            g["foil_qty"] += count
        else:
            g["qty"] += count

        # Take best (lowest index) condition across all rows for this printing
        curr_idx = CONDITION_ORDER.index(g["condition"]) if g["condition"] in CONDITION_ORDER else 4
        new_idx = CONDITION_ORDER.index(condition) if condition in CONDITION_ORDER else 4
        if new_idx < curr_idx:
            g["condition"] = condition

    if body.mode == "replace":
        await db.execute(delete(CollectionCard))
        await db.commit()

    imported = 0
    failed = []

    for (edition, collector_number), group in groups.items():
        card_data = card_store.get_by_set_collector(edition, collector_number)
        if not card_data:
            failed.append({
                "row": f"{group['name']} ({edition.upper()} #{collector_number})",
                "reason": "Card not found in local store",
            })
            continue

        scryfall_id = card_data["id"]
        result = await db.execute(
            select(CollectionCard).where(CollectionCard.scryfall_id == scryfall_id)
        )
        existing = result.scalar_one_or_none()

        if existing:
            if body.mode == "append":
                existing.quantity += group["qty"]
                existing.foil_quantity += group["foil_qty"]
            else:
                existing.quantity = group["qty"]
                existing.foil_quantity = group["foil_qty"]
                existing.condition = group["condition"]
        else:
            db.add(CollectionCard(
                scryfall_id=scryfall_id,
                oracle_id=card_data.get("oracle_id", ""),
                name=card_data.get("name", ""),
                set_code=card_data.get("set", ""),
                collector_number=card_data.get("collector_number", ""),
                quantity=group["qty"],
                foil_quantity=group["foil_qty"],
                condition=group["condition"],
            ))

        imported += 1

    await db.commit()
    return {"imported": imported, "failed": failed}

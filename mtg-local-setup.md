# MTG Local Manager — GitHub Setup

## Steps

1. Create empty repo at github.com called `mtg-local`
2. On your laptop:

```bash
mkdir mtg-local && cd mtg-local
# paste setup.sh below into a file called setup.sh
chmod +x setup.sh && bash setup.sh
git init
git remote add origin https://github.com/YOUR_USERNAME/mtg-local.git
git add . && git commit -m 'Initial commit' && git push -u origin main
```

**Docker:** `docker-compose up --build` → http://localhost:8000

**Dev mode:**
```bash
# Terminal 1:
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && mkdir -p ../data
DATA_DIR=../data uvicorn main:app --reload --port 8000

# Terminal 2:
cd frontend && npm install && npm run dev
```

---

## setup.sh

```bash
#!/usr/bin/env bash
set -e

echo "🃏 Setting up MTG Local Manager..."

cat > '.gitignore' << 'HEREDOC_EOF'
# Data (Scryfall bulk JSON + SQLite DB — don't commit these)
data/

# Python
__pycache__/
*.pyc
.venv/
venv/

# Node
node_modules/
frontend/dist/

# OS
.DS_Store

HEREDOC_EOF

cat > 'README.md' << 'HEREDOC_EOF'
# MTG Local Manager

A lightweight local clone of Moxfield for managing your Magic: The Gathering collection and decks.

- **Card database**: Scryfall bulk data (~300MB, loaded into memory on startup, refreshed weekly)
- **Backend**: FastAPI + SQLite
- **Frontend**: React + Vite + Tailwind
- **Packaged**: Single Docker container

## Prerequisites

- Docker Desktop (for the packaged version)
- Node.js 18+ and Python 3.12+ (for local dev)
- Git

---

## Quick Start (Docker)

```bash
git clone <your-repo-url> mtg-local
cd mtg-local

# Build and start (first run will download ~300MB of Scryfall card data)
docker-compose up --build
```

Then open http://localhost:8000

> First startup takes 2-5 minutes to download the Scryfall bulk card data.
> Subsequent startups are instant — card data is cached in `./data/`.

---

## Development Setup (Hot Reload)

Run backend and frontend separately for hot reload during development.

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
mkdir -p ../data
DATA_DIR=../data uvicorn main:app --reload --port 8000
```

### Frontend (separate terminal)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at http://localhost:5173 and proxies `/api` to the backend at 8000.

---

## Production Build (single container)

```bash
# Build the React frontend
cd frontend && npm run build && cd ..

# Now docker-compose serves everything from FastAPI on port 8000
docker-compose up --build
```

---

## Features

- **Search**: Full Scryfall search syntax (e.g. `c:red cmc=3`, `t:dragon f:commander`)
- **Collection**: Track cards with quantity, foil count, and condition (NM/LP/MP/HP/DMG)
- **Ownership badges**: Every card shows how many you own, how many are in use across decks, and how many are free
- **Deck builder**: Create decks, import plaintext decklists, view cards grouped by type
- **Missing cards**: See exactly what you need to acquire to complete a deck
- **Cross-deck availability**: Click any ownership badge to see which decks are using that card

---

## Data

Card data is stored in `./data/` (gitignored):
- `default_cards.json` — Scryfall bulk card data (~300MB)
- `mtg.db` — Your collection and decks (SQLite)

To force a card data refresh: `POST /api/system/bulk-refresh` or use the System endpoint.

---

## Project Structure

```
mtg-local/
  backend/
    main.py              # FastAPI app + startup
    db.py                # SQLAlchemy async setup
    models.py            # CollectionCard, Deck, DeckCard
    routers/
      cards.py           # Search proxy + card lookup
      collection.py      # Collection CRUD
      decks.py           # Deck CRUD + import + missing cards
      system.py          # Bulk data status + refresh
    scryfall/
      bulk.py            # Download + staleness check
      store.py           # In-memory card store
      search.py          # Scryfall API proxy
      annotate.py        # Ownership annotation logic
  frontend/
    src/
      App.tsx
      api.ts             # All API calls
      types.ts           # TypeScript types
      components/
        Navbar.tsx
        CardTile.tsx
        OwnershipBadge.tsx
        AddToCollectionModal.tsx
      pages/
        Search.tsx
        Collection.tsx
        Decks.tsx
        DeckDetail.tsx
  data/                  # gitignored — card data + SQLite DB
  docker-compose.yml
```

---

## Roadmap

- [ ] Phase 5: Bulk CSV import/export
- [ ] Phase 6: Tauri wrapper for macOS app
- [ ] Price tracking over time
- [ ] Commander staples / card recommendations
- [ ] Proxy printing export

HEREDOC_EOF

cat > 'docker-compose.yml' << 'HEREDOC_EOF'
version: '3.9'

services:
  app:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data
    environment:
      - DATA_DIR=/data
    restart: unless-stopped

  # Dev only: run frontend separately with hot reload
  # In production, run `npm run build` in frontend/ and FastAPI serves the static files

HEREDOC_EOF

mkdir -p "backend"
cat > 'backend/Dockerfile' << 'HEREDOC_EOF'
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

HEREDOC_EOF

mkdir -p "backend"
cat > 'backend/db.py' << 'HEREDOC_EOF'
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

DATA_DIR = os.environ.get("DATA_DIR", "/data")
os.makedirs(DATA_DIR, exist_ok=True)

DATABASE_URL = f"sqlite+aiosqlite:///{DATA_DIR}/mtg.db"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from models import CollectionCard, Deck, DeckCard  # noqa: ensure models are registered
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

HEREDOC_EOF

mkdir -p "backend"
cat > 'backend/main.py' << 'HEREDOC_EOF'
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from db import init_db
from scryfall.bulk import ensure_bulk_data_fresh
from scryfall.store import card_store
from routers import cards, collection, decks, system

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting MTG Local Manager...")
    await init_db()
    await ensure_bulk_data_fresh()
    await card_store.load()
    logger.info(f"Card store loaded: {len(card_store.cards_by_id)} cards")
    yield
    logger.info("Shutting down...")


app = FastAPI(title="MTG Local Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(collection.router, prefix="/api/collection", tags=["collection"])
app.include_router(decks.router, prefix="/api/decks", tags=["decks"])
app.include_router(system.router, prefix="/api/system", tags=["system"])

# Serve React frontend in production (when dist/ exists)
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        index = os.path.join(frontend_dist, "index.html")
        return FileResponse(index)

HEREDOC_EOF

mkdir -p "backend"
cat > 'backend/models.py' << 'HEREDOC_EOF'
from datetime import datetime
from sqlalchemy import Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db import Base


class CollectionCard(Base):
    __tablename__ = "collection_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scryfall_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    oracle_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    set_code: Mapped[str] = mapped_column(String)
    collector_number: Mapped[str] = mapped_column(String)
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    foil_quantity: Mapped[int] = mapped_column(Integer, default=0)
    condition: Mapped[str] = mapped_column(String, default="NM")


class Deck(Base):
    __tablename__ = "decks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    format: Mapped[str] = mapped_column(String, default="commander")
    description: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=func.now(), onupdate=func.now())

    cards: Mapped[list["DeckCard"]] = relationship("DeckCard", back_populates="deck", cascade="all, delete-orphan")


class DeckCard(Base):
    __tablename__ = "deck_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    deck_id: Mapped[int] = mapped_column(Integer, ForeignKey("decks.id"), index=True)
    oracle_id: Mapped[str] = mapped_column(String, index=True)
    scryfall_id: Mapped[str] = mapped_column(String, nullable=True)  # preferred printing
    name: Mapped[str] = mapped_column(String)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    board: Mapped[str] = mapped_column(String, default="mainboard")  # mainboard/sideboard/maybeboard

    deck: Mapped["Deck"] = relationship("Deck", back_populates="cards")

HEREDOC_EOF

mkdir -p "backend"
cat > 'backend/requirements.txt' << 'HEREDOC_EOF'
fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy==2.0.35
aiosqlite==0.20.0
httpx==0.27.2
orjson==3.10.7
pydantic==2.9.2

HEREDOC_EOF

mkdir -p "backend/routers"
cat > 'backend/routers/__init__.py' << 'HEREDOC_EOF'

HEREDOC_EOF

mkdir -p "backend/routers"
cat > 'backend/routers/cards.py' << 'HEREDOC_EOF'
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
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


@router.get("/{scryfall_id}")
async def get_card(scryfall_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single card by Scryfall ID from the local bulk store."""
    card = card_store.get_by_id(scryfall_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    annotated = await annotate_cards([card], db)
    return annotated[0]

HEREDOC_EOF

mkdir -p "backend/routers"
cat > 'backend/routers/collection.py' << 'HEREDOC_EOF'
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


class UpsertCollectionCard(BaseModel):
    scryfall_id: str
    quantity: int = 0
    foil_quantity: int = 0
    condition: str = "NM"


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

HEREDOC_EOF

mkdir -p "backend/routers"
cat > 'backend/routers/decks.py' << 'HEREDOC_EOF'
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from db import get_db
from models import Deck, DeckCard, CollectionCard
from scryfall.store import card_store
from scryfall.annotate import annotate_cards

router = APIRouter()

FORMATS = ["commander", "modern", "standard", "legacy", "vintage", "pioneer",
           "pauper", "draft", "sealed", "custom"]
BOARDS = ["mainboard", "sideboard", "maybeboard"]


class CreateDeck(BaseModel):
    name: str
    format: str = "commander"
    description: str = ""


class UpsertDeckCard(BaseModel):
    oracle_id: str | None = None
    scryfall_id: str | None = None
    name: str
    quantity: int = 1
    board: str = "mainboard"


class MoveCard(BaseModel):
    oracle_id: str
    from_board: str
    to_board: str


class ImportDecklist(BaseModel):
    text: str
    board: str = "mainboard"


@router.get("")
async def list_decks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Deck).order_by(Deck.updated_at.desc()))
    decks = result.scalars().all()
    return {"data": [
        {
            "id": d.id, "name": d.name, "format": d.format,
            "description": d.description,
            "created_at": d.created_at, "updated_at": d.updated_at,
        }
        for d in decks
    ]}


@router.post("")
async def create_deck(body: CreateDeck, db: AsyncSession = Depends(get_db)):
    deck = Deck(name=body.name, format=body.format, description=body.description)
    db.add(deck)
    await db.commit()
    await db.refresh(deck)
    return {"id": deck.id, "name": deck.name}


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

    mainboard = [c for c in cards_out if c["board"] == "mainboard"]
    sideboard = [c for c in cards_out if c["board"] == "sideboard"]
    missing = [
        c for c in mainboard
        if c.get("_ownership", {}).get("available", 0) < c["quantity"]
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
            "total_cards": sum(c["quantity"] for c in mainboard),
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


@router.delete("/{deck_id}")
async def delete_deck(deck_id: int, db: AsyncSession = Depends(get_db)):
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

    if existing:
        existing.quantity = body.quantity
        existing.scryfall_id = scryfall_id or existing.scryfall_id
    else:
        db.add(DeckCard(
            deck_id=deck_id,
            oracle_id=oracle_id,
            scryfall_id=scryfall_id,
            name=body.name,
            quantity=body.quantity,
            board=body.board,
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
    else:
        db.add(DeckCard(
            deck_id=deck_id,
            oracle_id=src.oracle_id,
            scryfall_id=src.scryfall_id,
            name=src.name,
            quantity=src.quantity,
            board=body.to_board,
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
        available = ownership.get("available", 0)
        needed = card["quantity"]
        if available < needed:
            missing.append({
                **card,
                "need_to_acquire": needed - available,
            })
    return {"data": missing, "total": len(missing)}


@router.post("/{deck_id}/import")
async def import_decklist(deck_id: int, body: ImportDecklist, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Deck).where(Deck.id == deck_id))
    deck = result.scalar_one_or_none()
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    imported, failed = [], []
    lines = [l.strip() for l in body.text.strip().splitlines() if l.strip()]

    for line in lines:
        if line.startswith("//") or line.startswith("#"):
            continue

        match = re.match(r"^(\d+)x?\s+(.+?)(?:\s+\([A-Z0-9]+\)\s+\d+)?$", line, re.IGNORECASE)
        if not match:
            failed.append({"line": line, "reason": "Could not parse"})
            continue

        qty = int(match.group(1))
        name = match.group(2).strip()

        oracle_id, scryfall_id = None, None
        for c in card_store.cards_by_oracle.values():
            if c.get("name", "").lower() == name.lower():
                oracle_id = c.get("oracle_id")
                scryfall_id = c.get("id")
                break

        if not oracle_id:
            failed.append({"line": line, "reason": f"Card '{name}' not found"})
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

HEREDOC_EOF

mkdir -p "backend/routers"
cat > 'backend/routers/system.py' << 'HEREDOC_EOF'
from fastapi import APIRouter, BackgroundTasks, HTTPException
from scryfall.bulk import ensure_bulk_data_fresh, get_bulk_meta
from scryfall.store import card_store

router = APIRouter()

# Simple in-process sync state
_sync_state = {"syncing": False, "last_error": None}


@router.get("/bulk-status")
async def bulk_status():
    meta = get_bulk_meta()
    return {
        "cards_loaded": len(card_store.cards_by_id),
        "unique_oracle_cards": len(card_store.cards_by_oracle),
        "syncing": _sync_state["syncing"],
        "last_error": _sync_state["last_error"],
        **meta,
    }


@router.post("/bulk-refresh")
async def bulk_refresh(background_tasks: BackgroundTasks):
    """Trigger a re-download of Scryfall bulk data in the background."""
    if _sync_state["syncing"]:
        raise HTTPException(status_code=409, detail="Sync already in progress")

    async def do_refresh():
        from pathlib import Path
        import os
        _sync_state["syncing"] = True
        _sync_state["last_error"] = None
        try:
            meta_file = Path(os.environ.get("DATA_DIR", "/data")) / "bulk_meta.json"
            if meta_file.exists():
                meta_file.unlink()
            await ensure_bulk_data_fresh()
            await card_store.load()
        except Exception as e:
            _sync_state["last_error"] = str(e)
        finally:
            _sync_state["syncing"] = False

    background_tasks.add_task(do_refresh)
    return {"status": "sync started"}

HEREDOC_EOF

mkdir -p "backend/scryfall"
cat > 'backend/scryfall/__init__.py' << 'HEREDOC_EOF'

HEREDOC_EOF

mkdir -p "backend/scryfall"
cat > 'backend/scryfall/annotate.py' << 'HEREDOC_EOF'
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

HEREDOC_EOF

mkdir -p "backend/scryfall"
cat > 'backend/scryfall/bulk.py' << 'HEREDOC_EOF'
import os
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", "/data")
BULK_META_FILE = Path(DATA_DIR) / "bulk_meta.json"
BULK_CARDS_FILE = Path(DATA_DIR) / "default_cards.json"
STALENESS_DAYS = 7

HEADERS = {
    "User-Agent": "MTGLocalManager/1.0",
    "Accept": "application/json",
}


async def ensure_bulk_data_fresh():
    """Download Scryfall bulk data if missing or older than STALENESS_DAYS."""
    if _is_fresh():
        logger.info("Bulk card data is fresh, skipping download.")
        return

    logger.info("Bulk card data is stale or missing. Downloading...")
    await _download_bulk_data()


def _is_fresh() -> bool:
    if not BULK_CARDS_FILE.exists() or not BULK_META_FILE.exists():
        return False
    meta = json.loads(BULK_META_FILE.read_text())
    downloaded_at = datetime.fromisoformat(meta["downloaded_at"])
    return datetime.utcnow() - downloaded_at < timedelta(days=STALENESS_DAYS)


async def _download_bulk_data():
    async with httpx.AsyncClient(headers=HEADERS, timeout=60.0) as client:
        # Step 1: Get the bulk data manifest to find the download URL
        logger.info("Fetching Scryfall bulk data manifest...")
        resp = await client.get("https://api.scryfall.com/bulk-data")
        resp.raise_for_status()
        bulk_list = resp.json()["data"]

        default_cards = next(b for b in bulk_list if b["type"] == "default_cards")
        download_uri = default_cards["download_uri"]
        logger.info(f"Downloading {default_cards['size'] // 1_000_000}MB from {download_uri}")

        # Step 2: Delete old file before downloading new one
        if BULK_CARDS_FILE.exists():
            logger.info("Deleting old bulk card data...")
            BULK_CARDS_FILE.unlink()

        # Step 3: Stream download the file
        async with client.stream("GET", download_uri) as stream:
            stream.raise_for_status()
            with open(BULK_CARDS_FILE, "wb") as f:
                async for chunk in stream.aiter_bytes(chunk_size=65536):
                    f.write(chunk)

    # Save metadata
    BULK_META_FILE.write_text(json.dumps({
        "downloaded_at": datetime.utcnow().isoformat(),
        "updated_at": default_cards["updated_at"],
        "size": default_cards["size"],
    }))
    logger.info("Bulk data download complete.")


def get_bulk_meta() -> dict:
    if BULK_META_FILE.exists():
        return json.loads(BULK_META_FILE.read_text())
    return {}

HEREDOC_EOF

mkdir -p "backend/scryfall"
cat > 'backend/scryfall/search.py' << 'HEREDOC_EOF'
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "MTGLocalManager/1.0",
    "Accept": "application/json",
}

_client: httpx.AsyncClient | None = None


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

HEREDOC_EOF

mkdir -p "backend/scryfall"
cat > 'backend/scryfall/store.py' << 'HEREDOC_EOF'
import json
import logging
import os
from pathlib import Path

import orjson

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", "/data")
BULK_CARDS_FILE = Path(DATA_DIR) / "default_cards.json"


class CardStore:
    def __init__(self):
        self.cards_by_id: dict[str, dict] = {}       # scryfall_id → card
        self.cards_by_oracle: dict[str, dict] = {}    # oracle_id → first/best printing

    async def load(self):
        if not BULK_CARDS_FILE.exists():
            logger.warning("Bulk cards file not found, store is empty.")
            return

        logger.info("Loading card store into memory...")
        with open(BULK_CARDS_FILE, "rb") as f:
            cards = orjson.loads(f.read())

        for card in cards:
            sid = card.get("id")
            oid = card.get("oracle_id")
            if sid:
                self.cards_by_id[sid] = card
            if oid and oid not in self.cards_by_oracle:
                self.cards_by_oracle[oid] = card

        logger.info(f"Loaded {len(self.cards_by_id)} printings, {len(self.cards_by_oracle)} unique oracle cards.")

    def get_by_id(self, scryfall_id: str) -> dict | None:
        return self.cards_by_id.get(scryfall_id)

    def get_by_oracle(self, oracle_id: str) -> dict | None:
        return self.cards_by_oracle.get(oracle_id)

    def get_image_uri(self, card: dict, face: str = "front") -> str | None:
        """Extract image URI handling DFCs."""
        if "image_uris" in card:
            return card["image_uris"].get("normal")
        faces = card.get("card_faces", [])
        if faces:
            idx = 1 if face == "back" and len(faces) > 1 else 0
            return faces[idx].get("image_uris", {}).get("normal")
        return None


card_store = CardStore()

HEREDOC_EOF

mkdir -p "frontend"
cat > 'frontend/index.html' << 'HEREDOC_EOF'
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MTG Local Manager</title>
  </head>
  <body class="bg-mtg-bg text-gray-100 min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>

HEREDOC_EOF

mkdir -p "frontend"
cat > 'frontend/package.json' << 'HEREDOC_EOF'
{
  "name": "mtg-local-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "@tanstack/react-query": "^5.56.2",
    "axios": "^1.7.7",
    "clsx": "^2.1.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.12",
    "typescript": "^5.5.3",
    "vite": "^5.4.8"
  }
}

HEREDOC_EOF

mkdir -p "frontend"
cat > 'frontend/postcss.config.js' << 'HEREDOC_EOF'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}

HEREDOC_EOF

mkdir -p "frontend"
cat > 'frontend/tailwind.config.js' << 'HEREDOC_EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        mtg: {
          bg: '#1a1a2e',
          surface: '#16213e',
          card: '#0f3460',
          accent: '#e94560',
          gold: '#c9a84c',
        }
      }
    }
  },
  plugins: [],
}

HEREDOC_EOF

mkdir -p "frontend"
cat > 'frontend/tsconfig.json' << 'HEREDOC_EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}

HEREDOC_EOF

mkdir -p "frontend"
cat > 'frontend/tsconfig.node.json' << 'HEREDOC_EOF'
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}

HEREDOC_EOF

mkdir -p "frontend"
cat > 'frontend/vite.config.ts' << 'HEREDOC_EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})

HEREDOC_EOF

mkdir -p "frontend/src"
cat > 'frontend/src/App.tsx' << 'HEREDOC_EOF'
import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import SearchPage from './pages/Search'
import CollectionPage from './pages/Collection'
import DecksPage from './pages/Decks'
import DeckDetail from './pages/DeckDetail'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/search" replace />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/collection" element={<CollectionPage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/decks/:id" element={<DeckDetail />} />
        </Routes>
      </main>
    </div>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src"
cat > 'frontend/src/api.ts' << 'HEREDOC_EOF'
import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export default api

// Cards
export const autocompleteCards = (q: string, limit = 20) =>
  api.get('/cards/autocomplete', { params: { q, limit } }).then(r => r.data)

export const searchCards = (q: string, page = 1, order = 'name') =>
  api.get('/cards/search', { params: { q, page, order } }).then(r => r.data)

// Collection
export const getCollection = () =>
  api.get('/collection').then(r => r.data)

export const upsertCollectionCard = (data: {
  scryfall_id: string
  quantity: number
  foil_quantity: number
  condition: string
}) => api.post('/collection', data).then(r => r.data)

export const deleteCollectionCard = (scryfall_id: string) =>
  api.delete(`/collection/${scryfall_id}`).then(r => r.data)

// Decks
export const getDecks = () =>
  api.get('/decks').then(r => r.data)

export const createDeck = (data: { name: string; format: string; description: string }) =>
  api.post('/decks', data).then(r => r.data)

export const getDeck = (id: number) =>
  api.get(`/decks/${id}`).then(r => r.data)

export const updateDeck = (id: number, data: { name: string; format: string; description: string }) =>
  api.put(`/decks/${id}`, data).then(r => r.data)

export const deleteDeck = (id: number) =>
  api.delete(`/decks/${id}`).then(r => r.data)

export const upsertDeckCard = (deckId: number, data: {
  name: string
  oracle_id?: string
  scryfall_id?: string
  quantity: number
  board: string
}) => api.post(`/decks/${deckId}/cards`, data).then(r => r.data)

export const removeDeckCard = (deckId: number, oracleId: string, board = 'mainboard') =>
  api.delete(`/decks/${deckId}/cards/${oracleId}`, { params: { board } }).then(r => r.data)
export const moveCard = (deckId: number, data: {
  oracle_id: string
  from_board: string
  to_board: string
}) => api.post(`/decks/${deckId}/cards/move`, data).then(r => r.data)

export const getMissingCards = (deckId: number) =>
  api.get(`/decks/${deckId}/missing`).then(r => r.data)

export const importDecklist = (deckId: number, text: string, board = 'mainboard') =>
  api.post(`/decks/${deckId}/import`, { text, board }).then(r => r.data)

// System
export const getBulkStatus = () =>
  api.get('/system/bulk-status').then(r => r.data)

export const triggerBulkRefresh = () =>
  api.post('/system/bulk-refresh').then(r => r.data)

HEREDOC_EOF

mkdir -p "frontend/src"
cat > 'frontend/src/index.css' << 'HEREDOC_EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-mtg-bg text-gray-100;
  }
}

@layer components {
  .card-hover {
    @apply transition-transform duration-150 hover:scale-105 hover:z-10;
  }
  .btn {
    @apply px-4 py-2 rounded font-medium transition-colors duration-150 cursor-pointer;
  }
  .btn-primary {
    @apply btn bg-mtg-accent hover:bg-red-500 text-white;
  }
  .btn-secondary {
    @apply btn bg-mtg-card hover:bg-blue-800 text-gray-100;
  }
  .input {
    @apply bg-mtg-surface border border-gray-600 rounded px-3 py-2 text-gray-100
           placeholder-gray-500 focus:outline-none focus:border-mtg-accent w-full;
  }
}

HEREDOC_EOF

mkdir -p "frontend/src"
cat > 'frontend/src/main.tsx' << 'HEREDOC_EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
)

HEREDOC_EOF

mkdir -p "frontend/src"
cat > 'frontend/src/types.ts' << 'HEREDOC_EOF'
export interface Ownership {
  owned: number
  owned_normal: number
  owned_foil: number
  in_use: number
  available: number
  decks: { deck_id: number; deck_name: string; quantity: number }[]
}

export interface ScryfallCard {
  id: string
  oracle_id: string
  name: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  colors?: string[]
  image_uris?: { normal: string; small: string; art_crop: string }
  card_faces?: { name: string; image_uris?: { normal: string } }[]
  set: string
  set_name: string
  collector_number: string
  prices?: { usd?: string; usd_foil?: string }
  _ownership?: Ownership
}

export interface CollectionEntry {
  id: number
  scryfall_id: string
  oracle_id: string
  name: string
  set_code: string
  collector_number: string
  quantity: number
  foil_quantity: number
  condition: string
  image_uri?: string
  prices?: { usd?: string; usd_foil?: string }
  set_name: string
  _ownership?: Ownership
}

export interface Deck {
  id: number
  name: string
  format: string
  description: string
  created_at: string
  updated_at: string
}

export interface DeckCard {
  id: number
  oracle_id: string
  scryfall_id?: string
  name: string
  quantity: number
  board: string
  image_uri?: string
  mana_cost?: string
  type_line?: string
  cmc?: number
  colors?: string[]
  prices?: { usd?: string }
  _ownership?: Ownership
}

export interface DeckDetail extends Deck {
  cards: DeckCard[]
  stats: {
    total_cards: number
    missing_cards: number
    total_price: number
  }
}

HEREDOC_EOF

mkdir -p "frontend/src/components"
cat > 'frontend/src/components/AddToCollectionModal.tsx' << 'HEREDOC_EOF'
import { useState } from 'react'
import type { ScryfallCard } from '../types'
import { upsertCollectionCard } from '../api'
import { useQueryClient } from '@tanstack/react-query'

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG']

interface Props {
  card: ScryfallCard
  onClose: () => void
}

export default function AddToCollectionModal({ card, onClose }: Props) {
  const qc = useQueryClient()
  const [qty, setQty] = useState(1)
  const [foilQty, setFoilQty] = useState(0)
  const [condition, setCondition] = useState('NM')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await upsertCollectionCard({ scryfall_id: card.id, quantity: qty, foil_quantity: foilQty, condition })
      qc.invalidateQueries({ queryKey: ['collection'] })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-mtg-surface rounded-xl p-6 w-80 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{card.name}</h2>
        <div className="text-sm text-gray-400">{card.set_name} · #{card.collector_number}</div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-gray-400">Regular qty</span>
            <input type="number" min={0} value={qty} onChange={e => setQty(+e.target.value)} className="input" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-gray-400">Foil qty</span>
            <input type="number" min={0} value={foilQty} onChange={e => setFoilQty(+e.target.value)} className="input" />
          </label>
        </div>

        <label className="space-y-1 block">
          <span className="text-xs text-gray-400">Condition</span>
          <select value={condition} onChange={e => setCondition(e.target.value)} className="input">
            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary flex-1">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/components"
cat > 'frontend/src/components/CardAutocomplete.tsx' << 'HEREDOC_EOF'
import { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import { autocompleteCards } from '../api'
import type { ScryfallCard } from '../types'
import OwnershipBadge from './OwnershipBadge'

interface Props {
  placeholder?: string
  onSelect: (card: ScryfallCard) => void
  autoFocus?: boolean
  clearOnSelect?: boolean
  className?: string
  // If provided, renders as an inline input without absolute positioning
  inline?: boolean
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function ManaSymbol({ cost }: { cost?: string }) {
  if (!cost) return null
  // Render mana cost as colored text badges
  const symbols = cost.replace(/[{}]/g, ' ').trim().split(' ').filter(Boolean)
  const colorMap: Record<string, string> = {
    W: 'bg-yellow-100 text-yellow-900',
    U: 'bg-blue-500 text-white',
    B: 'bg-gray-800 text-white',
    R: 'bg-red-600 text-white',
    G: 'bg-green-600 text-white',
    C: 'bg-gray-400 text-gray-900',
  }
  return (
    <span className="flex gap-0.5 items-center">
      {symbols.map((s, i) => (
        <span key={i} className={clsx(
          'text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none',
          colorMap[s] ?? 'bg-gray-600 text-white'
        )}>
          {s}
        </span>
      ))}
    </span>
  )
}

export default function CardAutocomplete({
  placeholder = 'Search cards by name...',
  onSelect,
  autoFocus = false,
  clearOnSelect = false,
  className,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScryfallCard[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 150)

  // Fetch results when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim().length === 0) {
      setResults([])
      setOpen(false)
      return
    }
    let cancelled = false
    setLoading(true)
    autocompleteCards(debouncedQuery.trim())
      .then(res => {
        if (!cancelled) {
          setResults(res.data ?? [])
          setHighlighted(0)
          setOpen(true)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedQuery])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = useCallback((card: ScryfallCard) => {
    onSelect(card)
    if (clearOnSelect) {
      setQuery('')
      setResults([])
    } else {
      setQuery(card.name)
    }
    setOpen(false)
  }, [onSelect, clearOnSelect])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[highlighted]) handleSelect(results[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="input pr-8"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs animate-spin">
            ↻
          </span>
        )}
        {!loading && query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setOpen(false); inputRef.current?.focus() }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 top-full mt-1 left-0 right-0 bg-mtg-surface border border-gray-600
                     rounded-lg shadow-2xl max-h-96 overflow-y-auto"
        >
          {results.map((card, i) => (
            <li
              key={card.oracle_id}
              onMouseDown={() => handleSelect(card)}
              onMouseEnter={() => setHighlighted(i)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                i === highlighted ? 'bg-mtg-card' : 'hover:bg-mtg-card/50'
              )}
            >
              {/* Tiny card image */}
              {card.image_uris?.normal || (card.card_faces?.[0]?.image_uris?.normal) ? (
                <img
                  src={card.image_uris?.normal ?? card.card_faces![0].image_uris!.normal}
                  alt=""
                  className="w-8 h-11 rounded object-cover flex-shrink-0"
                  loading="lazy"
                />
              ) : (
                <div className="w-8 h-11 rounded bg-mtg-card flex-shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{card.name}</span>
                  <ManaSymbol cost={card.mana_cost} />
                </div>
                <div className="text-xs text-gray-500 truncate">{card.type_line}</div>
              </div>

              <div className="flex-shrink-0 text-right space-y-0.5">
                {card.prices?.usd && (
                  <div className="text-xs text-mtg-gold">${card.prices.usd}</div>
                )}
                <OwnershipBadge ownership={card._ownership} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && query.length > 0 && results.length === 0 && !loading && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-mtg-surface border border-gray-600
                        rounded-lg shadow-xl px-4 py-3 text-sm text-gray-500">
          No cards found for "{query}"
        </div>
      )}
    </div>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/components"
cat > 'frontend/src/components/CardTile.tsx' << 'HEREDOC_EOF'
import { useState } from 'react'
import type { ScryfallCard } from '../types'
import OwnershipBadge from './OwnershipBadge'

interface Props {
  card: ScryfallCard
  onAdd?: (card: ScryfallCard) => void
  actionLabel?: string
  neededQty?: number
}

function getImageUri(card: ScryfallCard): string | null {
  if (card.image_uris?.normal) return card.image_uris.normal
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal
  return null
}

export default function CardTile({ card, onAdd, actionLabel = 'Add', neededQty = 1 }: Props) {
  const [flipped, setFlipped] = useState(false)
  const isDFC = (card.card_faces?.length ?? 0) >= 2

  const imageUri = isDFC && flipped
    ? card.card_faces![1]?.image_uris?.normal
    : getImageUri(card)

  return (
    <div className="relative group w-[180px] flex-shrink-0">
      <div className="card-hover rounded-lg overflow-hidden bg-mtg-surface">
        {imageUri ? (
          <img src={imageUri} alt={card.name} className="w-full rounded-lg" loading="lazy" />
        ) : (
          <div className="w-full aspect-[5/7] bg-mtg-card flex items-center justify-center rounded-lg">
            <span className="text-sm text-gray-400 text-center px-2">{card.name}</span>
          </div>
        )}
      </div>

      {/* Overlay on hover */}
      <div className="absolute inset-0 rounded-lg bg-black/70 opacity-0 group-hover:opacity-100
                      transition-opacity flex flex-col justify-between p-2">
        <div className="flex justify-between items-start">
          {isDFC && (
            <button onClick={() => setFlipped(v => !v)}
              className="text-xs bg-gray-700 hover:bg-gray-600 rounded px-1.5 py-0.5">
              ↔ Flip
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {card.set?.toUpperCase()} #{card.collector_number}
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold text-white leading-tight">{card.name}</div>
          <div className="text-xs text-gray-400">{card.type_line}</div>
          {card.prices?.usd && (
            <div className="text-xs text-mtg-gold">${card.prices.usd}</div>
          )}
          <OwnershipBadge ownership={card._ownership} needed={neededQty} />
          {onAdd && (
            <button onClick={() => onAdd(card)} className="btn-primary w-full text-xs mt-1">
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/components"
cat > 'frontend/src/components/Navbar.tsx' << 'HEREDOC_EOF'
import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { getBulkStatus, triggerBulkRefresh } from '../api'
import SearchBar from './SearchBar'

const nav = [
  { to: '/collection', label: '📦 Collection' },
  { to: '/decks', label: '🃏 Decks' },
  { to: '/search', label: '⚙ Advanced' },
]

export default function Navbar() {
  const { pathname } = useLocation()
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    getBulkStatus().then((s: any) => {
      setSyncing(s.syncing)
      setLastSynced(s.downloaded_at ?? null)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (syncing) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await getBulkStatus()
          setSyncing(s.syncing)
          setLastSynced(s.downloaded_at ?? null)
          if (s.last_error) setSyncError(s.last_error)
          if (!s.syncing) clearInterval(pollRef.current!)
        } catch {}
      }, 2000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [syncing])

  async function handleSync() {
    setSyncError(null)
    try {
      await triggerBulkRefresh()
      setSyncing(true)
    } catch (e: any) {
      setSyncError(e?.response?.data?.detail ?? 'Sync failed')
    }
  }

  const formattedDate = lastSynced
    ? new Date(lastSynced).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <nav className="bg-mtg-surface border-b border-gray-700 px-4 py-2.5 flex items-center gap-4">
      <Link to="/" className="font-bold text-mtg-gold text-lg tracking-wide flex-shrink-0">
        ⚔ MTG Local
      </Link>

      {nav.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className={clsx(
            'text-sm font-medium transition-colors flex-shrink-0',
            pathname.startsWith(to)
              ? 'text-white border-b-2 border-mtg-accent pb-0.5'
              : 'text-gray-400 hover:text-white'
          )}
        >
          {label}
        </Link>
      ))}

      {/* Unified search bar — grows to fill available space */}
      <div className="flex-1 max-w-lg mx-2">
        <SearchBar />
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {syncError && (
          <span className="text-xs text-red-400" title={syncError}>⚠ Sync failed</span>
        )}
        {formattedDate && !syncing && (
          <span className="text-xs text-gray-500 hidden lg:block">DB: {formattedDate}</span>
        )}
        <button
          onClick={handleSync}
          disabled={syncing}
          title={syncing ? 'Syncing card database...' : 'Download latest Scryfall card data'}
          className={clsx(
            'btn text-xs flex items-center gap-1.5',
            syncing
              ? 'bg-mtg-card text-gray-400 cursor-not-allowed'
              : 'bg-mtg-card hover:bg-blue-800 text-gray-200'
          )}
        >
          <span className={clsx('inline-block', syncing && 'animate-spin')}>↻</span>
          {syncing ? 'Syncing...' : 'Sync Cards'}
        </button>
      </div>
    </nav>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/components"
cat > 'frontend/src/components/OwnershipBadge.tsx' << 'HEREDOC_EOF'
import { useState } from 'react'
import type { Ownership } from '../types'
import clsx from 'clsx'

interface Props {
  ownership?: Ownership
  needed?: number // quantity needed by current deck
}

export default function OwnershipBadge({ ownership, needed = 1 }: Props) {
  const [showPopover, setShowPopover] = useState(false)

  if (!ownership) return null

  const { owned, in_use, available, decks } = ownership
  if (owned === 0) return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
      not owned
    </span>
  )

  const sufficient = available >= needed
  const partial = available > 0 && available < needed

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShowPopover(v => !v)}
        className={clsx(
          'text-xs px-2 py-0.5 rounded font-mono flex gap-1 items-center',
          sufficient ? 'bg-green-900/60 text-green-300' :
          partial    ? 'bg-yellow-900/60 text-yellow-300' :
                       'bg-red-900/60 text-red-300'
        )}
      >
        <span title="Owned">⬡ {owned}</span>
        {in_use > 0 && <span title="In use" className="text-gray-400">· {in_use} used</span>}
        <span title="Available">· {available} free</span>
      </button>

      {showPopover && decks.length > 0 && (
        <div className="absolute z-50 bottom-full mb-1 left-0 bg-mtg-surface border border-gray-600
                        rounded shadow-xl p-2 min-w-48 text-xs">
          <div className="font-semibold text-gray-300 mb-1">In decks:</div>
          {decks.map(d => (
            <div key={d.deck_id} className="flex justify-between gap-4 text-gray-400">
              <span>{d.deck_name}</span>
              <span>×{d.quantity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/components"
cat > 'frontend/src/components/SearchBar.tsx' << 'HEREDOC_EOF'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { autocompleteCards } from '../api'
import type { ScryfallCard } from '../types'
import OwnershipBadge from './OwnershipBadge'
import AddToCollectionModal from './AddToCollectionModal'

// ─── Debounce hook ────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ─── Mana pip renderer ────────────────────────────────────────────────────────
function ManaCost({ cost }: { cost?: string }) {
  if (!cost) return null
  const symbols = cost.replace(/[{}]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const colorMap: Record<string, string> = {
    W: 'bg-yellow-100 text-yellow-900',
    U: 'bg-blue-500 text-white',
    B: 'bg-gray-800 text-white border border-gray-600',
    R: 'bg-red-600 text-white',
    G: 'bg-green-600 text-white',
  }
  return (
    <span className="flex gap-0.5 items-center flex-shrink-0">
      {symbols.map((s, i) => (
        <span key={i} className={clsx(
          'text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none flex-shrink-0',
          colorMap[s] ?? 'bg-gray-600 text-white'
        )}>{s}</span>
      ))}
    </span>
  )
}

type Mode = 'name' | 'scryfall'

// ─── Main component ───────────────────────────────────────────────────────────
export default function SearchBar() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('name')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ScryfallCard[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [addTarget, setAddTarget] = useState<ScryfallCard | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedQuery = useDebounce(query, 150)

  // ── Global keyboard shortcut: ⌘K / Ctrl+K to focus ──────────────────────
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [])

  // ── Fetch autocomplete results (name mode only) ──────────────────────────
  useEffect(() => {
    if (mode !== 'name' || debouncedQuery.trim().length === 0) {
      setResults([])
      setOpen(mode === 'name' ? false : open)
      return
    }
    let cancelled = false
    setLoading(true)
    autocompleteCards(debouncedQuery.trim())
      .then(res => {
        if (!cancelled) {
          setResults(res.data ?? [])
          setHighlighted(0)
          setOpen(true)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedQuery, mode])

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Scroll highlighted item into view ─────────────────────────────────────
  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const selectCard = useCallback((card: ScryfallCard) => {
    setAddTarget(card)
    setQuery('')
    setResults([])
    setOpen(false)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (mode === 'scryfall') {
      if (e.key === 'Enter' && query.trim()) {
        navigate(`/search?q=${encodeURIComponent(query.trim())}`)
        setQuery('')
        setOpen(false)
        inputRef.current?.blur()
      }
      return
    }

    // Name mode keyboard nav
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[highlighted]) selectCard(results[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  function toggleMode(m: Mode) {
    setMode(m)
    setQuery('')
    setResults([])
    setOpen(false)
    // Small delay so input re-renders placeholder before focus
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const placeholder = mode === 'name'
    ? 'Card name...  (⌘K)'
    : 'Scryfall query...  e.g. t:dragon c:red  (⌘K)'

  return (
    <>
      <div ref={containerRef} className="relative flex items-center w-full">
        {/* Mode toggle */}
        <div className="flex-shrink-0 flex rounded-l-md overflow-hidden border border-r-0 border-gray-600 text-xs font-medium">
          <button
            onClick={() => toggleMode('name')}
            className={clsx(
              'px-2.5 py-2 transition-colors',
              mode === 'name'
                ? 'bg-mtg-accent text-white'
                : 'bg-mtg-card text-gray-400 hover:text-white hover:bg-gray-700'
            )}
          >
            Name
          </button>
          <button
            onClick={() => toggleMode('scryfall')}
            className={clsx(
              'px-2.5 py-2 transition-colors',
              mode === 'scryfall'
                ? 'bg-mtg-accent text-white'
                : 'bg-mtg-card text-gray-400 hover:text-white hover:bg-gray-700'
            )}
          >
            Scryfall
          </button>
        </div>

        {/* Input */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => mode === 'name' && results.length > 0 && setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className={clsx(
              'w-full bg-mtg-surface border border-gray-600 rounded-r-md',
              'px-3 py-2 text-sm text-gray-100 placeholder-gray-600',
              'focus:outline-none focus:border-mtg-accent transition-colors',
              'pr-16'
            )}
          />

          {/* Right-side hints */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {loading && <span className="text-gray-500 text-xs animate-spin">↻</span>}
            {!loading && query && (
              <button
                onMouseDown={e => { e.preventDefault(); setQuery(''); setResults([]); setOpen(false) }}
                className="text-gray-500 hover:text-gray-300 text-xs"
              >✕</button>
            )}
            {mode === 'scryfall' && query.trim() && (
              <kbd className="text-xs text-gray-500 hidden sm:block">↵</kbd>
            )}
          </div>
        </div>

        {/* Name mode dropdown */}
        {mode === 'name' && open && (
          <ul
            ref={listRef}
            className="absolute z-50 top-full mt-1 left-0 right-0 bg-mtg-surface border border-gray-600
                       rounded-lg shadow-2xl max-h-96 overflow-y-auto"
          >
            {results.length > 0
              ? results.map((card, i) => (
                  <li
                    key={card.oracle_id}
                    onMouseDown={() => selectCard(card)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
                      i === highlighted ? 'bg-mtg-card' : 'hover:bg-mtg-card/50'
                    )}
                  >
                    {/* Mini card art */}
                    {(card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal) ? (
                      <img
                        src={card.image_uris?.normal ?? card.card_faces![0].image_uris!.normal}
                        alt=""
                        className="w-8 h-11 rounded object-cover flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-8 h-11 rounded bg-mtg-card flex-shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{card.name}</span>
                        <ManaCost cost={card.mana_cost} />
                      </div>
                      <div className="text-xs text-gray-500 truncate">{card.type_line}</div>
                    </div>

                    <div className="flex-shrink-0 text-right space-y-0.5">
                      {card.prices?.usd && (
                        <div className="text-xs text-mtg-gold">${card.prices.usd}</div>
                      )}
                      <OwnershipBadge ownership={card._ownership} />
                    </div>
                  </li>
                ))
              : (
                <li className="px-4 py-3 text-sm text-gray-500">
                  No cards found for "{query}"
                </li>
              )
            }
          </ul>
        )}

        {/* Scryfall mode hint */}
        {mode === 'scryfall' && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-mtg-surface border border-gray-600
                          rounded-lg shadow-xl px-4 py-2.5 text-xs text-gray-500 flex items-center justify-between">
            <span>Press <kbd className="bg-mtg-card px-1.5 py-0.5 rounded text-gray-300">↵</kbd> to search</span>
            <a
              href="https://scryfall.com/docs/syntax"
              target="_blank"
              rel="noreferrer"
              className="text-mtg-accent hover:underline"
              onMouseDown={e => e.stopPropagation()}
            >
              Syntax guide ↗
            </a>
          </div>
        )}
      </div>

      {addTarget && (
        <AddToCollectionModal card={addTarget} onClose={() => setAddTarget(null)} />
      )}
    </>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/pages"
cat > 'frontend/src/pages/Collection.tsx' << 'HEREDOC_EOF'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCollection, deleteCollectionCard } from '../api'
import type { CollectionEntry } from '../types'
import OwnershipBadge from '../components/OwnershipBadge'

export default function CollectionPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['collection'], queryFn: getCollection })

  const removeMutation = useMutation({
    mutationFn: (sid: string) => deleteCollectionCard(sid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  })

  const cards: CollectionEntry[] = data?.data ?? []
  const filtered = cards.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  const totalCards = cards.reduce((s, c) => s + c.quantity + c.foil_quantity, 0)
  const totalValue = cards.reduce((s, c) => {
    const price = parseFloat(c.prices?.usd ?? '0')
    const foilPrice = parseFloat(c.prices?.usd_foil ?? '0')
    return s + price * c.quantity + foilPrice * c.foil_quantity
  }, 0)

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Collection</h1>
        <div className="text-sm text-gray-400">
          {totalCards} cards · ~${totalValue.toFixed(2)}
        </div>
      </div>

      <input
        className="input max-w-sm"
        placeholder="Filter by name..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {isLoading && <div className="text-gray-400">Loading collection...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center text-gray-600 mt-16">
          <div className="text-4xl mb-2">📦</div>
          <div className="text-lg">Your collection is empty</div>
          <div className="text-sm mt-1">Search for cards and add them to your collection</div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700">
              <th className="pb-2 pr-4">Card</th>
              <th className="pb-2 pr-4">Set</th>
              <th className="pb-2 pr-4">Qty</th>
              <th className="pb-2 pr-4">Foil</th>
              <th className="pb-2 pr-4">Cond.</th>
              <th className="pb-2 pr-4">Price</th>
              <th className="pb-2 pr-4">Availability</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.map(card => (
              <tr key={card.id} className="hover:bg-mtg-surface/50">
                <td className="py-2 pr-4 font-medium flex items-center gap-2">
                  {card.image_uri && (
                    <img src={card.image_uri} alt="" className="w-8 h-11 rounded object-cover" />
                  )}
                  {card.name}
                </td>
                <td className="py-2 pr-4 text-gray-400">
                  {card.set_code?.toUpperCase()} #{card.collector_number}
                </td>
                <td className="py-2 pr-4">{card.quantity}</td>
                <td className="py-2 pr-4">{card.foil_quantity > 0 ? `${card.foil_quantity}✨` : '—'}</td>
                <td className="py-2 pr-4">
                  <span className="text-xs bg-mtg-card px-1.5 py-0.5 rounded">{card.condition}</span>
                </td>
                <td className="py-2 pr-4 text-mtg-gold">
                  {card.prices?.usd ? `$${card.prices.usd}` : '—'}
                </td>
                <td className="py-2 pr-4">
                  <OwnershipBadge ownership={card._ownership} />
                </td>
                <td className="py-2">
                  <button
                    onClick={() => removeMutation.mutate(card.scryfall_id)}
                    className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/pages"
cat > 'frontend/src/pages/DeckDetail.tsx' << 'HEREDOC_EOF'
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDeck, removeDeckCard, importDecklist, getMissingCards, upsertDeckCard, moveCard } from '../api'
import type { DeckCard, ScryfallCard } from '../types'
import OwnershipBadge from '../components/OwnershipBadge'
import CardAutocomplete from '../components/CardAutocomplete'
import clsx from 'clsx'

type ActiveAdd = 'mainboard' | 'sideboard' | 'maybeboard'

function groupByType(cards: DeckCard[]) {
  const groups: Record<string, DeckCard[]> = {}
  for (const card of cards) {
    const type =
      card.type_line
        ?.split('—')[0]
        ?.split(' ')
        .find(t =>
          ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land', 'Battle'].includes(t)
        ) ?? 'Other'
    groups[type] = [...(groups[type] ?? []), card]
  }
  return groups
}

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Battle', 'Other']

// ── Single card row ──────────────────────────────────────────────────────────
function CardRow({
  card,
  board,
  onRemove,
  onMove,
}: {
  card: DeckCard
  board: 'mainboard' | 'sideboard' | 'maybeboard'
  onRemove: () => void
  onMove: (toBoard: 'mainboard' | 'sideboard') => void
}) {
  const moveTarget = board === 'mainboard' ? 'sideboard' : 'mainboard'
  const moveLabel = board === 'mainboard' ? '→ SB' : '→ MB'

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-mtg-surface/60 group text-sm">
      <span className="text-gray-500 w-4 text-right flex-shrink-0">{card.quantity}</span>

      {card.image_uri && (
        <img src={card.image_uri} alt="" className="w-6 h-8 rounded object-cover flex-shrink-0" />
      )}

      <span className="flex-1 font-medium truncate">{card.name}</span>
      <span className="text-xs text-gray-600 hidden sm:block">{card.mana_cost}</span>

      {card.prices?.usd && (
        <span className="text-xs text-mtg-gold flex-shrink-0">${card.prices.usd}</span>
      )}

      <OwnershipBadge
        ownership={card._ownership}
        needed={board === 'mainboard' ? card.quantity : 0}
      />

      {/* Move button — only between mainboard and sideboard */}
      {board !== 'maybeboard' && (
        <button
          onClick={() => onMove(moveTarget as 'mainboard' | 'sideboard')}
          title={`Move to ${moveTarget}`}
          className="text-xs text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 font-mono"
        >
          {moveLabel}
        </button>
      )}

      <button
        onClick={onRemove}
        title="Remove"
        className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xs flex-shrink-0"
      >
        ✕
      </button>
    </div>
  )
}

// ── Board column ─────────────────────────────────────────────────────────────
function BoardColumn({
  title,
  badge,
  cards,
  board,
  addQty,
  setAddQty,
  onAddCard,
  onRemove,
  onMove,
  showImport,
  onToggleImport,
  importText,
  setImportText,
  onImport,
  importing,
  accent,
}: {
  title: string
  badge: string
  cards: DeckCard[]
  board: 'mainboard' | 'sideboard'
  addQty: number
  setAddQty: (n: number) => void
  onAddCard: (card: ScryfallCard) => void
  onRemove: (card: DeckCard) => void
  onMove: (card: DeckCard, toBoard: 'mainboard' | 'sideboard') => void
  showImport: boolean
  onToggleImport: () => void
  importText: string
  setImportText: (s: string) => void
  onImport: () => void
  importing: boolean
  accent: string
}) {
  const groups = groupByType(cards)
  const total = cards.reduce((s, c) => s + c.quantity, 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Column header */}
      <div className={clsx('flex items-center justify-between border-b pb-2', accent)}>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base">{title}</h2>
          <span className="text-xs bg-mtg-card px-2 py-0.5 rounded-full text-gray-400">
            {total} {badge}
          </span>
        </div>
        <button onClick={onToggleImport} className="btn-secondary text-xs">
          {showImport ? 'Cancel' : '⬆ Paste'}
        </button>
      </div>

      {/* Add card search */}
      <div className="flex gap-2 items-center">
        <CardAutocomplete
          placeholder={`Add to ${title.toLowerCase()}...`}
          onSelect={onAddCard}
          clearOnSelect
          className="flex-1"
        />
        <input
          type="number"
          min={1}
          max={99}
          value={addQty}
          onChange={e => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
          className="input w-14 text-center text-sm"
          title="Quantity"
        />
      </div>

      {/* Paste import */}
      {showImport && (
        <div className="bg-mtg-surface rounded-lg p-3 space-y-2 border border-gray-700">
          <textarea
            className="input h-32 font-mono text-xs resize-none"
            placeholder={"4 Lightning Bolt\n1 Sol Ring"}
            value={importText}
            onChange={e => setImportText(e.target.value)}
          />
          <button
            onClick={onImport}
            disabled={!importText.trim() || importing}
            className="btn-primary text-xs w-full disabled:opacity-40"
          >
            {importing ? 'Importing...' : `Import to ${title}`}
          </button>
        </div>
      )}

      {/* Card list grouped by type */}
      <div className="space-y-4">
        {TYPE_ORDER.filter(t => groups[t]?.length).map(type => (
          <div key={type}>
            <div className="text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">
              {type} ({groups[type].reduce((s, c) => s + c.quantity, 0)})
            </div>
            {groups[type]
              .sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || a.name.localeCompare(b.name))
              .map(card => (
                <CardRow
                  key={card.id}
                  card={card}
                  board={board}
                  onRemove={() => onRemove(card)}
                  onMove={(toBoard) => onMove(card, toBoard)}
                />
              ))}
          </div>
        ))}

        {cards.length === 0 && (
          <div className="text-center text-gray-600 py-8 text-sm">
            No cards yet — search above or paste a list
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DeckDetail() {
  const { id } = useParams<{ id: string }>()
  const deckId = parseInt(id!)
  const qc = useQueryClient()

  const [showMissing, setShowMissing] = useState(false)
  const [showMaybe, setShowMaybe] = useState(false)

  // Per-board add state
  const [mbQty, setMbQty] = useState(1)
  const [sbQty, setSbQty] = useState(1)
  const [mbShowImport, setMbShowImport] = useState(false)
  const [sbShowImport, setSbShowImport] = useState(false)
  const [mbImportText, setMbImportText] = useState('')
  const [sbImportText, setSbImportText] = useState('')

  const { data: deck, isLoading } = useQuery({
    queryKey: ['deck', deckId],
    queryFn: () => getDeck(deckId),
  })

  const { data: missing } = useQuery({
    queryKey: ['deck-missing', deckId],
    queryFn: () => getMissingCards(deckId),
    enabled: showMissing,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['deck', deckId] })

  const removeMutation = useMutation({
    mutationFn: ({ oracleId, board }: { oracleId: string; board: string }) =>
      removeDeckCard(deckId, oracleId, board),
    onSuccess: invalidate,
  })

  const moveMutation = useMutation({
    mutationFn: ({ oracleId, fromBoard, toBoard }: { oracleId: string; fromBoard: string; toBoard: string }) =>
      moveCard(deckId, { oracle_id: oracleId, from_board: fromBoard, to_board: toBoard }),
    onSuccess: invalidate,
  })

  const addMutation = useMutation({
    mutationFn: ({ card, board, qty }: { card: ScryfallCard; board: string; qty: number }) =>
      upsertDeckCard(deckId, {
        name: card.name,
        oracle_id: card.oracle_id,
        scryfall_id: card.id,
        quantity: qty,
        board,
      }),
    onSuccess: invalidate,
  })

  const mbImportMutation = useMutation({
    mutationFn: () => importDecklist(deckId, mbImportText, 'mainboard'),
    onSuccess: (res) => {
      invalidate()
      setMbShowImport(false)
      setMbImportText('')
      if (res.failed?.length) alert(`Failed:\n${res.failed.map((f: any) => `${f.line}: ${f.reason}`).join('\n')}`)
    },
  })

  const sbImportMutation = useMutation({
    mutationFn: () => importDecklist(deckId, sbImportText, 'sideboard'),
    onSuccess: (res) => {
      invalidate()
      setSbShowImport(false)
      setSbImportText('')
      if (res.failed?.length) alert(`Failed:\n${res.failed.map((f: any) => `${f.line}: ${f.reason}`).join('\n')}`)
    },
  })

  if (isLoading) return <div className="p-6 text-gray-400">Loading deck...</div>
  if (!deck) return <div className="p-6 text-red-400">Deck not found</div>

  const mainboard: DeckCard[] = deck.cards.filter((c: DeckCard) => c.board === 'mainboard')
  const sideboard: DeckCard[] = deck.cards.filter((c: DeckCard) => c.board === 'sideboard')
  const maybeboard: DeckCard[] = deck.cards.filter((c: DeckCard) => c.board === 'maybeboard')

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <Link to="/decks" className="text-xs text-gray-500 hover:text-gray-300">← All Decks</Link>
          <h1 className="text-2xl font-bold mt-1">{deck.name}</h1>
          <div className="text-sm text-gray-400 capitalize">{deck.format}</div>
        </div>
        <div className="text-right text-sm space-y-0.5">
          <div className="text-gray-300">
            {deck.stats.total_cards} main
            {deck.stats.sideboard_cards > 0 && (
              <span className="text-gray-500"> · {deck.stats.sideboard_cards} side</span>
            )}
          </div>
          {deck.stats.missing_cards > 0 && (
            <button onClick={() => setShowMissing(v => !v)} className="text-red-400 hover:underline text-xs block">
              {deck.stats.missing_cards} missing from mainboard
            </button>
          )}
          <div className="text-mtg-gold text-xs">~${deck.stats.total_price.toFixed(2)}</div>
        </div>
      </div>

      {/* ── Missing cards panel ── */}
      {showMissing && missing && (
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 space-y-2">
          <h3 className="font-semibold text-red-300 text-sm">Cards to acquire (mainboard only)</h3>
          {missing.data.map((c: any) => (
            <div key={c.oracle_id} className="flex justify-between items-center text-sm">
              <span>{c.name}</span>
              <span className="text-red-400 text-xs">need {c.need_to_acquire} more</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Sideboard note ── */}
      <div className="text-xs text-gray-600 italic">
        Sideboard cards are not counted as "in use" in your collection stats.
      </div>

      {/* ── Main split layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <BoardColumn
          title="Mainboard"
          badge="cards"
          cards={mainboard}
          board="mainboard"
          addQty={mbQty}
          setAddQty={setMbQty}
          onAddCard={(card) => addMutation.mutate({ card, board: 'mainboard', qty: mbQty })}
          onRemove={(card) => removeMutation.mutate({ oracleId: card.oracle_id, board: 'mainboard' })}
          onMove={(card, toBoard) => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'mainboard', toBoard })}
          showImport={mbShowImport}
          onToggleImport={() => setMbShowImport(v => !v)}
          importText={mbImportText}
          setImportText={setMbImportText}
          onImport={() => mbImportMutation.mutate()}
          importing={mbImportMutation.isPending}
          accent="border-gray-700"
        />

        <BoardColumn
          title="Sideboard"
          badge="cards"
          cards={sideboard}
          board="sideboard"
          addQty={sbQty}
          setAddQty={setSbQty}
          onAddCard={(card) => addMutation.mutate({ card, board: 'sideboard', qty: sbQty })}
          onRemove={(card) => removeMutation.mutate({ oracleId: card.oracle_id, board: 'sideboard' })}
          onMove={(card, toBoard) => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'sideboard', toBoard })}
          showImport={sbShowImport}
          onToggleImport={() => setSbShowImport(v => !v)}
          importText={sbImportText}
          setImportText={setSbImportText}
          onImport={() => sbImportMutation.mutate()}
          importing={sbImportMutation.isPending}
          accent="border-gray-700"
        />
      </div>

      {/* ── Maybeboard (collapsible) ── */}
      <div>
        <button
          onClick={() => setShowMaybe(v => !v)}
          className="text-sm text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
        >
          <span>{showMaybe ? '▾' : '▸'}</span>
          Maybeboard
          <span className="text-xs text-gray-600 ml-1">
            ({maybeboard.reduce((s, c) => s + c.quantity, 0)} cards)
          </span>
        </button>

        {showMaybe && (
          <div className="mt-3 pl-2 border-l border-gray-700 space-y-1">
            {maybeboard.length === 0 && (
              <div className="text-xs text-gray-600 py-2">No cards in maybeboard</div>
            )}
            {maybeboard
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(card => (
                <div key={card.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-mtg-surface/50 group text-sm">
                  <span className="text-gray-500 w-4 text-right">{card.quantity}</span>
                  <span className="flex-1 truncate">{card.name}</span>
                  <OwnershipBadge ownership={card._ownership} needed={0} />
                  <button
                    onClick={() => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'maybeboard', toBoard: 'mainboard' })}
                    className="text-xs text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all font-mono"
                    title="Move to mainboard"
                  >
                    → MB
                  </button>
                  <button
                    onClick={() => moveMutation.mutate({ oracleId: card.oracle_id, fromBoard: 'maybeboard', toBoard: 'sideboard' })}
                    className="text-xs text-gray-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all font-mono"
                    title="Move to sideboard"
                  >
                    → SB
                  </button>
                  <button
                    onClick={() => removeMutation.mutate({ oracleId: card.oracle_id, board: 'maybeboard' })}
                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xs"
                  >✕</button>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/pages"
cat > 'frontend/src/pages/Decks.tsx' << 'HEREDOC_EOF'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getDecks, createDeck, deleteDeck } from '../api'
import { Link } from 'react-router-dom'
import type { Deck } from '../types'

const FORMATS = ['commander', 'modern', 'standard', 'legacy', 'vintage', 'pioneer', 'pauper', 'custom']

export default function DecksPage() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newFormat, setNewFormat] = useState('commander')

  const { data } = useQuery({ queryKey: ['decks'], queryFn: getDecks })

  const createMutation = useMutation({
    mutationFn: () => createDeck({ name: newName, format: newFormat, description: '' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decks'] })
      setCreating(false)
      setNewName('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDeck(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decks'] }),
  })

  const decks: Deck[] = data?.data ?? []

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Decks</h1>
        <button onClick={() => setCreating(true)} className="btn-primary">+ New Deck</button>
      </div>

      {creating && (
        <div className="bg-mtg-surface rounded-xl p-4 space-y-3 border border-gray-700">
          <h2 className="font-semibold">New Deck</h2>
          <input className="input" placeholder="Deck name" value={newName} onChange={e => setNewName(e.target.value)} />
          <select className="input" value={newFormat} onChange={e => setNewFormat(e.target.value)}>
            {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => setCreating(false)} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim()}
              className="btn-primary flex-1 disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {decks.length === 0 && !creating && (
        <div className="text-center text-gray-600 mt-16">
          <div className="text-4xl mb-2">🃏</div>
          <div className="text-lg">No decks yet</div>
          <div className="text-sm mt-1">Create your first deck to get started</div>
        </div>
      )}

      <div className="grid gap-3">
        {decks.map(deck => (
          <div key={deck.id}
            className="bg-mtg-surface rounded-xl p-4 flex items-center justify-between border border-gray-700/50 hover:border-gray-600 transition-colors">
            <div>
              <Link to={`/decks/${deck.id}`} className="font-semibold hover:text-mtg-accent transition-colors">
                {deck.name}
              </Link>
              <div className="text-xs text-gray-400 mt-0.5">
                <span className="capitalize">{deck.format}</span>
                {deck.description && ` · ${deck.description}`}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {new Date(deck.updated_at).toLocaleDateString()}
              </span>
              <Link to={`/decks/${deck.id}`} className="btn-secondary text-xs">Open</Link>
              <button
                onClick={() => confirm(`Delete "${deck.name}"?`) && deleteMutation.mutate(deck.id)}
                className="text-gray-600 hover:text-red-400 text-xs transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

HEREDOC_EOF

mkdir -p "frontend/src/pages"
cat > 'frontend/src/pages/Search.tsx' << 'HEREDOC_EOF'
import { useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { searchCards } from '../api'
import type { ScryfallCard } from '../types'
import CardTile from '../components/CardTile'
import AddToCollectionModal from '../components/AddToCollectionModal'

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [addTarget, setAddTarget] = useState<ScryfallCard | null>(null)
  const [page, setPage] = useState(1)

  // Read ?q= from URL — populated when navigating from the Scryfall mode in SearchBar
  const urlQuery = searchParams.get('q') ?? ''
  const [inputValue, setInputValue] = useState(urlQuery)
  const [submitted, setSubmitted] = useState(urlQuery)

  // Sync input if URL param changes (e.g. navigating from navbar)
  useEffect(() => {
    if (urlQuery && urlQuery !== submitted) {
      setInputValue(urlQuery)
      setSubmitted(urlQuery)
      setPage(1)
    }
  }, [urlQuery])

  const { data, isFetching, isError } = useQuery({
    queryKey: ['search', submitted, page],
    queryFn: () => searchCards(submitted, page),
    enabled: submitted.length > 0,
  })

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const q = inputValue.trim()
    setPage(1)
    setSubmitted(q)
    setSearchParams(q ? { q } : {})
  }, [inputValue])

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          className="input flex-1"
          placeholder='Scryfall syntax, e.g. "c:red cmc=3" or "t:dragon f:commander"'
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
        />
        <button type="submit" className="btn-primary">Search</button>
      </form>

      <div className="text-xs text-gray-500">
        Full{' '}
        <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noreferrer"
          className="text-mtg-accent hover:underline">
          Scryfall search syntax
        </a>
        {' '}supported. Use the Navbar search for quick card name lookup.
      </div>

      {isFetching && <div className="text-gray-400 text-sm">Searching...</div>}
      {isError && <div className="text-red-400 text-sm">Search failed. Check the backend is running.</div>}

      {data && (
        <>
          <div className="text-sm text-gray-400">{data.total_cards} cards found</div>
          <div className="flex flex-wrap gap-3">
            {data.data?.map((card: ScryfallCard) => (
              <CardTile
                key={card.id}
                card={card}
                onAdd={setAddTarget}
                actionLabel="+ Collection"
              />
            ))}
          </div>

          <div className="flex gap-2 items-center pt-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary disabled:opacity-40"
            >← Prev</button>
            <span className="text-sm text-gray-400">Page {page}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!data.has_more}
              className="btn-secondary disabled:opacity-40"
            >Next →</button>
          </div>
        </>
      )}

      {!submitted && (
        <div className="text-center text-gray-600 mt-16">
          <div className="text-4xl mb-2">🔍</div>
          <div className="text-lg">Search with Scryfall syntax</div>
          <div className="text-sm mt-1">For card name lookup, use the search bar in the navbar</div>
        </div>
      )}

      {addTarget && (
        <AddToCollectionModal card={addTarget} onClose={() => setAddTarget(null)} />
      )}
    </div>
  )
}

HEREDOC_EOF

echo ""
echo "✅ Done!"
echo ""
echo "  git init && git remote add origin <url>"
echo "  git add . && git commit -m \"init\" && git push -u origin main"
echo "  docker-compose up --build  →  http://localhost:8000"
```

---

# MTG Local Manager

A lightweight local clone of Moxfield for managing your Magic: The Gathering collection and decks.

- **Card database**: Scryfall bulk data (~300MB, loaded into memory on startup, refreshed weekly)
- **Backend**: FastAPI + SQLite
- **Frontend**: React + Vite + Tailwind
- **Packaged**: Single Docker container

## Prerequisites

- Docker Desktop (for the packaged version)
- Node.js 18+ and Python 3.12+ (for local dev)
- Git

---

## Quick Start (Docker)

```bash
git clone <your-repo-url> mtg-local
cd mtg-local

# Build and start (first run will download ~300MB of Scryfall card data)
docker-compose up --build
```

Then open http://localhost:8000

> First startup takes 2-5 minutes to download the Scryfall bulk card data.
> Subsequent startups are instant — card data is cached in `./data/`.

---

## Development Setup (Hot Reload)

Run backend and frontend separately for hot reload during development.

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
mkdir -p ../data
DATA_DIR=../data uvicorn main:app --reload --port 8000
```

### Frontend (separate terminal)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at http://localhost:5173 and proxies `/api` to the backend at 8000.

---

## Production Build (single container)

```bash
# Build the React frontend
cd frontend && npm run build && cd ..

# Now docker-compose serves everything from FastAPI on port 8000
docker-compose up --build
```

---

## Features

- **Search**: Full Scryfall search syntax (e.g. `c:red cmc=3`, `t:dragon f:commander`)
- **Collection**: Track cards with quantity, foil count, and condition (NM/LP/MP/HP/DMG)
- **Ownership badges**: Every card shows how many you own, how many are in use across decks, and how many are free
- **Deck builder**: Create decks, import plaintext decklists, view cards grouped by type
- **Missing cards**: See exactly what you need to acquire to complete a deck
- **Cross-deck availability**: Click any ownership badge to see which decks are using that card

---

## Data

Card data is stored in `./data/` (gitignored):
- `default_cards.json` — Scryfall bulk card data (~300MB)
- `mtg.db` — Your collection and decks (SQLite)

To force a card data refresh: `POST /api/system/bulk-refresh` or use the System endpoint.

---

## Project Structure

```
mtg-local/
  backend/
    main.py              # FastAPI app + startup
    db.py                # SQLAlchemy async setup
    models.py            # CollectionCard, Deck, DeckCard
    routers/
      cards.py           # Search proxy + card lookup
      collection.py      # Collection CRUD
      decks.py           # Deck CRUD + import + missing cards
      system.py          # Bulk data status + refresh
    scryfall/
      bulk.py            # Download + staleness check
      store.py           # In-memory card store
      search.py          # Scryfall API proxy
      annotate.py        # Ownership annotation logic
  frontend/
    src/
      App.tsx
      api.ts             # All API calls
      types.ts           # TypeScript types
      components/
        Navbar.tsx
        CardTile.tsx
        OwnershipBadge.tsx
        AddToCollectionModal.tsx
      pages/
        Search.tsx
        Collection.tsx
        Decks.tsx
        DeckDetail.tsx
  data/                  # gitignored — card data + SQLite DB
  docker-compose.yml
```

---

## Roadmap

- [ ] Phase 5: Bulk CSV import/export
- [ ] Phase 6: Tauri wrapper for macOS app
- [ ] Price tracking over time
- [ ] Commander staples / card recommendations
- [ ] Proxy printing export

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

### Installing prerequisites on macOS

If you don't have Homebrew:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Then install the required tools:
```bash
brew install python@3.12 node git
```

After installing Python via Homebrew, use `python3.12` explicitly when creating the venv:
```bash
python3.12 -m venv .venv
```

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
python3.12 -m venv .venv        # use python3.12 to avoid system Python 3.9 on macOS
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

- [x] Phase 5: Bulk CSV import (Moxfield format)
- [ ] Phase 6: Tauri wrapper for macOS app
- [ ] Price tracking over time
- [ ] Commander staples / card recommendations
- [ ] Proxy printing export

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

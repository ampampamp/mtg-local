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

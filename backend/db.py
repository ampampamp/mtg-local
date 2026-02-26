import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

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
        # Add tags column if it doesn't exist (safe migration for existing DBs)
        result = await conn.execute(text("PRAGMA table_info(deck_cards)"))
        columns = [row[1] for row in result.fetchall()]
        if "tags" not in columns:
            await conn.execute(text("ALTER TABLE deck_cards ADD COLUMN tags TEXT DEFAULT ''"))


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

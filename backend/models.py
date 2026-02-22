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

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

import orjson

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", "/data")
BULK_CARDS_FILE = Path(DATA_DIR) / "default_cards.json"


class CardStore:
    def __init__(self):
        self.cards_by_id: dict[str, dict] = {}              # scryfall_id → card
        self.cards_by_oracle: dict[str, dict] = {}           # oracle_id → first/best printing
        self.cards_by_oracle_all: dict[str, list] = {}       # oracle_id → all printings
        self.cards_by_set_collector: dict[str, dict] = {}    # "set|collector_number" → card

    async def load(self):
        if not BULK_CARDS_FILE.exists():
            logger.warning("Bulk cards file not found, store is empty.")
            return
        logger.info("Loading card store into memory...")
        await asyncio.to_thread(self._load_sync)
        logger.info(f"Loaded {len(self.cards_by_id)} printings, {len(self.cards_by_oracle)} unique oracle cards.")

    def _load_sync(self):
        with open(BULK_CARDS_FILE, "rb") as f:
            cards = orjson.loads(f.read())
        for card in cards:
            sid = card.get("id")
            oid = card.get("oracle_id")
            if sid:
                self.cards_by_id[sid] = card
            if oid:
                if oid not in self.cards_by_oracle:
                    self.cards_by_oracle[oid] = card
                if oid not in self.cards_by_oracle_all:
                    self.cards_by_oracle_all[oid] = []
                self.cards_by_oracle_all[oid].append(card)
            key = f"{card.get('set', '').lower()}|{card.get('collector_number', '')}"
            if key not in self.cards_by_set_collector:
                self.cards_by_set_collector[key] = card

    def get_by_id(self, scryfall_id: str) -> Optional[dict]:
        return self.cards_by_id.get(scryfall_id)

    def get_by_oracle(self, oracle_id: str) -> Optional[dict]:
        return self.cards_by_oracle.get(oracle_id)

    def get_by_set_collector(self, set_code: str, collector_number: str) -> Optional[dict]:
        key = f"{set_code.lower()}|{collector_number}"
        return self.cards_by_set_collector.get(key)

    def get_image_uri(self, card: dict, face: str = "front") -> Optional[str]:
        """Extract image URI handling DFCs."""
        if "image_uris" in card:
            return card["image_uris"].get("normal")
        faces = card.get("card_faces", [])
        if faces:
            idx = 1 if face == "back" and len(faces) > 1 else 0
            return faces[idx].get("image_uris", {}).get("normal")
        return None


card_store = CardStore()

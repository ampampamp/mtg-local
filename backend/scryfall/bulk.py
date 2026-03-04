import os
import json
import logging
from datetime import datetime
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

DATA_DIR = os.environ.get("DATA_DIR", "/data")
BULK_META_FILE = Path(DATA_DIR) / "bulk_meta.json"
BULK_CARDS_FILE = Path(DATA_DIR) / "default_cards.json"

HEADERS = {
    "User-Agent": "MTGLocalManager/1.0",
    "Accept": "application/json",
}


async def ensure_bulk_data_fresh():
    """Download Scryfall bulk data if missing."""
    if _is_fresh():
        logger.info("Bulk card data is present, skipping download.")
        return

    logger.info("Bulk card data is missing. Downloading...")
    await _download_bulk_data()


def _is_fresh() -> bool:
    return BULK_META_FILE.exists() and BULK_CARDS_FILE.exists()


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

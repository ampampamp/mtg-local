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

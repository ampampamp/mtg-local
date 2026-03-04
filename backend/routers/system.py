import os
import sys
import platform
import time
from pathlib import Path
from typing import Optional, Tuple

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from scryfall.bulk import ensure_bulk_data_fresh, get_bulk_meta
from scryfall.store import card_store

router = APIRouter()

GITHUB_REPO = "ampampamp/mtg-local"

# Simple in-process sync state
_sync_state = {"syncing": False, "last_error": None}

# Version check cache: (result_dict, timestamp)
_version_cache: Optional[Tuple[dict, float]] = None
_VERSION_CACHE_TTL = 3600  # 1 hour


def _get_current_version() -> str:
    """Read VERSION file from bundle or source tree."""
    if getattr(sys, "frozen", False):
        version_path = Path(sys._MEIPASS) / "VERSION"  # type: ignore[attr-defined]
    else:
        version_path = Path(__file__).parent.parent / "VERSION"
    if version_path.exists():
        return version_path.read_text().strip()
    return "unknown"


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


@router.get("/version")
async def get_version():
    """Return current version and check for updates (frozen app only)."""
    global _version_cache

    current = _get_current_version()

    if not getattr(sys, "frozen", False):
        return {"version": "dev", "update_available": False}

    # Use cache if still fresh
    now = time.time()
    if _version_cache is not None:
        cached_result, cached_at = _version_cache
        if now - cached_at < _VERSION_CACHE_TTL:
            return cached_result

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json"},
            )
            resp.raise_for_status()
            data = resp.json()
            latest = data["tag_name"].lstrip("v")
            download_url = data.get("html_url", "")

            result = {
                "version": current,
                "update_available": latest != current,
                "latest_version": latest,
                "download_url": download_url,
            }
    except Exception:
        result = {"version": current, "update_available": False}

    _version_cache = (result, now)
    return result


@router.post("/update")
async def trigger_update():
    """Download and install the latest release (frozen app only)."""
    if not getattr(sys, "frozen", False):
        raise HTTPException(status_code=400, detail="Update only available in packaged app")

    import tempfile
    import subprocess
    import urllib.request

    os_name = platform.system()

    # Find asset URL
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json"},
            )
            resp.raise_for_status()
            assets = resp.json().get("assets", [])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch release info: {e}")

    if os_name == "Darwin":
        asset_name = "MTG-Local-macOS.zip"
    elif os_name == "Windows":
        asset_name = "MTG-Local-Windows.exe"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported platform: {os_name}")

    asset_url = next(
        (a["browser_download_url"] for a in assets if a["name"] == asset_name),
        None,
    )
    if not asset_url:
        raise HTTPException(status_code=404, detail=f"Asset {asset_name} not found in latest release")

    if os_name == "Darwin":
        _update_macos(asset_url)
    else:
        _update_windows(asset_url)

    return {"status": "updating"}


def _update_macos(asset_url: str):
    import subprocess
    import tempfile

    app_path = Path(sys.executable).parent.parent  # MTG Local.app
    tmp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(tmp_dir, "MTG-Local-macOS.zip")
    script_path = os.path.join(tmp_dir, "update.sh")

    script = f"""#!/bin/bash
sleep 2
curl -L -o '{zip_path}' '{asset_url}'
ditto -x -k '{zip_path}' '{tmp_dir}'
rm -rf '{app_path}'
mv '{tmp_dir}/MTG Local.app' '{app_path}'
open '{app_path}'
"""
    with open(script_path, "w") as f:
        f.write(script)
    os.chmod(script_path, 0o755)
    subprocess.Popen(["/bin/bash", script_path], close_fds=True)
    os._exit(0)


def _update_windows(asset_url: str):
    import subprocess
    import tempfile

    exe_path = sys.executable
    tmp_dir = tempfile.mkdtemp()
    new_exe = os.path.join(tmp_dir, "MTG-Local-Windows.exe")
    bat_path = os.path.join(tmp_dir, "update.bat")

    bat = f"""@echo off
timeout /t 2 /nobreak > nul
curl -L -o "{new_exe}" "{asset_url}"
move /y "{new_exe}" "{exe_path}"
start "" "{exe_path}"
"""
    with open(bat_path, "w") as f:
        f.write(bat)
    subprocess.Popen(
        ["cmd.exe", "/c", bat_path],
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )
    os._exit(0)

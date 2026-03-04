# MTG Local Manager

A lightweight local app for managing your Magic: The Gathering collection and decks — search cards, track your collection, and build decks, all offline.

---

## Download & Run (end users)

No installation required. The app runs entirely on your machine — card data stays local, nothing is sent to the cloud.

### macOS

1. Go to the [Releases page](https://github.com/ampampamp/mtg-local/releases/latest) and download **MTG-Local-macOS.zip**
2. Double-click the zip to extract it — you'll get **MTG Local.app**
3. Drag **MTG Local.app** to your Applications folder (optional but recommended)
4. **First launch only**: macOS will block the app because it isn't from the App Store.
   - Right-click (or Control-click) the app → **Open**
   - Click **Open** in the dialog that appears
   - You only need to do this once
5. A small sword icon appears in your menu bar. The app will download ~300MB of card data on first run — this takes 2–5 minutes depending on your connection.
6. Your browser opens automatically once the app is ready.

> **If you see "MTG Local is damaged and can't be opened"**, open Terminal and run:
> ```
> xattr -cr "/Applications/MTG Local.app"
> ```
> Then try launching again.

### Windows

1. Go to the [Releases page](https://github.com/ampampamp/mtg-local/releases/latest) and download **MTG-Local-Windows.exe**
2. Double-click the exe to run it
3. **First launch only**: Windows SmartScreen may warn "Windows protected your PC" because the app isn't code-signed.
   - Click **More info** → **Run anyway**
4. A small icon appears in your system tray (bottom-right corner, you may need to click the ^ arrow to see it). The app will download ~300MB of card data on first run — this takes 2–5 minutes.
5. Your browser opens automatically once the app is ready.

### Daily use

- The app lives in your **menu bar** (macOS) or **system tray** (Windows)
- Click the icon for options: **Open MTG Local**, **Update Card Data**, **Quit**
- Your browser opens to the app at a local address — no internet required after first run
- **Update Card Data** re-downloads the latest Scryfall card database (~300MB)

### Updating the app

When a new version is available, a pulsing **↑ Update** button appears in the navbar. Click it and the app will download the update and restart automatically.

Or download the new version manually from the [Releases page](https://github.com/ampampamp/mtg-local/releases/latest) and replace the old file.

### Where is my data stored?

Your collection and decks are stored locally in:
- **macOS**: `~/Library/Application Support/MTGLocal/`
- **Windows**: `%APPDATA%\MTGLocal\`

Back up the `mtg.db` file in that folder to keep your collection safe.

---

## Developer setup

- Node.js 18+ and Python 3.12+
- Git
- Docker Desktop (optional — for the containerized version)

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

## Releasing a new version

Regular commits and pushes to `main` **do not affect end users** — people running the packaged app are running a frozen binary that only updates when you explicitly publish a release. You can push as many commits as you want and batch them up before deciding to ship.

A release is triggered by pushing a **version tag**. GitHub Actions then builds both the macOS and Windows binaries and uploads them to a GitHub Release automatically. That's the artifact users download or auto-update to.

### Step-by-step

1. **Finish your changes** — commit everything to `main` as normal.

2. **Bump the version** in `backend/VERSION`:
   ```
   1.1.0
   ```
   Commit it:
   ```bash
   git add backend/VERSION
   git commit -m "Bump version to 1.1.0"
   git push
   ```

3. **Tag the release** — the tag must start with `v` and match the version in `backend/VERSION`:
   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```
   That's it. GitHub Actions takes over from here.

4. **Watch the build** — go to the Actions tab on GitHub. Two parallel jobs run (`build-macos` and `build-windows`), each taking ~5–10 minutes. When both finish, the artifacts are attached to a new GitHub Release at `github.com/ampampamp/mtg-local/releases/tag/v1.1.0`.

5. **Add release notes** (optional but nice) — go to the Releases page on GitHub, click **Edit** on the new release, and write a changelog. Users see this on the releases page.

### What users see

Once the release is published:
- Users running the packaged app will see a pulsing **↑ Update (v1.1.0)** button in the navbar the next time they open it (the app checks GitHub once per hour)
- Clicking it downloads the new binary and restarts the app automatically
- Users who haven't run the app yet will get the latest version when they download from the releases page

### Versioning convention

Use [semantic versioning](https://semver.org):
- `1.0.1` — bug fix, no new features
- `1.1.0` — new feature, backward-compatible
- `2.0.0` — breaking change (e.g. DB migration required)

### If a build fails

Check the Actions tab. Common causes:
- Frontend build error (TypeScript/lint failure) — fix and re-tag: delete the old tag first with `git push origin --delete v1.1.0`, then fix, commit, and re-push the tag
- PyInstaller missing a hidden import — add it to `backend/launcher.spec` under `hiddenimports`

---

## Roadmap

- [x] Phase 5: Bulk CSV import (Moxfield format)
- [x] Phase 6: Packaged desktop app (macOS + Windows) with system tray + auto-update
- [ ] Price tracking over time
- [ ] Commander staples / card recommendations
- [ ] Proxy printing export

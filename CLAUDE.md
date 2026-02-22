# MTG Local Manager — Claude Instructions

## Running the App

**Always use Docker** to build and run this project. Do not install Python or Node dependencies directly on the host.

```bash
docker-compose up --build
```

- First run takes a few minutes (builds the image + downloads ~300MB Scryfall card data)
- App is available at http://localhost:8000
- Card data is cached in `./data/` so subsequent starts are fast

## Development (hot reload)

If hot reload is needed during development, run backend and frontend separately — but still prefer Docker for anything else.

```bash
# Backend
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
mkdir -p ../data
DATA_DIR=../data uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
# → http://localhost:5173
```

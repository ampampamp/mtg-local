"""
Entry point for the packaged MTG Local Manager desktop app (PyInstaller).
Not used in dev mode — run uvicorn directly instead.
"""
import os
import sys
import socket
import threading
import time
import webbrowser
import urllib.request
import urllib.error
import platform


# ---------------------------------------------------------------------------
# Resolve paths before importing app modules
# ---------------------------------------------------------------------------

def get_data_dir() -> str:
    if platform.system() == "Darwin":
        return os.path.expanduser("~/Library/Application Support/MTGLocal")
    elif platform.system() == "Windows":
        return os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "MTGLocal")
    else:
        return os.path.expanduser("~/.local/share/MTGLocal")


def get_frontend_dist() -> str:
    base = getattr(sys, "_MEIPASS", os.path.dirname(__file__))
    return os.path.join(base, "frontend", "dist")


data_dir = get_data_dir()
os.makedirs(data_dir, exist_ok=True)
os.environ["DATA_DIR"] = data_dir
os.environ["FRONTEND_DIST"] = get_frontend_dist()

# Add backend dir to path so imports work when frozen
if getattr(sys, "frozen", False):
    sys.path.insert(0, sys._MEIPASS)  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Free port helper
# ---------------------------------------------------------------------------

def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# Tray icon image (generated with Pillow — no external file needed)
# ---------------------------------------------------------------------------

def make_tray_image():
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (64, 64), (30, 30, 46, 255))
    draw = ImageDraw.Draw(img)
    draw.ellipse([8, 8, 56, 56], fill=(99, 102, 241, 255))
    # Simple sword silhouette
    draw.rectangle([30, 14, 34, 46], fill=(255, 255, 255, 255))
    draw.rectangle([24, 26, 40, 30], fill=(255, 255, 255, 255))
    return img


# ---------------------------------------------------------------------------
# Server thread
# ---------------------------------------------------------------------------

def start_server(port: int):
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=port, log_level="warning")


# ---------------------------------------------------------------------------
# Tray setup callback (runs in pystray worker thread)
# ---------------------------------------------------------------------------

def make_setup(port: int, data_dir: str):
    def setup(icon):
        bulk_meta = os.path.join(data_dir, "bulk_meta.json")
        first_run = not os.path.exists(bulk_meta)

        if first_run:
            icon.title = "MTG Local - Downloading card data (~300MB)..."

        # Poll until server is ready
        url = f"http://127.0.0.1:{port}/api/system/bulk-status"
        while True:
            try:
                with urllib.request.urlopen(url, timeout=2) as resp:
                    if resp.status == 200:
                        break
            except Exception:
                pass
            time.sleep(1)

        webbrowser.open(f"http://127.0.0.1:{port}")

        if first_run:
            _notify("MTG Local", "Card data downloaded. MTG Local is ready!")

        icon.title = "MTG Local"
        icon.visible = True

    return setup


def _notify(title: str, message: str):
    """Best-effort OS notification."""
    try:
        if platform.system() == "Darwin":
            os.system(
                f'osascript -e \'display notification "{message}" with title "{title}"\''
            )
        elif platform.system() == "Windows":
            try:
                from win10toast import ToastNotifier
                ToastNotifier().show_toast(title, message, duration=5)
            except ImportError:
                pass
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import pystray
    from pystray import MenuItem as Item, Menu

    port = find_free_port()

    # Start uvicorn in a daemon thread
    server_thread = threading.Thread(target=start_server, args=(port,), daemon=True)
    server_thread.start()

    image = make_tray_image()

    def open_browser(icon, item):
        webbrowser.open(f"http://127.0.0.1:{port}")

    def update_cards(icon, item):
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/system/bulk-refresh",
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass

    def quit_app(icon, item):
        icon.stop()
        os._exit(0)

    menu = Menu(
        Item("Open MTG Local", open_browser, default=True),
        Item("Update Card Data", update_cards),
        Menu.SEPARATOR,
        Item("Quit", quit_app),
    )

    icon = pystray.Icon(
        "MTG Local",
        image,
        "MTG Local",
        menu=menu,
    )
    icon.run(setup=make_setup(port, data_dir))


if __name__ == "__main__":
    main()

"""Finder launch: main-thread Cocoa window, background asyncio API/BLE loop."""

import argparse
import json
import logging
import os
import secrets
import socket
import sys
import threading
import time
from pathlib import Path

import uvicorn

from app.main import create_app


class EventFormatter(logging.Formatter):
    def format(self, record):
        # Log only controlled event names and states, never raw exceptions/requests.
        return json.dumps(
            {
                "level": record.levelname,
                "event": record.getMessage(),
                "sensor_id": getattr(record, "sensor_id", None),
                "state": getattr(record, "state", None),
            }
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mock", action="store_true", help="Use a separate, visibly labelled demo database")
    parser.add_argument("--browser", action="store_true", help="Open the local app in a browser for development")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--smoke-test", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    data_dir = args.data_dir or Path.home() / "Library/Application Support/ThermoNest"
    data_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(data_dir, 0o700)
    handler = logging.StreamHandler()
    handler.setFormatter(EventFormatter())
    logging.getLogger("thermonest").addHandler(handler)
    logging.getLogger("thermonest").setLevel(logging.INFO)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    token = secrets.token_urlsafe(32)
    frontend = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2])) / "frontend/dist"
    app = create_app(data_dir, mock=args.mock, token=token, origin=origin, frontend_dir=frontend)
    server = uvicorn.Server(uvicorn.Config(app, log_level="critical", access_log=False, loop="asyncio"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 20
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            raise RuntimeError("ThermoNest local service did not start")
        time.sleep(0.05)
    url = f"{origin}/bootstrap?key={token}"
    try:
        if args.browser:
            import webbrowser

            webbrowser.open(url)
            print(f"ThermoNest running at {origin}; browser session opened. Ctrl+C to quit.")
            while thread.is_alive():
                time.sleep(0.5)
        else:
            import webview

            webview.settings["ALLOW_DOWNLOADS"] = True

            window = webview.create_window(
                "ThermoNest", url, width=1320, height=880, min_size=(900, 650), background_color="#f7f8fa"
            )
            if args.smoke_test:

                def verify_window():
                    result = {"ok": False, "native": "Cocoa / WKWebView"}
                    try:
                        window.events.loaded.wait(15)
                        deadline = time.monotonic() + 25
                        while time.monotonic() < deadline:
                            title = window.run_js("document.querySelector('h1')?.textContent || ''")
                            if title == "A feel for every room.":
                                result["heading"] = title
                                window.run_js(
                                    "Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.trim() === 'Floor plan')?.click()"
                                )
                                while time.monotonic() < deadline:
                                    map_title = window.run_js(
                                        "document.querySelector('.floor-empty h2')?.textContent || ''"
                                    )
                                    if map_title == "Put your home on the map.":
                                        result["ok"] = True
                                        result["floor_plan"] = map_title
                                        break
                                    time.sleep(0.25)
                                break
                            time.sleep(0.25)
                    except Exception:
                        result["error"] = "Native UI did not render"
                    finally:
                        (data_dir / "smoke-test.json").write_text(json.dumps(result))
                        window.destroy()

                webview.start(verify_window, private_mode=True)
            else:
                webview.start(private_mode=True)
    except KeyboardInterrupt:
        pass
    finally:
        server.should_exit = True
        thread.join(timeout=15)
        sock.close()


if __name__ == "__main__":
    main()

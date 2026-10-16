"""Local API for the Vite proxy; production authentication remains enabled."""
import argparse
import logging
from pathlib import Path

import uvicorn

from app.desktop.launcher import EventFormatter
from app.main import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--real", action="store_true", help="Use real Bluetooth instead of demo sensors")
    args = parser.parse_args()
    handler = logging.StreamHandler()
    handler.setFormatter(EventFormatter())
    logging.getLogger("thermonest").addHandler(handler)
    logging.getLogger("thermonest").setLevel(logging.INFO)
    app = create_app(Path(".dev-data"), mock=not args.real, origin="http://127.0.0.1:5173")
    print("Start npm run dev:web, then open this one-use session URL:", flush=True)
    print(f"http://127.0.0.1:5173/bootstrap?key={app.state.bootstrap_token}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)


if __name__ == "__main__":
    main()

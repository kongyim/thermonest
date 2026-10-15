"""Isolated browser-test server: mock only, loopback only, throwaway storage."""

from pathlib import Path
from tempfile import TemporaryDirectory
import uvicorn
from app.main import create_app

if __name__ == "__main__":
    with TemporaryDirectory(prefix="thermonest-e2e-") as folder:
        app = create_app(Path(folder), mock=True, token="e2e-only-bootstrap", origin="http://127.0.0.1:8766")
        uvicorn.run(app, host="127.0.0.1", port=8766, access_log=False)

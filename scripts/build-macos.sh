#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
(cd frontend && npm ci && npm run build)
PYINSTALLER_CONFIG_DIR="${TMPDIR:-/tmp}/thermonest-pyinstaller" .venv/bin/python -m PyInstaller --noconfirm ThermoNest.spec
printf '\nBuilt dist/ThermoNest.app\n'

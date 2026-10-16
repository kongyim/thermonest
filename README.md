# ThermoNest

Your home's climate, at a glance.

A local macOS desktop dashboard for Xiaomi Mijia **LYWSD03MMC** sensors with stock firmware. React / TypeScript UI, FastAPI / Bleak service, SQLite history, and a pywebview window. No account, cloud, gateway, or firmware flashing.

## Open the application

The local build is `dist/ThermoNest.app`. Double-click it in Finder. Add a room using the sidebar **+**, choose **Add sensor**, scan, select a candidate, and give it a name and room. Allow Bluetooth when macOS asks. Close any other application currently connected to the sensor.

This build targets the build machine's architecture (Apple Silicon). It bundles Python and the frontend; users do not need Python or Node. It is locally ad-hoc signed, **not Developer ID signed or notarized for public distribution**. Build separately on Intel for an Intel release. A successful software build does not establish compatibility with every stock firmware revision; physical-device acceptance remains necessary.

## Development

Validated with Python 3.12.9 on macOS arm64; Python 3.11–3.13 is permitted by package metadata. Use 3.12 for reproducible packaging.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-lock.txt
.venv/bin/pip install -e '.[dev]'
npm --prefix frontend ci
```

From the repository root, run these in separate terminals:

```sh
npm run dev:api
npm run dev:web
```

Open the one-use URL printed by the API terminal after Vite starts. Vite provides hot frontend updates at `http://127.0.0.1:5173` and proxies API/bootstrap/WebSocket traffic to port 8765 with session and origin checks intact. Restart the API after Python changes and open its new session URL. Development defaults to demo sensors and isolated `.dev-data/` storage; use `npm run dev:api -- --real` for Bluetooth hardware.

Battery Saver offers **Passive** (advertisements only, no GATT), **Balanced** (advertisements preferred, 300-second GATT fallback), and **Custom** (30–3600 seconds). Discovery listens for eight seconds at startup and roughly every minute while sensors are registered; it never connects. Fresh decoded temperature and humidity advertisements suppress GATT. Encrypted broadcasts require a bind key. On macOS, Bleak cannot request true radio-level passive scanning; Passive means connection-free advertisement monitoring using system-managed scanning ([Bleak documentation](https://bleak.readthedocs.io/en/latest/api/scanner.html)).

GATT disconnects after a sample. Failures exponentially increase the polling delay (up to 24 hours, with jitter). Cached readings and timestamps survive restart; refreshing the dashboard never polls hardware. Logs report GATT attempt count, start-to-disconnect duration (including failed attempts), and time between attempts. Firmware and advertising intervals are never changed. Actual battery savings require physical sensor measurements.

## Features

- Exact-model discovery candidates; MiBeacon product checks; GATT characteristic validation on connection. Peripheral UUIDs on macOS, never assumed MAC addresses.
- Bounded asynchronous GATT connections, notifications, optional reported battery percentage, raw voltage, signal from discovery, exponential retry with jitter, graceful task cancellation.
- MiBeacon plaintext v3/v4/v5 and authenticated encrypted v4/v5 for product `0x055B`. Keys enter through sensor settings and stay in macOS Keychain. Unknown versions, products, malformed packets, and authentication failures fail closed.
- Explicit connection states, stale indication, fresh-only home averages, and missing-value display. A GATT sample is taken then the connection is released; “Receiving” means the last poll delivered a reading, not a continuously held radio connection.
- Rooms, sensor names, manual rediscovery/reconciliation preserving the sensor ID and history, 24h/7d/30d/custom charts, raw CSV export, light/dark/system themes, sampling preferences.
- SQLite WAL, foreign keys, indexed UTC readings, transactional schema migrations. Chart aggregation targets roughly 800 points. CSV is unaggregated. Date ranges are limited to 366 days per request.
- Authenticated WebSocket live updates with reconnect and periodic HTTP fallback.

## Data and security

Mutable data is under `~/Library/Application Support/ThermoNest/`, never inside the app bundle. Real and demo databases are separate. Back up this directory with the app closed. There is no automatic retention deletion.

A random, one-use launch token establishes an HttpOnly SameSite=Strict session cookie. Access logs are disabled so the bootstrap URL is not logged. All routes, including static UI and the OpenAPI document at `/api/openapi.json`, require the session. Exact Host and Origin checks reject other origins; state changes require a custom header. WebSockets require the same cookie and exact origin. The API binds only to `127.0.0.1`. Session cookies are intentionally not `Secure` because this is HTTP loopback, and are regenerated each launch. This protects against cross-origin browser requests; it is not a defense against malicious software already executing as the same macOS user.

Bind keys use the explicit macOS Keychain backend with no plaintext fallback. Logs contain controlled event names, opaque sensor IDs, and status; raw BLE packets, bind keys, and exception payloads are not logged. Public fixture keys in tests are upstream test vectors, not user secrets.

## Test

```sh
.venv/bin/pytest -q
cd frontend
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser integration test starts a temporary mock-only server and exercises room creation, sensor discovery/registration, WebSocket updates, chart controls, CSV download, persistent preferences, rename, and deletion. It writes `docs/dashboard.png`. Backend tests cover protocol fixtures, authentication, origin/host protection, database persistence, duplicate registration, reconciliation, scheduling concurrency and cancellation.

See [BLE research and limits](docs/ble-research.md) and [macOS release checks](docs/release.md).

## Package

```sh
npm run build:macos
# Alias:
npm run build
```

The PyInstaller spec includes Cocoa/WebKit, CoreBluetooth, the Keychain backend, and the compiled UI. Native Bluetooth permission usage strings are embedded in Info.plist. The Python and npm dependency locks are included. End-user distribution still requires your Apple Developer signing identity and notarization credentials; no credentials are embedded.

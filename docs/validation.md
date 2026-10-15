# Validation record

15 October 2026 · macOS arm64 · Python 3.12.9

- Backend: **14 tests passed**. Stock signed-temperature parsing, malformed packets, independent MiBeacon plaintext and encrypted fixtures, invalid-key/tag rejection, conservative discovery, concurrency/cancellation, SQLite persistence/migration, registration/reconciliation/deletion, historical export, and session/Host/Origin/WebSocket security.
- Frontend: **3 tests passed**. Missing/zero values, stale classification, local API headers and errors.
- Browser: **1 end-to-end test passed** against the actual built frontend and isolated FastAPI mock server. Creates room, discovers/registers sensor, receives live updates, changes chart metric/range, downloads CSV, persists theme/sampling preferences across reload, renames and removes sensor. No uncaught browser exceptions.
- TypeScript and Vite production build passed. Vite reports a non-fatal large-bundle advisory for the bundled React/chart dependencies.
- Python Ruff checks (`E4,E7,E9,F,I`) passed.
- PyInstaller built an approximately **54 MB** `dist/ThermoNest.app`, bundling the Python runtime, Cocoa/WebKit, Bleak/CoreBluetooth, database/crypto/Keychain dependencies, and frontend assets.
- `codesign --verify --deep --strict dist/ThermoNest.app` passed for the local ad-hoc signature.
- Finder-style LaunchServices launch (`open -W -n`) also passed the same automated native smoke check.
- The final packaged executable launched a real Cocoa/WKWebView window, established its authenticated local session, rendered the dashboard heading, and exited cleanly through an automated native smoke check using isolated demo storage.

A native probe initially used pywebview's eval-based helper, which was correctly rejected by the application's Content Security Policy. The probe now executes directly through WKWebView without weakening CSP. CSV downloads are enabled in the native shell; the actual native Save dialog remains a manual acceptance check (browser CSV download is automated).

The tests do not establish real BLE reception, stock firmware compatibility across revisions, Keychain permission behavior, or Intel/other macOS-version compatibility. No hardware readings are claimed. The artifact is not Developer ID signed or notarized. See `release.md` for those remaining release acceptance checks.

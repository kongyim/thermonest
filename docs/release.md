# macOS release checklist

Build on the intended architecture with Python 3.12. Run backend, frontend and browser tests, then `scripts/build-macos.sh`. The output is `dist/ThermoNest.app`.

Before public distribution:

1. Verify double-click launch on a clean Mac without developer Python/Node installations; test both supported architectures using separate builds.
2. Test Bluetooth permission accepted, denied, and re-enabled in System Settings. Confirm the usage strings in Info.plist and no indefinite startup/connection wait.
3. Test two or more real stock LYWSD03MMC devices, including identical local names, missing battery characteristic, out-of-range recovery, and sleep/wake. Compare temperatures/humidity to known physical readings.
4. Confirm all mutable files live in Application Support and Keychain. Close and reopen to verify history and room assignment survive. Relocate the app and repeat.
5. Sign bundled code and the app with a Developer ID Application certificate and hardened runtime, then submit a zipped app using `xcrun notarytool submit --wait` with your own Keychain credential profile. Staple the ticket using `xcrun stapler staple`. Verify using `codesign --verify --deep --strict` and `spctl --assess --type execute`.
6. Repeat native launch and Bluetooth tests with the signed/notarized artifact. Signing identities can affect Bluetooth permission attribution, so signing is not just a cosmetic packaging step.

No signing/notarization credentials are supplied in this project. The locally generated app is an ad-hoc development build, not a completed public release.

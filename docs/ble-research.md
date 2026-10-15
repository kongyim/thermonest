# Bluetooth implementation notes

Reviewed 15 October 2026.

## Sources

- [Bleak macOS backend](https://bleak.readthedocs.io/en/latest/backends/macos.html): CoreBluetooth identifiers and permission behavior.
- [Bleak troubleshooting](https://bleak.readthedocs.io/en/stable/troubleshooting.html): usage strings, permission failures, and macOS scanning constraints.
- [Original MiTemperature2 stock reader](https://github.com/JsBergbau/MiTemperature2/blob/master/LYWSD03MMC.py): stock climate notification layout. The project's newer passive reader has different firmware assumptions; ThermoNest does not use its Linux-only transport.
- [BLE Monitor Xiaomi parser](https://github.com/custom-components/ble_monitor/blob/master/custom_components/ble_monitor/ble_parser/xiaomi.py): product IDs, MiBeacon objects, authenticated v4/v5 nonce construction.
- [xiaomi-ble protocol fixtures](https://github.com/Bluetooth-Devices/xiaomi-ble/blob/main/tests/test_parser.py): independent plaintext and encrypted LYWSD03MMC fixtures used to verify the parser. The encrypted humidity payload encodes 46.7%; that project's device-specific display truncates it to 46. ThermoNest retains the encoded precision.

## Stock GATT

The climate characteristic is `ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6` in the proprietary service family. Runtime service discovery must find this characteristic with the `notify` property; a matching local name alone does not confirm compatibility.

The five-byte notification contains signed little-endian temperature in hundredths °C, one-byte humidity percentage, and little-endian battery millivolts. The standard battery characteristic `00002a19-0000-1000-8000-00805f9b34fb` is optional. Its reported value is not a calibrated guarantee; firmware can return unhelpful values. ThermoNest never estimates battery percentage from voltage.

CoreBluetooth's device address is a local peripheral UUID. Reconciliation is explicit: scan, select a candidate, then choose “Reconnect an existing sensor instead.” This preserves history without guessing that two identically named sensors are the same physical device. Embedded MiBeacon address bytes are used only as protocol data, not as an OS address.

## Advertisements

Only MiBeacon service data (`FE95`) for product `0x055B` is accepted. Plaintext object types supported are temperature (`0x1004`), humidity (`0x1006`), battery (`0x100A`), and combined temperature/humidity (`0x100D`). Unsupported object types are skipped without inventing values. A latest sample with only humidity displays temperature as unavailable, rather than silently presenting an older temperature as current.

Encrypted v4/v5 packets require the embedded address, a supplied 16-byte bind key, and a valid AES-CCM four-byte authentication tag. The nonce consists of embedded address bytes, product/counter bytes, and extended counter; additional authenticated data is `0x11`. Legacy encrypted packets and packets lacking nonce material are unsupported. Wrong keys and modified packets fail authentication in tests. There is no key extraction, cloud login, or automatic flashing.

Advertisement sampling happens during bounded discovery scans (approximately once per minute while sensors are registered), supplementing the stock GATT polling loop. This is not a continuous passive radio recorder; packets between scans can be missed. Repeated payloads are suppressed in memory and sampling frequency limits persistence. The counter is not treated as a permanent globally monotonic replay counter across device reboots.

## Honest limits and hardware acceptance

Stock firmware varies. Some revisions or device binding states may restrict GATT access; the app reports connection/unsupported errors and does not bypass authentication. Test actual devices before claiming universal compatibility. Hardware testing should cover permission granted/denied, Bluetooth off, multiple identical sensors, out-of-range recovery, sleep/wake, low battery, signed temperatures, and a real supplied-key encrypted packet.

The macOS bundle declares a 12.3 minimum; actual testing in this workspace is on the host macOS only. No physical BLE sensor measurements or permission prompts have been validated by the automated mock tests.

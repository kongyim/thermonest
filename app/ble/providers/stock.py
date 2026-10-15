import asyncio

from bleak import BleakClient, BleakScanner

from app.ble.parsers.mibeacon import FE95, BindKeyRequired, parse_mibeacon
from app.ble.parsers.stock import BATTERY_UUID, CLIMATE_UUID, parse_notification


class UnsupportedDevice(Exception):
    pass


class StockSensorProvider:
    mock = False

    def __init__(self):
        self.devices = {}
        self.advertisements = {}
        self.lock = asyncio.Lock()

    async def discover(self):
        async with self.lock:
            found = await BleakScanner.discover(timeout=8, return_adv=True)
        candidates = []
        for device, adv in found.values():
            name = adv.local_name or device.name or ""
            payload = adv.service_data.get(FE95)
            verified, encrypted = False, False
            if payload:
                try:
                    parsed = parse_mibeacon(payload)
                    verified = parsed is not None
                    encrypted = bool(parsed and parsed.encrypted)
                except BindKeyRequired:
                    verified, encrypted = True, True
                except ValueError:
                    continue
            # An exact advertised model is a candidate, NOT validated compatibility.
            if not verified and name != "LYWSD03MMC":
                continue
            self.devices[device.address] = device
            if payload:
                self.advertisements[device.address] = payload
            candidates.append(
                {
                    "device_identifier": device.address,
                    "name": name or "LYWSD03MMC",
                    "rssi": adv.rssi,
                    "verified": verified,
                    "encrypted": encrypted,
                }
            )
        return candidates

    async def read(self, identifier, on_status):
        # Serialize scanning and GATT work on the adapter. A bounded outer timeout
        # includes discovery, connection, notification wait, and disconnection.
        async with self.lock:
            async with asyncio.timeout(35):
                device = self.devices.get(identifier)
                if device is None:
                    device = await BleakScanner.find_device_by_address(identifier, timeout=8)
                if device is None:
                    raise TimeoutError("Sensor is out of range")
                async with BleakClient(device, timeout=12) as client:
                    await on_status("Connected")
                    characteristic = client.services.get_characteristic(CLIMATE_UUID)
                    if not characteristic or "notify" not in characteristic.properties:
                        raise UnsupportedDevice("Stock climate notification characteristic is unavailable")
                    future = asyncio.get_running_loop().create_future()

                    def notification(_, data):
                        if future.done():
                            return
                        try:
                            future.set_result(parse_notification(bytes(data)))
                        except ValueError as exc:
                            future.set_exception(exc)

                    await client.start_notify(characteristic, notification)
                    reading = await asyncio.wait_for(future, 15)
                    battery = client.services.get_characteristic(BATTERY_UUID)
                    if battery and "read" in battery.properties:
                        try:
                            raw = await asyncio.wait_for(client.read_gatt_char(battery), 3)
                            if len(raw) == 1 and raw[0] <= 100:
                                reading.battery_level = raw[0]
                        except Exception:
                            pass  # Battery is optional; preserve the valid climate reading.
                    await client.stop_notify(characteristic)
                    return reading

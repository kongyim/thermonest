import asyncio
import logging
import random
import time
from datetime import datetime, timezone

from app.ble.parsers.mibeacon import BindKeyRequired, parse_mibeacon
from app.ble.providers.stock import UnsupportedDevice
from app.services.keys import KeyStore

log = logging.getLogger("thermonest")


class SensorManager:
    def __init__(self, db, provider):
        self.db, self.provider = db, provider
        self.keys = KeyStore()
        self.candidates = {}
        self.tasks = {}
        self.listeners = set()
        self.running = False
        self.supervisor = None
        self.semaphore = asyncio.Semaphore(1)
        self.discovery_lock = asyncio.Lock()
        self.adapter_status = "Demo mode" if provider.mock else "Ready to scan"
        self.advertisement_counters = {}
        self.last_saved = {}

    async def call(self, method, *args, **kwargs):
        return await asyncio.to_thread(method, *args, **kwargs)

    async def publish(self, event):
        for queue in tuple(self.listeners):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(event)

    async def status(self, sensor_id, status, error=None):
        await self.call(self.db.update_sensor, sensor_id, {"status": status, "error": error})
        await self.publish({"type": "status", "sensor_id": sensor_id, "status": status})

    async def start(self):
        self.running = True
        self.supervisor = asyncio.create_task(self.run())

    async def stop(self):
        self.running = False
        tasks = [*self.tasks.values(), *([self.supervisor] if self.supervisor else [])]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def remove(self, sensor_id):
        task = self.tasks.pop(sensor_id, None)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def discover(self):
        if self.discovery_lock.locked():
            return list(self.candidates.values())
        async with self.discovery_lock:
            self.adapter_status = "Discovering"
            await self.publish({"type": "discovery"})
            try:
                async with asyncio.timeout(50):
                    candidates = await self.provider.discover()
                self.candidates = {c["device_identifier"]: c for c in candidates}
                self.adapter_status = "Demo mode" if self.provider.mock else "Bluetooth available"
                # Advertisements supplement GATT; missing fields remain missing.
                if not self.provider.mock:
                    sensors = await self.call(self.db.sensors)
                    settings = await self.call(self.db.settings)
                    for sensor in sensors:
                        identifier = sensor["device_identifier"]
                        candidate = self.candidates.get(identifier)
                        if candidate:
                            await self.call(self.db.update_sensor, sensor["id"], {"rssi": candidate["rssi"]})
                        payload = self.provider.advertisements.get(identifier) if candidate else None
                        if not payload:
                            continue
                        try:
                            key = await self.call(self.keys.get, sensor["id"]) if candidate["encrypted"] else None
                            beacon = parse_mibeacon(payload, key)
                            if beacon and beacon.reading and self.advertisement_counters.get(sensor["id"]) != payload:
                                self.advertisement_counters[sensor["id"]] = payload
                                if (
                                    time.monotonic() - self.last_saved.get(sensor["id"], 0)
                                    >= settings["sampling_seconds"]
                                ):
                                    await self.save(sensor["id"], beacon.reading)
                        except BindKeyRequired:
                            if not sensor["last_seen"]:
                                await self.status(
                                    sensor["id"],
                                    "Bind key required",
                                    "Passive advertisements need a key. Trying stock GATT automatically.",
                                )
                        except Exception:
                            # No payload, bind key or crypto exception text reaches logs.
                            log.info("advertisement_unavailable", extra={"sensor_id": sensor["id"]})
                return candidates
            except Exception as exc:
                self.adapter_status = self.classify(exc)
                await self.publish({"type": "adapter", "status": self.adapter_status})
                raise

    @staticmethod
    def classify(exc):
        message = str(exc).lower()
        if any(word in message for word in ("denied", "not authorized", "unauthorized", "permission")):
            return "Permission denied"
        if isinstance(exc, UnsupportedDevice):
            return "Unsupported"
        if isinstance(exc, (TimeoutError, ConnectionError)):
            return "Disconnected"
        return "Error"

    async def save(self, sensor_id, reading):
        await self.call(self.db.add_reading, sensor_id, reading)
        self.last_saved[sensor_id] = time.monotonic()
        await self.publish({"type": "reading", "sensor_id": sensor_id})

    async def worker(self, sensor_id):
        failures = 0
        while self.running:
            sensor = await self.call(self.db.sensor, sensor_id)
            if not sensor:
                return
            settings = await self.call(self.db.settings)
            delay = settings["sampling_seconds"]
            try:
                async with self.semaphore:
                    await self.status(sensor_id, "Connecting")
                    reading = await self.provider.read(sensor["device_identifier"], lambda s: self.status(sensor_id, s))
                    await self.save(sensor_id, reading)
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                failures += 1
                status = self.classify(exc)
                errors = {
                    "Permission denied": "Allow Bluetooth for ThermoNest in System Settings → Privacy & Security → Bluetooth.",
                    "Unsupported": "This device does not expose the supported stock GATT notification characteristic.",
                    "Disconnected": "No reading received. Move the sensor closer and close other apps connected to it.",
                    "Error": "Bluetooth reading failed. Check Bluetooth is enabled and retry discovery.",
                }
                await self.status(sensor_id, status, errors[status])
                log.info("sensor_read_failed", extra={"sensor_id": sensor_id, "state": status})
                delay = min(900, 5 * 2 ** min(failures, 8)) + random.uniform(0, 3)
            await asyncio.sleep(delay)

    async def run(self):
        next_scan = time.monotonic() + 60
        while self.running:
            sensors = await self.call(self.db.sensors)
            settings = await self.call(self.db.settings)
            for sensor in sensors:
                sid = sensor["id"]
                if sid not in self.tasks or self.tasks[sid].done():
                    self.tasks[sid] = asyncio.create_task(self.worker(sid))
                if sensor["last_seen"] and sensor["status"] in ("Receiving", "Connected"):
                    age = (datetime.now(timezone.utc) - datetime.fromisoformat(sensor["last_seen"])).total_seconds()
                    if age > max(180, settings["sampling_seconds"] * 3):
                        await self.status(sid, "Stale")
            if sensors and time.monotonic() >= next_scan:
                try:
                    await self.discover()
                except Exception:
                    pass
                next_scan = time.monotonic() + 60
            await asyncio.sleep(1)

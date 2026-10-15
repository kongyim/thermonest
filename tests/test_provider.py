import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.ble.providers.stock import StockSensorProvider
from app.models.schemas import Reading
from app.services.manager import SensorManager
from app.storage.database import Database


async def test_discovery_rejects_unrelated_names(monkeypatch):
    devices = {
        "a": (
            SimpleNamespace(address="uuid-a", name="Xiaomi phone"),
            SimpleNamespace(local_name="Xiaomi phone", service_data={}, rssi=-50),
        ),
        "b": (
            SimpleNamespace(address="uuid-b", name="LYWSD03MMC"),
            SimpleNamespace(local_name="LYWSD03MMC", service_data={}, rssi=-60),
        ),
    }
    monkeypatch.setattr("app.ble.providers.stock.BleakScanner.discover", AsyncMock(return_value=devices))
    results = await StockSensorProvider().discover()
    assert len(results) == 1
    assert results[0]["device_identifier"] == "uuid-b"
    assert results[0]["verified"] is False


async def test_scheduler_limits_connections_and_cancels(tmp_path):
    class Provider:
        mock = True
        active = 0
        maximum = 0

        async def read(self, identifier, on_status):
            self.active += 1
            self.maximum = max(self.maximum, self.active)
            try:
                await asyncio.sleep(0.03)
                return Reading(temperature_c=22)
            finally:
                self.active -= 1

    db = Database(tmp_path / "test.sqlite3")
    for i in range(3):
        db.add_sensor({"display_name": str(i), "room_id": None, "device_identifier": str(i)})
    provider = Provider()
    manager = SensorManager(db, provider)
    await manager.start()
    await asyncio.sleep(0.3)
    await manager.stop()
    assert provider.maximum == 1
    assert all(t.done() for t in manager.tasks.values())
    assert len(db.rows("SELECT * FROM readings")) == 3
    db.engine.dispose()

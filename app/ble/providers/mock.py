import asyncio
import math
import time

from app.models.schemas import Reading


class MockSensorProvider:
    mock = True

    async def discover(self):
        await asyncio.sleep(0.3)
        return [
            {
                "device_identifier": f"demo-{i}",
                "name": f"LYWSD03MMC · Demo {i + 1}",
                "rssi": -48 - i * 7,
                "verified": True,
                "encrypted": False,
            }
            for i in range(5)
        ]

    async def read(self, identifier, on_status):
        await on_status("Connected")
        await asyncio.sleep(0.2)
        i = int(identifier.split("-")[-1])
        return Reading(
            temperature_c=round(21 + i * 0.6 + math.sin(time.time() / 180 + i) * 0.8, 2),
            humidity_percent=round(43 + i * 3 + math.sin(time.time() / 200 + i) * 4, 1),
            battery_level=94 - i * 9,
        )

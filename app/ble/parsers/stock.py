import struct

from app.models.schemas import Reading

CLIMATE_UUID = "ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6"
SERVICE_UUID = "ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6"
BATTERY_UUID = "00002a19-0000-1000-8000-00805f9b34fb"


def parse_notification(data: bytes) -> Reading:
    if len(data) != 5:
        raise ValueError("Expected a five-byte stock climate notification")
    temperature, humidity, voltage = struct.unpack("<hBH", data)
    # Voltage is recorded as voltage, never converted into an invented battery percentage.
    return Reading(temperature_c=temperature / 100, humidity_percent=humidity, voltage_mv=voltage)

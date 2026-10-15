"""Conservative FE95 MiBeacon v4/v5 reader, restricted to product 0x055B.

Input is service data, WITHOUT the AD length/type/FE95 prefix.
Legacy encryption and unknown products fail closed. MAC bytes embedded in the
packet are protocol nonce material, never CoreBluetooth peripheral identifiers.
"""

import struct
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESCCM

from app.models.schemas import Reading

FE95 = "0000fe95-0000-1000-8000-00805f9b34fb"


class BindKeyRequired(ValueError):
    pass


@dataclass
class Beacon:
    encrypted: bool
    identity: str | None
    counter: int
    reading: Reading | None


def parse_mibeacon(data: bytes, key: bytes | None = None) -> Beacon | None:
    if len(data) < 5:
        return None
    frame, product, counter = struct.unpack_from("<HHB", data)
    if product != 0x055B:
        return None
    if frame >> 12 not in (3, 4, 5):
        raise ValueError("Unsupported MiBeacon version")
    cursor, mac = 5, None
    if frame & 0x10:
        if len(data) < 11:
            raise ValueError("Truncated MiBeacon address")
        mac, cursor = data[5:11], 11
    if frame & 0x20:
        if len(data) <= cursor:
            raise ValueError("Truncated capabilities")
        capability = data[cursor]
        cursor += 1
        if capability & 0x20:
            cursor += 1
    if cursor > len(data):
        raise ValueError("Truncated capabilities")
    encrypted = bool(frame & 8)
    result = Beacon(encrypted, mac.hex() if mac else None, counter, None)
    if not frame & 0x40:
        return result
    payload = data[cursor:]
    if encrypted:
        if frame >> 12 not in (4, 5):
            raise ValueError("Legacy encryption is unsupported")
        if key is None:
            raise BindKeyRequired("A bind key is required for passive advertisements; stock GATT remains available")
        if mac is None or len(payload) < 8:
            raise ValueError("Encrypted MiBeacon requires embedded address and authentication tag")
        nonce = mac + data[2:5] + data[-7:-4]
        payload = AESCCM(key, tag_length=4).decrypt(nonce, data[cursor:-7] + data[-4:], b"\x11")
    values = {}
    cursor = 0
    while cursor < len(payload):
        if len(payload) - cursor < 3:
            raise ValueError("Truncated MiBeacon object")
        kind, size = struct.unpack_from("<HB", payload, cursor)
        cursor += 3
        value = payload[cursor : cursor + size]
        if len(value) != size:
            raise ValueError("Truncated MiBeacon value")
        cursor += size
        if kind == 0x100D and size == 4:
            t, h = struct.unpack("<hH", value)
            values.update(temperature_c=t / 10, humidity_percent=h / 10)
        elif kind == 0x1004 and size == 2:
            values["temperature_c"] = struct.unpack("<h", value)[0] / 10
        elif kind == 0x1006 and size == 2:
            values["humidity_percent"] = int.from_bytes(value, "little") / 10
        elif kind == 0x100A and size == 1:
            values["battery_level"] = value[0]
    if values:
        result.reading = Reading(**values)
    return result

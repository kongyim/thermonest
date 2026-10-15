import struct

import pytest
from cryptography.exceptions import InvalidTag

from app.ble.parsers.mibeacon import BindKeyRequired, parse_mibeacon
from app.ble.parsers.stock import parse_notification


def test_stock_signed_temperature_and_voltage():
    reading = parse_notification(struct.pack("<hBH", -525, 48, 2987))
    assert reading.temperature_c == -5.25
    assert reading.humidity_percent == 48
    assert reading.voltage_mv == 2987
    assert reading.battery_level is None


@pytest.mark.parametrize("payload", [b"", b"\x00" * 4, b"\x00" * 6, struct.pack("<hBH", 2000, 101, 3000)])
def test_invalid_stock(payload):
    with pytest.raises(ValueError):
        parse_notification(payload)


# Public upstream protocol fixtures, not user keys:
# https://github.com/Bluetooth-Devices/xiaomi-ble/blob/main/tests/test_parser.py
PLAINTEXT = bytes.fromhex("50305b05034c94b438c1a40d10041001ea01")
ENCRYPTED = b"XX[\x05P\xf4\x83\x028\xc1\xa4\x95\xefXv<&\x00\x00\x97\xe2\xab\xb5"
FIXTURE_KEY = bytes.fromhex("e9ea895fac7cca6d30532432a516f3a8")


def test_upstream_plaintext_fixture():
    reading = parse_mibeacon(PLAINTEXT).reading
    assert reading.temperature_c == 27.2
    assert reading.humidity_percent == 49
    assert reading.battery_level is None


def test_verified_encrypted_fixture():
    with pytest.raises(BindKeyRequired):
        parse_mibeacon(ENCRYPTED)
    result = parse_mibeacon(ENCRYPTED, FIXTURE_KEY)
    assert result.encrypted
    # Upstream truncates this model to integer display precision; preserve raw tenths.
    assert result.reading.humidity_percent == 46.7
    assert result.reading.temperature_c is None
    with pytest.raises(InvalidTag):
        parse_mibeacon(ENCRYPTED, bytes(16))
    with pytest.raises(InvalidTag):
        parse_mibeacon(ENCRYPTED[:-1] + b"\x00", FIXTURE_KEY)


def test_unrelated_product_and_truncation():
    assert parse_mibeacon(b"") is None
    assert parse_mibeacon(PLAINTEXT[:2] + b"\x01\x01" + PLAINTEXT[4:]) is None
    with pytest.raises(ValueError):
        parse_mibeacon(PLAINTEXT[:-1])

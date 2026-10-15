"""Explicit macOS Keychain backend: never fall back to plaintext keyring providers."""

import sys


class KeyStore:
    def __init__(self):
        self.cache = {}

    def _backend(self):
        if sys.platform != "darwin":
            raise RuntimeError("Bind keys require macOS Keychain")
        from keyring.backends.macOS import Keyring

        return Keyring()

    def get(self, sensor_id):
        if sensor_id not in self.cache:
            value = self._backend().get_password("ThermoNest", sensor_id)
            self.cache[sensor_id] = bytes.fromhex(value) if value else None
        return self.cache[sensor_id]

    def put(self, sensor_id, value):
        self._backend().set_password("ThermoNest", sensor_id, value)
        self.cache[sensor_id] = bytes.fromhex(value)

    def delete(self, sensor_id):
        from keyring.errors import PasswordDeleteError

        try:
            self._backend().delete_password("ThermoNest", sensor_id)
        except PasswordDeleteError:
            pass
        self.cache.pop(sensor_id, None)

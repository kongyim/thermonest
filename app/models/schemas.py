from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Status(StrEnum):
    DISCOVERING = "Discovering"
    CONNECTING = "Connecting"
    CONNECTED = "Connected"
    RECEIVING = "Receiving"
    STALE = "Stale"
    DISCONNECTED = "Disconnected"
    UNSUPPORTED = "Unsupported"
    PERMISSION_DENIED = "Permission denied"
    BIND_KEY_REQUIRED = "Bind key required"
    ERROR = "Error"


class Reading(BaseModel):
    temperature_c: float | None = Field(default=None, ge=-50, le=100)
    humidity_percent: float | None = Field(default=None, ge=0, le=100)
    battery_level: int | None = Field(default=None, ge=0, le=100)
    voltage_mv: int | None = Field(default=None, ge=0, le=5000)


class SensorCreate(BaseModel):
    device_identifier: str = Field(min_length=1, max_length=200)
    display_name: str = Field(min_length=1, max_length=80)
    room_id: str | None = None


class SensorPatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    room_id: str | None = None
    device_identifier: str | None = Field(default=None, min_length=1, max_length=200)


class RoomInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    sort_order: int = 0


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    battery_mode: str | None = Field(default=None, pattern="^(passive|balanced|custom)$")
    sampling_seconds: int | None = Field(default=None, ge=30, le=3600)
    theme: str | None = Field(default=None, pattern="^(system|light|dark)$")


class BindKeyInput(BaseModel):
    key: str = Field(pattern="^[0-9a-fA-F]{32}$", repr=False)

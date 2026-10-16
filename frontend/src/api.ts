export type Status =
  | "Discovering"
  | "Connecting"
  | "Connected"
  | "Receiving"
  | "Stale"
  | "Disconnected"
  | "Unsupported"
  | "Permission denied"
  | "Bind key required"
  | "Error";
export interface Sensor {
  id: string;
  display_name: string;
  room_id: string | null;
  room_name: string | null;
  device_identifier: string;
  model: string;
  firmware_type: string;
  last_seen: string | null;
  temperature_c: number | null;
  humidity_percent: number | null;
  battery_level: number | null;
  rssi: number | null;
  status: Status;
  error: string | null;
}
export interface Room {
  id: string;
  name: string;
  sort_order: number;
}
export interface Reading {
  timestamp: string;
  temperature_c: number | null;
  humidity_percent: number | null;
  battery_level: number | null;
}
export interface Candidate {
  device_identifier: string;
  name: string;
  rssi: number;
  verified: boolean;
  encrypted: boolean;
}
export interface Settings {
  battery_mode: "passive" | "balanced" | "custom";
  sampling_seconds: number;
  theme: "system" | "light" | "dark";
  mock: boolean;
}
export interface Summary {
  total: number;
  online: number;
  offline: number;
  temperature_c: number | null;
  humidity_percent: number | null;
  last_updated: string | null;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-ThermoNest": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "The local service could not be reached" }));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : "Please check the values entered",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function isFresh(sensor: Sensor, sampling = 120) {
  return (
    !!sensor.last_seen &&
    Date.now() - Date.parse(sensor.last_seen) <
      Math.max(180, sampling * 3) * 1000
  );
}
export function number(value: number | null | undefined, digits = 1) {
  return value == null ? "—" : value.toFixed(digits);
}
export function ago(value: string | null) {
  if (!value) return "Waiting for a reading";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 1000),
  );
  return seconds < 10
    ? "Just now"
    : seconds < 60
      ? `${seconds}s ago`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ago`
        : `${Math.floor(seconds / 3600)}h ago`;
}

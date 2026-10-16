import type { Reading } from "./api";

// Sensors report asynchronously. Compare nearby actual samples, never reuse
// another series' value or interpolate a measurement for the tooltip.
export function nearestReading(
  readings: Reading[],
  timestamp: number,
  toleranceMs: number,
): Reading | undefined {
  let nearest: Reading | undefined;
  let distance = Infinity;
  for (const reading of readings) {
    const delta = Math.abs(Date.parse(reading.timestamp) - timestamp);
    if (delta <= toleranceMs && delta < distance) {
      nearest = reading;
      distance = delta;
    }
  }
  return nearest;
}

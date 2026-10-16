import { describe, expect, it } from "vitest";
import { nearestReading } from "./history";
import type { Reading } from "./api";

function sample(
  time: string,
  temperature: number | null,
  humidity = 50,
): Reading {
  return {
    timestamp: time,
    temperature_c: temperature,
    humidity_percent: humidity,
    battery_level: null,
  };
}

describe("comparison tooltip samples", () => {
  const time = Date.parse("2026-10-16T11:56:36Z");
  it("keeps different sensors' temperatures and humidity separate at staggered times", () => {
    const bedroom = [sample("2026-10-16T11:56:30Z", 21.8, 43)];
    const kitchen = [sample("2026-10-16T11:56:40Z", 19.6, 61)];
    const other = [sample("2026-10-16T11:56:36Z", 20.3, 55)];
    expect(
      [bedroom, kitchen, other].map(
        (data) => nearestReading(data, time, 300000)?.temperature_c,
      ),
    ).toEqual([21.8, 19.6, 20.3]);
    expect(
      [bedroom, kitchen, other].map(
        (data) => nearestReading(data, time, 300000)?.humidity_percent,
      ),
    ).toEqual([43, 61, 55]);
  });
  it("does not substitute distant readings or another sample for missing measurements", () => {
    expect(nearestReading([], time, 300000)).toBeUndefined();
    expect(
      nearestReading([sample("2026-10-16T10:00:00Z", 22)], time, 300000),
    ).toBeUndefined();
    const readings = [
      sample("2026-10-16T11:55:00Z", 22),
      sample("2026-10-16T11:56:36Z", null),
    ];
    expect(nearestReading(readings, time, 300000)?.temperature_c).toBeNull();
    expect(
      nearestReading([sample("2026-10-16T11:56:36Z", 0)], time, 300000)
        ?.temperature_c,
    ).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  distancePixels,
  distanceMeters,
  estimateTemperature,
  temperatureColor,
  clampPoint,
  type FloorPlan,
} from "./floor-plan";
const plan: FloorPlan = {
  revision: "test",
  width: 1000,
  height: 500,
  calibration: {
    a: { x: 0, y: 0 },
    b: { x: 1, y: 0 },
    distance_m: 10,
    meters_per_pixel: 0.01,
  },
  positions: [],
};
describe("floor plan geometry and temperature estimates", () => {
  it("uses image aspect ratio and calibration, independent of screen zoom", () => {
    expect(distancePixels({ x: 0, y: 0 }, { x: 0.3, y: 0.8 }, 1000, 500)).toBe(
      500,
    );
    expect(distanceMeters({ x: 0, y: 0 }, { x: 0.3, y: 0.8 }, plan)).toBe(5);
    expect(
      distanceMeters(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { ...plan, calibration: null },
      ),
    ).toBeNull();
  });
  it("interpolates real-distance neighbours and fades beyond coverage", () => {
    const points = [
      { x: 0, y: 0.5, temperature: 18 },
      { x: 1, y: 0.5, temperature: 26 },
    ];
    expect(
      estimateTemperature({ x: 0.5, y: 0.5 }, points, plan, 6)?.temperature,
    ).toBeCloseTo(22);
    expect(
      estimateTemperature({ x: 0, y: 0.5 }, points, plan, 6)?.temperature,
    ).toBe(18);
    expect(estimateTemperature({ x: 0.5, y: 0.5 }, points, plan, 4)).toBeNull();
    expect(estimateTemperature({ x: 0, y: 0 }, [], plan, 5)).toBeNull();
    expect(
      estimateTemperature(
        { x: 0, y: 0 },
        points,
        { ...plan, calibration: null },
        5,
      ),
    ).toBeNull();
  });
  it("keeps valid zero temperature and bounds colour and placements", () => {
    expect(
      estimateTemperature(
        { x: 0, y: 0 },
        [{ x: 0, y: 0, temperature: 0 }],
        plan,
        5,
      )?.temperature,
    ).toBe(0);
    expect(temperatureColor(-5)).toEqual(temperatureColor(16));
    expect(temperatureColor(40)).toEqual(temperatureColor(28));
    expect(clampPoint({ x: -0.3, y: 2 })).toEqual({ x: 0, y: 1 });
  });
});

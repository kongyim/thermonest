export interface Point {
  x: number;
  y: number;
}
export interface Position extends Point {
  sensor_id: string;
}
export interface Calibration {
  a: Point;
  b: Point;
  distance_m: number;
  meters_per_pixel: number;
}
export interface FloorPlan {
  revision: string;
  width: number;
  height: number;
  calibration: Calibration | null;
  positions: Position[];
}
export interface TemperaturePoint extends Point {
  temperature: number;
}
export function distancePixels(
  a: Point,
  b: Point,
  width: number,
  height: number,
) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}
export function distanceMeters(a: Point, b: Point, plan: FloorPlan) {
  return plan.calibration
    ? distancePixels(a, b, plan.width, plan.height) *
        plan.calibration.meters_per_pixel
    : null;
}
// A bounded inverse-square estimate in real-world distance, not screen coordinates.
// No reading is generated or persisted by this visualization.
export function estimateTemperature(
  point: Point,
  samples: TemperaturePoint[],
  plan: FloorPlan,
  radius: number,
) {
  if (!plan.calibration || radius <= 0) return null;
  let weighted = 0,
    weights = 0,
    nearest = Infinity;
  for (const sample of samples) {
    const d = distanceMeters(point, sample, plan)!;
    if (d >= radius) continue;
    nearest = Math.min(nearest, d);
    if (d < 1e-6) return { temperature: sample.temperature, confidence: 1 };
    const weight = Math.pow(1 - d / radius, 2) / (d * d);
    weighted += sample.temperature * weight;
    weights += weight;
  }
  return weights
    ? {
        temperature: weighted / weights,
        confidence: Math.pow(1 - nearest / radius, 0.5),
      }
    : null;
}
export const temperatureStops = [
  { t: 16, rgb: [75, 126, 203] },
  { t: 20, rgb: [86, 170, 180] },
  { t: 24, rgb: [225, 191, 100] },
  { t: 28, rgb: [209, 99, 78] },
];
export function temperatureColor(value: number): [number, number, number] {
  const t = Math.min(28, Math.max(16, value));
  const index = Math.min(2, Math.floor((t - 16) / 4));
  const a = temperatureStops[index],
    b = temperatureStops[index + 1];
  const fraction = (t - a.t) / (b.t - a.t);
  return a.rgb.map((v, i) => Math.round(v + (b.rgb[i] - v) * fraction)) as [
    number,
    number,
    number,
  ];
}
export function clampPoint(p: Point): Point {
  return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
}

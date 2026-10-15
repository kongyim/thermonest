import { expect, type Page } from "@playwright/test";
export async function exerciseFloorPlan(page: Page) {
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Put your home on the map." }),
  ).toBeVisible();
  await page
    .getByLabel("Upload floor-plan image")
    .setInputFiles("../tests/fixtures/floor-plan.png");
  await expect(page.getByAltText("Your uploaded floor plan")).toBeVisible();
  const map = page.getByTestId("map-surface");
  async function point(x: number, y: number) {
    const box = await map.boundingBox();
    if (!box) throw new Error("Map not visible");
    await map.click({ position: { x: box.width * x, y: box.height * y } });
  }
  await page.getByRole("button", { name: "Set scale", exact: true }).click();
  await point(0.1, 0.1);
  await point(0.6, 0.1);
  await page.getByLabel("Known distance").fill("9");
  await page.getByRole("button", { name: "Save scale" }).click();
  await expect(page.locator(".map-size")).toHaveText(
    "Image extent: 18.00 m × 12.00 m",
  );
  await page
    .locator(".map-sensor-list")
    .getByRole("button", { name: /Window sensor/ })
    .click();
  await point(0.25, 0.35);
  const pin = page.getByRole("button", {
    name: "Move Window sensor",
    exact: true,
  });
  await expect(pin).toBeVisible();
  await expect(pin).toBeEnabled();
  const sensors = await (await page.request.get("/api/sensors")).json();
  const sid = sensors[0].id;
  await expect
    .poll(async () => {
      const p = await (await page.request.get("/api/floor-plan")).json();
      return p.positions[0]?.x;
    })
    .toBeCloseTo(0.25, 2);
  // A second actual mock-provider reading makes the temperature overlay exercise blending.
  const extra = await (
    await page.request.post("/api/sensors", {
      headers: { "x-thermonest": "1" },
      data: { device_identifier: "demo-1", display_name: "Bedroom sensor" },
    })
  ).json();
  await expect(
    page
      .locator(".map-sensor-list")
      .getByRole("button", { name: /Bedroom sensor/ }),
  ).toBeVisible();
  await page
    .locator(".map-sensor-list")
    .getByRole("button", { name: /Bedroom sensor/ })
    .click();
  await point(0.7, 0.65);
  await expect
    .poll(async () => {
      const list = await (await page.request.get("/api/sensors")).json();
      return list.find((s: { id: string }) => s.id === extra.id)?.temperature_c;
    })
    .not.toBeNull();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const box = await map.boundingBox();
  const dot = await pin.locator(".pin-dot").boundingBox();
  if (!box || !dot) throw new Error("Missing map pin");
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const p = await (await page.request.get("/api/floor-plan")).json();
      return p.positions.find((s: { sensor_id: string }) => s.sensor_id === sid)
        ?.x;
    })
    .toBeCloseTo(0.45, 2);
  await page.getByRole("button", { name: "Fit floor plan" }).click();
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  await point(0.1, 0.1);
  await point(0.6, 0.1);
  await expect(page.locator(".map-instruction")).toHaveText(
    "Measured distance: 9.00 m",
  );
  await page.getByLabel("Map distance units").selectOption("ft");
  await expect(page.locator(".map-instruction")).toHaveText(
    "Measured distance: 29.53 ft",
  );
  await page.getByLabel("Map distance units").selectOption("m");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(async () =>
      page.getByTestId("temperature-overlay").evaluate((el) => {
        const c = el as HTMLCanvasElement;
        return c
          .getContext("2d")!
          .getImageData(0, 0, c.width, c.height)
          .data.some((v, i) => i % 4 === 3 && v > 0);
      }),
    )
    .toBe(true);
  await page.getByLabel("Show estimated overlay").uncheck();
  await expect(page.getByTestId("temperature-overlay")).toHaveCSS(
    "opacity",
    "0",
  );
  await page.getByLabel("Show estimated overlay").check();
  await page.reload();
  await page.getByRole("button", { name: "Floor plan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Move Window sensor", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".map-size")).toHaveText(
    "Image extent: 18.00 m × 12.00 m",
  );
  await page.screenshot({ path: "../docs/floor-plan.png", fullPage: true });
  // Replacing requires an explicit confirmation and preserves sensor history.
  await page
    .getByLabel("Upload floor-plan image")
    .setInputFiles("../tests/fixtures/floor-plan.png");
  await page.getByRole("button", { name: "Keep current plan" }).click();
  await expect(
    page.getByRole("button", { name: "Move Window sensor", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Upload floor-plan image")
    .setInputFiles("../tests/fixtures/floor-plan.png");
  await page
    .getByRole("button", { name: "Replace floor plan", exact: true })
    .click();
  await expect(page.locator(".map-size")).toHaveText("Scale not set");
  await expect(
    page.getByRole("button", { name: "Move Window sensor", exact: true }),
  ).toHaveCount(0);
  const history = await (
    await page.request.get(`/api/sensors/${sid}/readings`)
  ).json();
  expect(history.length).toBeGreaterThan(0);
  await page.request.delete(`/api/sensors/${extra.id}`, {
    headers: { "x-thermonest": "1" },
  });
}

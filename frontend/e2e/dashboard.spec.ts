import { exerciseFloorPlan } from "./floor-plan-flow";
import { test, expect } from "@playwright/test";
test("local onboarding, live readings, history, settings and removal", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/bootstrap?key=e2e-only-bootstrap");
  await expect(
    page.getByRole("heading", { name: "A feel for every room." }),
  ).toBeVisible();
  await expect(page.getByText("Demo workspace", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage rooms" }).click();
  await page.getByLabel("New room").fill("Living Room");
  await page.getByRole("button", { name: "Add room", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Living Room Rename" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add sensor", exact: true }).click();
  await page.getByRole("button", { name: "Scan for sensors" }).click();
  await page.getByRole("button", { name: /LYWSD03MMC · Demo 1/ }).click();
  await page.getByLabel("Sensor name").fill("Window sensor");
  await page
    .getByLabel("Room", { exact: true })
    .selectOption({ label: "Living Room" });
  await page
    .getByRole("button", { name: "Add sensor", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Living Room", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Receiving", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "7d", exact: true }).click();
  await page.getByRole("button", { name: "Humidity", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export history as CSV" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "thermonest-readings.csv",
  );
  await page.screenshot({ path: "../docs/dashboard.png", fullPage: true });
  await exerciseFloorPlan(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Sampling frequency").selectOption("60");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Sampling frequency")).toHaveValue("60");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Edit Window sensor" }).click();
  await page.getByLabel("Sensor name").fill("Sofa sensor");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Edit Sofa sensor" }).click();
  await page
    .getByRole("button", { name: "Remove sensor", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Yes, delete sensor and history" })
    .click();
  await expect(
    page.getByRole("heading", { name: "A comfortable home starts here." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

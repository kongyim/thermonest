import { describe, it, expect, vi, afterEach } from "vitest";
import { api, isFresh, number, type Sensor } from "./api";
afterEach(() => vi.restoreAllMocks());
describe("honest reading display", () => {
  it("preserves zero and missing values", () => {
    expect(number(null)).toBe("—");
    expect(number(0)).toBe("0.0");
  });
  it("marks old and never-seen sensors stale", () => {
    expect(isFresh({ last_seen: null } as Sensor)).toBe(false);
    expect(
      isFresh({
        last_seen: new Date(Date.now() - 600000).toISOString(),
      } as Sensor),
    ).toBe(false);
    expect(isFresh({ last_seen: new Date().toISOString() } as Sensor)).toBe(
      true,
    );
  });
  it("uses the local CSRF header and surfaces API errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ detail: "Bluetooth permission denied" }),
          { status: 503 },
        ),
      );
    await expect(api("/sensors/discover", "POST")).rejects.toThrow(
      "Bluetooth permission denied",
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toHaveProperty(
      "X-ThermoNest",
      "1",
    );
  });
});

import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8766",
    viewport: { width: 1320, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "../.venv/bin/python ../scripts/test_server.py",
    url: "http://127.0.0.1:8766/bootstrap?key=readiness-probe",
    reuseExistingServer: false,
    timeout: 30000,
  },
  timeout: 30000,
});

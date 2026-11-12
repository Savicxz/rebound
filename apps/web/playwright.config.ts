import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const localPython = path.join(
  root,
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
const python =
  process.env.REBOUND_TEST_PYTHON ||
  (existsSync(localPython) ? localPython : "python");
export default defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  expect: { timeout: 30000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1100 },
  },
  webServer: [
    {
      command: `"${python}" apps/web/scripts/e2e-stack.py`,
      cwd: root,
      url: "http://127.0.0.1:8101/api/v1/health",
      timeout: 60000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
    {
      command:
        "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101",
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        API_INTERNAL_URL: "http://127.0.0.1:8101",
        REBOUND_NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});

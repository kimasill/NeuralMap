import { defineConfig, devices } from "@playwright/test";

// The smoke suite runs against the Vite dev server with no API/DB: the workbench
// falls back to sample memory, which is enough to exercise the graph render path
// (including the 3D WebGL canvas) and catch render-time regressions.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5192", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    { command: "node e2e/server.mjs", url: "http://127.0.0.1:18092/api/health", reuseExistingServer: false, timeout: 60_000 },
    { command: "node node_modules/vite/bin/vite.js web --host 127.0.0.1 --port 5192 --strictPort", url: "http://127.0.0.1:5192",
      reuseExistingServer: false, timeout: 60_000, env: { VITE_API_BASE_URL: "http://127.0.0.1:18092" } },
  ],
});

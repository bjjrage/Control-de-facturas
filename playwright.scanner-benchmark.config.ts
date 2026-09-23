import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /scanner-detection-benchmark\.spec\.ts/,
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3011",
    browserName: "chromium",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3011",
    url: "http://127.0.0.1:3011/scanner/benchmark",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

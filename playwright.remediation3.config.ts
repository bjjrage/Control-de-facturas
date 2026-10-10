import { defineConfig } from "@playwright/test";
import { assertNonProductionTestTarget } from "./test-utils/external-test-target";

// This certification owns its app process and requires explicit loopback env
// values, which override any developer .env defaults inherited by Next.js.
for (const key of ["TEST_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required for isolated Remediation 3 E2E`);
  assertNonProductionTestTarget({ url: value, label: `Remediation 3 ${key}` });
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname)) {
    throw new Error(`${key} must use loopback for ephemeral certification`);
  }
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Ephemeral Supabase API credentials are required");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "invoice-item-integrity.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/remediation3" }]],
  use: {
    baseURL: "http://127.0.0.1:3013",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3013",
    url: "http://127.0.0.1:3013/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3013" },
  },
});

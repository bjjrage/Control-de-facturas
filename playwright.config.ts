import { defineConfig, devices } from "@playwright/test";
import {
  createGuardedLocalWebServer,
  loadPlaywrightTestEnvironment,
} from "./test-utils/playwright-safety";
import { assertNonProductionTestTarget } from "./test-utils/external-test-target";

// Cargar el entorno de desarrollo con la misma precedencia que Next.js.
loadPlaywrightTestEnvironment();

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const webServer = createGuardedLocalWebServer(BASE_URL, "Playwright application target");
for (const [name, value] of Object.entries(process.env)) {
  if (
    value &&
    [
      "DATABASE_URL",
      "DIRECT_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_URL",
      "E2E_SUPABASE_URL",
      "TEST_DATABASE_URL",
      "TEST_SUPABASE_URL",
      "SUPABASE_TEST_URL",
    ].includes(name)
  ) {
    assertNonProductionTestTarget({ url: value, label: `Playwright ${name}` });
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  // Tiempo máximo por test
  timeout: 30_000,
  // Tiempo máximo para expect
  expect: { timeout: 10_000 },

  // En CI fallar rápido, localmente reintentar 1 vez para flakiness de red
  retries: process.env.CI ? 0 : 1,
  workers: 1, // Tests secuenciales: comparten estado del entorno local de prueba

  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  webServer,
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
  },

  projects: [
    // Step 1: setup — hace login y guarda la sesión
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { storageState: undefined },
    },
    // Step 2: todos los tests E2E usando la sesión guardada
    {
      name: "e2e",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /bim-certification\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        storageState: "tests/e2e/.auth/admin.json",
      },
    },
  ],
});

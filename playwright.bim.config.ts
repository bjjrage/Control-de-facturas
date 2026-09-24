import { defineConfig } from "@playwright/test";
import {
  createGuardedLocalWebServer,
  loadPlaywrightTestEnvironment,
} from "./test-utils/playwright-safety";
import { assertNonProductionTestTarget } from "./test-utils/external-test-target";

/**
 * Configuración EXCLUSIVA para la certificación BIM E2E contra infraestructura
 * efímera local (GitHub Actions: Supabase local + Next.js local).
 *
 * Utiliza un servidor local administrado por Playwright y valida los destinos
 * de base de datos antes de iniciar las pruebas. Esta config:
 *   - solo corre tests/e2e/bim-certification.spec.ts
 *   - baseURL loopback (default http://127.0.0.1:3000, override BIM_BASE_URL)
 *   - sin storageState compartido (el login ocurre dentro del test)
 *   - timeouts largos (parseo IFC + matching)
 *   - WebGL por software habilitado (SwiftShader) para el viewer Three.js
 */

const serverMode = process.env.BIM_SERVER_MODE === "production" ? "production" : "development";
loadPlaywrightTestEnvironment(serverMode);

const BASE_URL = process.env.BIM_BASE_URL ?? "http://127.0.0.1:3000";
const webServer = createGuardedLocalWebServer(BASE_URL, "BIM Playwright application target", {
  serverMode,
});
for (const [name, value] of Object.entries(process.env)) {
  if (
    value &&
    [
      "BIM_TEST_SUPABASE_URL",
      "DATABASE_URL",
      "DIRECT_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_DB_URL",
      "SUPABASE_URL",
      "TEST_DATABASE_URL",
      "TEST_SUPABASE_URL",
    ].includes(name)
  ) {
    assertNonProductionTestTarget({ url: value, label: `BIM Playwright ${name}` });
  }
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /bim-certification\.spec\.ts/,
  // Un solo test largo: parseo IFC, matching y reload.
  timeout: 600_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  webServer,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/bim" }],
  ],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    screenshot: "off",
    video: "retain-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--enable-unsafe-swiftshader"],
    },
  },
});

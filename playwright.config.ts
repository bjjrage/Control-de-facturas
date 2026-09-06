import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";
import * as path from "path";

// Cargar .env.local para E2E_PASSWORD y demás variables
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const BASE_URL = "https://control-de-facturas-bay.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  // Tiempo máximo por test
  timeout: 30_000,
  // Tiempo máximo para expect
  expect: { timeout: 10_000 },

  // En CI fallar rápido, localmente reintentar 1 vez para flakiness de red
  retries: process.env.CI ? 0 : 1,
  workers: 1, // Tests secuenciales — comparten estado de producción

  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  use: {
    baseURL: BASE_URL,
    // Guardar sesión en un archivo para reusar entre tests y no loguear en cada uno
    storageState: "tests/e2e/.auth/admin.json",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
  },

  projects: [
    // Step 1: setup — hace login y guarda la sesión
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { storageState: undefined }, // setup no usa estado guardado
    },
    // Step 2: todos los tests E2E usando la sesión guardada
    {
      name: "e2e",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
    },
  ],
});

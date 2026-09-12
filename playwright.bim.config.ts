import { defineConfig } from "@playwright/test";

/**
 * Configuración EXCLUSIVA para la certificación BIM E2E contra infraestructura
 * efímera local (GitHub Actions: Supabase local + Next.js local).
 *
 * NO reutiliza playwright.config.ts a propósito: esa config apunta a Vercel
 * productivo con sesión compartida. Esta config:
 *   - solo corre tests/e2e/bim-certification.spec.ts
 *   - baseURL loopback (default http://127.0.0.1:3000, override BIM_BASE_URL)
 *   - sin storageState compartido (el login ocurre dentro del test)
 *   - timeouts largos (parseo IFC + DeepSeek real en lote)
 *   - WebGL por software habilitado (SwiftShader) para el viewer Three.js
 */

const BASE_URL = process.env.BIM_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /bim-certification\.spec\.ts/,
  // Un solo test largo: parseo IFC + batch DeepSeek + reload.
  timeout: 600_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
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

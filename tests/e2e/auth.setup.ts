/**
 * Setup: hace login con Tenant A (admin) y Tenant B (adversario)
 * y guarda sus sesiones en disco para pruebas de aislamiento multi-tenant.
 */
import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE_A = path.join(__dirname, ".auth/admin.json");
const AUTH_FILE_B = path.join(__dirname, ".auth/tenantB.json");

setup("login as Tenant A (admin)", async ({ page }) => {
  const email = "marceloechauri@gmail.com";
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error("E2E_PASSWORD no está definido en .env.local");

  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");

  const alreadyLoggedIn = !page.url().includes("/login");
  if (!alreadyLoggedIn) {
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/contraseña|password/i).fill(password);
    await page.getByRole("button", { name: /ingresar|login|entrar/i }).click();
    await page.waitForURL(/\/(dashboard|orders|invoices|rfqs|projects|stock)/, { timeout: 15_000 });
  }

  await page.context().storageState({ path: AUTH_FILE_A });
});

setup("login as Tenant B (adversario)", async ({ page }) => {
  const email = "magymerlo@gmail.com";
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error("E2E_PASSWORD no está definido en .env.local");

  await page.context().clearCookies();
  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/contraseña|password/i).fill(password);
  await page.getByRole("button", { name: /ingresar|login|entrar/i }).click();
  await page.waitForURL(/\/(dashboard|orders|invoices|rfqs|projects|stock)/, { timeout: 15_000 });

  await page.context().storageState({ path: AUTH_FILE_B });
});

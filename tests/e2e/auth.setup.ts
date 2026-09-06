/**
 * Setup: hace login con el usuario admin y guarda la sesión en disco.
 * Los tests E2E reusan este estado para no loguear en cada spec.
 */
import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/admin.json");

setup("login as admin", async ({ page }) => {
  const email = "marceloechauri@gmail.com";
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error("E2E_PASSWORD no está definido en .env.local");

  await page.goto("/login");

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/contraseña|password/i).fill(password);
  await page.getByRole("button", { name: /ingresar|login|entrar/i }).click();

  // Esperamos llegar a alguna ruta interna
  await page.waitForURL(/\/(dashboard|orders|invoices|rfqs)/, { timeout: 15_000 });

  // Guardamos el contexto (cookies + localStorage) para los tests
  await page.context().storageState({ path: AUTH_FILE });
});

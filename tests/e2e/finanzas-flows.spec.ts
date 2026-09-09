/**
 * E2E: Tesorería y Flujo de caja (Partes A y B del plan tesorería + licitaciones).
 *
 * Tests estructurales — verifican que las pantallas cargan, la proyección se
 * arma y el CRUD básico funciona. No dependen de datos sembrados.
 *
 * Para correr: npx playwright test --project=e2e --no-deps --grep "Finanzas"
 */

import { test, expect } from "@playwright/test";

test.describe("Finanzas — Tesorería", () => {
  test("la página /tesoreria carga", async ({ page }) => {
    await page.goto("/tesoreria");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Tesorería" })).toBeVisible({ timeout: 10_000 });
  });

  test("botón + Cuenta abre el diálogo de alta", async ({ page }) => {
    await page.goto("/tesoreria");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await page.getByRole("button", { name: "+ Cuenta" }).click();
    await expect(page.getByRole("dialog", { name: /Nueva cuenta financiera/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Nombre *")).toBeVisible();
    await expect(page.getByLabel("Saldo inicial")).toBeVisible();
  });

  test("no hay errores JS al cargar tesorería", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/tesoreria");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });
});

test.describe("Finanzas — Flujo de caja", () => {
  test("la página /flujo-caja carga", async ({ page }) => {
    await page.goto("/flujo-caja");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Flujo de caja" })).toBeVisible({ timeout: 10_000 });
  });

  test("muestra la tabla de proyección o el estado vacío", async ({ page }) => {
    await page.goto("/flujo-caja");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const tieneProyeccion = await page.getByText("Saldo actual").count();
    const tieneVacio = await page.getByText(/no hay cuentas financieras/i).count();
    expect(tieneProyeccion + tieneVacio).toBeGreaterThan(0);
  });

  test("botón + Gasto recurrente abre el diálogo (si hay cuentas)", async ({ page }) => {
    await page.goto("/flujo-caja");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const btn = page.getByRole("button", { name: "+ Gasto recurrente" });
    if (await btn.count() === 0) {
      test.skip(); // no hay cuentas todavía
      return;
    }
    await btn.click();
    await expect(page.getByRole("dialog", { name: /Nuevo gasto recurrente/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Descripción *")).toBeVisible();
  });

  test("el selector de granularidad cambia entre mes y semana", async ({ page }) => {
    await page.goto("/flujo-caja");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const sel = page.locator("#fc-gran");
    if (await sel.count() === 0) { test.skip(); return; }
    await sel.selectOption("semana");
    await expect(page.getByText(/Sem \d/).first()).toBeVisible({ timeout: 5_000 });
    await sel.selectOption("mes");
  });

  test("no hay errores JS al cargar flujo de caja", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/flujo-caja");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });
});

test.describe("Finanzas — Sidebar", () => {
  test("la sección Finanzas aparece con Tesorería y Flujo de caja", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Tesorería" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Flujo de caja" })).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Finanzas — Enganche con cobros/pagos", () => {
  test("el diálogo de cobro puede mostrar el selector de cuenta", async ({ page }) => {
    await page.goto("/cobros");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const btn = page.getByRole("button", { name: "+ Cobro" }).first();
    if (await btn.count() === 0) { test.skip(); return; }
    await btn.click();
    await expect(page.getByRole("dialog", { name: "Registrar cobro" })).toBeVisible({ timeout: 10_000 });
    // El selector "cuenta_id" solo existe si hay cuentas activas en esa moneda;
    // el test solo verifica que el diálogo abre sin romperse.
  });
});

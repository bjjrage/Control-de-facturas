/**
 * E2E: Módulo Licitaciones (Partes C y D del plan tesorería + licitaciones).
 *
 * El test de importación golpea la API real de la DNCP con la licitación 391731
 * (empedrado FONACIDE, Canindeyú) — verificada a mano.
 *
 * Para correr: npx playwright test --project=e2e --no-deps --grep "Licitaciones"
 */

import { test, expect } from "@playwright/test";

test.describe("Licitaciones — Bandeja", () => {
  test("la página /licitaciones carga", async ({ page }) => {
    await page.goto("/licitaciones");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Licitaciones" })).toBeVisible({ timeout: 10_000 });
  });

  test("botón + Importar abre el diálogo", async ({ page }) => {
    await page.goto("/licitaciones");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await page.getByRole("button", { name: "+ Importar de la DNCP" }).click();
    await expect(page.getByRole("dialog", { name: /Importar licitación de la DNCP/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel(/Número de licitación o URL/i)).toBeVisible();
  });

  test("perfil de radar abre y guarda", async ({ page }) => {
    await page.goto("/licitaciones");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await page.getByRole("button", { name: "Perfil de radar" }).click();
    await expect(page.getByRole("dialog", { name: /Perfil de radar/i })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel(/Palabras clave/i).fill("empedrado, pavimento");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  });

  test("importar la licitación 391731 de la DNCP trae la planilla", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/licitaciones");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    await page.getByRole("button", { name: "+ Importar de la DNCP" }).click();
    const dlg = page.getByRole("dialog", { name: /Importar licitación/i });
    await dlg.getByLabel(/Número de licitación o URL/i).fill("391731");
    await dlg.getByRole("button", { name: "Importar" }).click();
    await expect(dlg.getByText(/importada/i)).toBeVisible({ timeout: 60_000 });
    await dlg.getByRole("button", { name: "Cerrar" }).click();

    await page.getByRole("link", { name: /PAVIMENTOS TIPO EMPEDRADO/i }).first().click();
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    await expect(page.getByText("Planilla de ítems")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Canal a Cielo Abierto/i).first()).toBeVisible();
    await expect(page.getByText(/Referencial/i).first()).toBeVisible();
    // El Acta de Apertura debe figurar entre los documentos
    await expect(page.getByText(/Acta de Apertura/i).first()).toBeVisible();
  });

  test("no hay errores JS en /licitaciones", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/licitaciones");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await page.waitForTimeout(1500);
    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });
});

test.describe("Licitaciones — Sidebar", () => {
  test("el enlace Licitaciones aparece en el nav (planes Pro+)", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    // Solo en planes pro/caterpillar; si no está, el test se salta.
    const link = page.getByRole("link", { name: "Licitaciones" });
    if (await link.count() === 0) { test.skip(); return; }
    await expect(link).toBeVisible();
  });
});

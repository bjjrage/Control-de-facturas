/**
 * E2E: Módulos exclusivos del plan Caterpillar.
 *
 * Los tests estructurales funcionan con cualquier proyecto existente.
 * Los tests de datos específicos requieren haber corrido el seed:
 *   mocks/caterpillar/seed-caterpillar-demo.sql
 *
 * Para correr: npx playwright test --project=e2e --no-deps --grep "Caterpillar"
 */

import { test, expect } from "@playwright/test";

const SEED_PROJECT_NAME = "Edificio Residencial Norte";
const SEED_PROJECT_ID = "c1000001-0000-0000-0000-000000000001";

// Navega a la pestaña del proyecto vía el evento niupack:tab (client-side)
async function goToTab(page: any, tab: string) {
  await page.evaluate((t: string) => {
    window.dispatchEvent(new CustomEvent("niupack:tab", { detail: t }));
  }, tab);
  await page.waitForTimeout(600);
}

// Navega al primer proyecto disponible (seed o cualquier existente) y devuelve la URL
async function goToFirstProject(page: any): Promise<string> {
  await page.goto("/projects");
  await page.waitForLoadState("networkidle", { timeout: 20_000 });

  // Preferir el proyecto del seed buscando por href (más fiable que por nombre accesible)
  const seedHrefLink = page.locator(`main a[href*='${SEED_PROJECT_ID}']`).first();
  if (await seedHrefLink.count() > 0) {
    await seedHrefLink.click();
  } else {
    // Fallback: primer proyecto disponible
    const firstLink = page.locator("main a[href*='/projects/']").first();
    await expect(firstLink).toBeVisible({ timeout: 10_000 });
    await firstLink.click();
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 });
  return page.url();
}

// Verifica si el proyecto del seed fue cargado (para tests de datos específicos)
function isSeedProject(url: string): boolean {
  return url.includes(SEED_PROJECT_ID);
}

test.describe("Caterpillar — Proyectos", () => {
  test("lista de proyectos carga sin errores", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    // La página usa cards/divs, no tabla. Verificar el heading y KPI "PROYECTOS ACTIVOS"
    await expect(page.getByRole("heading", { name: /proyectos/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/PROYECTOS ACTIVOS/i)).toBeVisible({ timeout: 10_000 });
  });

  test("hay al menos un proyecto en la lista", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    // Proyectos se muestran como links dentro del main
    const projectLinks = await page.locator("main a[href*='/projects/']").count();
    expect(projectLinks).toBeGreaterThan(0);
  });

  test("proyecto demo PRY-2026-001 aparece en la lista (requiere seed)", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const seedProject = page.getByText(new RegExp(SEED_PROJECT_NAME, "i"));
    if (await seedProject.count() === 0) {
      test.skip(); // seed no corrido aún
      return;
    }
    await expect(seedProject).toBeVisible();
  });

  test("clic en proyecto abre la página de detalle", async ({ page }) => {
    test.setTimeout(60_000);
    const projectUrl = await goToFirstProject(page);
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/);
    // El heading del proyecto debe ser visible
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Caterpillar — Proyecto Detalle (todas las pestañas)", () => {
  let currentProjectUrl = "";

  test.beforeEach(async ({ page }) => {
    currentProjectUrl = await goToFirstProject(page);
  });

  test("pestaña Presupuesto — tabla de rubros renderiza", async ({ page }) => {
    await goToTab(page, "presupuesto");

    // Si es el proyecto del seed debe tener datos; si no, verificamos que la pestaña carga
    if (isSeedProject(currentProjectUrl)) {
      const rows = await page.locator("table:visible tbody tr").count();
      expect(rows).toBeGreaterThan(0);
      await expect(page.getByText(/Movimiento de suelos|Estructura|Mampostería/i)).toBeVisible();
    } else {
      // Solo verificamos que la pestaña cargó sin error JS
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.waitForTimeout(1000);
      expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
    }
  });

  test("pestaña Presupuesto — KPIs de totales son visibles", async ({ page }) => {
    await goToTab(page, "presupuesto");
    await expect(page.getByText(/Presupuesto total/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Compras realizadas/i)).toBeVisible({ timeout: 10_000 });
  });

  test("pestaña Ejecución — tabla de avance renderiza", async ({ page }) => {
    await goToTab(page, "ejecucion");

    if (isSeedProject(currentProjectUrl)) {
      const rows = await page.locator("table:visible tbody tr").count();
      expect(rows).toBeGreaterThan(0);
      await expect(page.getByText(/Excavación|Zapatas|Columnas/i)).toBeVisible();
    } else {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.waitForTimeout(1000);
      expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
    }
  });

  test("pestaña Cronograma — renderiza sin error JS", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await goToTab(page, "cronograma");
    await page.waitForTimeout(1500);

    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });

  test("pestaña Personal — tabla de mano de obra renderiza", async ({ page }) => {
    await goToTab(page, "personal");

    if (isSeedProject(currentProjectUrl)) {
      const rows = await page.locator("table:visible tbody tr").count();
      expect(rows).toBeGreaterThan(0);
      await expect(page.getByText(/Juan Martínez|Pedro Romero|Carlos Díaz/i)).toBeVisible();
    } else {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.waitForTimeout(1000);
      expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
    }
  });

  test("pestaña Personal — KPI de Costo M. de Obra es visible", async ({ page }) => {
    await goToTab(page, "personal");
    await expect(page.getByText(/Costo M\.?\s*de\s*Obra/i)).toBeVisible({ timeout: 10_000 });
  });

  test("pestaña Subcontratistas — pestaña carga sin error JS", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await goToTab(page, "subcontratistas");
    await page.waitForTimeout(1500);

    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });

  test("pestaña Subcontratistas — muestra contratos del seed (requiere seed)", async ({ page }) => {
    if (!isSeedProject(currentProjectUrl)) { test.skip(); return; }

    await goToTab(page, "subcontratistas");
    await expect(page.getByText(/Electricidad Total|Plomería y Sanitarios/i)).toBeVisible({ timeout: 10_000 });
  });

  test("pestaña Subcontratistas — estado de cert visible (requiere seed)", async ({ page }) => {
    if (!isSeedProject(currentProjectUrl)) { test.skip(); return; }

    await goToTab(page, "subcontratistas");
    // Scope al contenido principal para evitar strict mode con otros "pendiente" del layout
    await expect(
      page.locator("main").getByText(/APROBADO|PENDIENTE/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("pestaña Certificados — pestaña carga sin error JS", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await goToTab(page, "certificados");
    await page.waitForTimeout(1500);

    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });

  test("pestaña Certificados — muestra certificados del seed (requiere seed)", async ({ page }) => {
    if (!isSeedProject(currentProjectUrl)) { test.skip(); return; }

    await goToTab(page, "certificados");
    await expect(
      page.getByText(/Certificado N[°ºo]?\s*[123]|Cert\.?\s*[123]/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test("pestaña Avance físico — renderiza sin errores JS", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await goToTab(page, "avance-fisico");
    await page.waitForTimeout(1500);

    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });

  test("pestaña Compras — pestaña carga sin error JS", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await goToTab(page, "compras");
    await page.waitForTimeout(1500);

    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });

  test("pestaña Informes — renderiza sin errores JS", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await goToTab(page, "informes");
    await page.waitForTimeout(1500);

    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });
});

test.describe("Caterpillar — Stock / Inventario", () => {
  test("lista de productos carga sin errores", async ({ page }) => {
    await page.goto("/stock");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const hasRows = await page.locator("table:visible tbody tr").count();
    const hasEmpty = await page.getByText(/no hay productos|sin productos/i).count();
    expect(hasRows + hasEmpty).toBeGreaterThan(0);
  });

  test("productos demo aparecen en la lista (requiere seed)", async ({ page }) => {
    await page.goto("/stock");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    // Buscar en las celdas de la tabla, no en selects ocultos
    const cementoCell = page.locator("table:visible td").getByText(/Cemento Portland/i).first();
    if (await cementoCell.count() === 0) { test.skip(); return; }

    await expect(cementoCell).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("table:visible td").getByText(/Hierro 10mm/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("columna TOTAL BASE es visible en la lista de stock", async ({ page }) => {
    await page.goto("/stock");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    // Verificar que la columna TOTAL BASE existe (feature de contenido_por_unidad)
    await expect(page.getByText(/TOTAL BASE/i)).toBeVisible({ timeout: 10_000 });
    // Y que muestra algún valor en kg
    await expect(page.locator("table:visible td").getByText(/kg/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("detalle de producto abre correctamente", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/stock");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const firstLink = page.locator("table:visible tbody tr").first().getByRole("link").first();
    if (await firstLink.count() === 0) { test.skip(); return; }

    const name = await firstLink.textContent();
    await firstLink.click();
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await expect(page).toHaveURL(/\/stock\//);
    await expect(page.getByText(new RegExp(name!.trim(), "i")).first()).toBeVisible();
  });

  test("detalle muestra KPIs de stock (stock actual y mínimo)", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/stock");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const firstLink = page.locator("table:visible tbody tr").first().getByRole("link").first();
    if (await firstLink.count() === 0) { test.skip(); return; }

    await firstLink.click();
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    await expect(page.getByText(/Stock actual/i)).toBeVisible();
    await expect(page.getByText(/Stock mínimo/i)).toBeVisible();
  });

  test("formulario Nuevo producto es accesible", async ({ page }) => {
    await page.goto("/stock/nuevo");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    await expect(page.getByLabel("Nombre *")).toBeVisible();
    await expect(page.getByLabel("Unidad de compra *")).toBeVisible();
    await expect(page.getByLabel("Categoría")).toBeVisible();
  });

  test("selector de unidad tiene opciones controladas (es un <select>)", async ({ page }) => {
    await page.goto("/stock/nuevo");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const unitSelect = page.locator('select[name="unidad"]');
    await expect(unitSelect).toBeVisible();

    const tagName = await unitSelect.evaluate((el) => el.tagName.toLowerCase());
    expect(tagName).toBe("select");

    const options = await unitSelect.locator("option").allTextContents();
    expect(options.some((o) => /bolsa|kg|unidad|m³/i.test(o))).toBe(true);
  });

  test("formulario Nuevo producto lista las categorías del seed (requiere seed)", async ({ page }) => {
    await page.goto("/stock/nuevo");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const catSelect = page.locator('select[name="categoria"]');
    await expect(catSelect).toBeVisible();
    const options = await catSelect.locator("option").allTextContents();
    if (!options.some((o) => /Cemento y aglomerantes/i.test(o))) { test.skip(); return; }
    expect(options.some((o) => /Hierro y acero/i.test(o))).toBe(true);
  });

  test("lista de stock agrupa por categoría con filtros (requiere seed)", async ({ page }) => {
    await page.goto("/stock");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const cementoCell = page.locator("table:visible td").getByText(/Cemento Portland/i).first();
    if (await cementoCell.count() === 0) { test.skip(); return; }

    // Encabezado de grupo de categoría
    await expect(page.getByRole("button", { name: /Cemento y aglomerantes/i })).toBeVisible({ timeout: 10_000 });

    // Filtro de búsqueda deja solo lo que matchea
    await page.getByLabel(/Buscar/i).fill("Hierro");
    await expect(page.locator("table:visible td").getByText(/Hierro 10mm/i).first()).toBeVisible();
    await expect(page.locator("table:visible td").getByText(/Cemento Portland/i)).toHaveCount(0);
  });

  test("no hay errores JS al navegar lista → detalle → lista", async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/stock");
    await page.waitForLoadState("networkidle", { timeout: 20_000 });

    const firstLink = page.locator("table:visible tbody tr").first().getByRole("link").first();
    if (await firstLink.count() > 0) {
      await firstLink.click();
      await page.waitForLoadState("networkidle", { timeout: 20_000 });

      const backLink = page.getByRole("link", { name: /volver/i });
      if (await backLink.count() > 0) {
        await backLink.click();
        await page.waitForLoadState("networkidle", { timeout: 20_000 });
      }
    }

    expect(errors.filter((e) => !e.includes("ResizeObserver") && !e.includes("third-party"))).toHaveLength(0);
  });
});

test.describe("Caterpillar — Sin errores JS en todos los módulos", () => {
  test("navegar por proyectos y stock sin errores JS", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Proyectos lista
    await page.goto("/projects");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Ir al primer proyecto y recorrer tabs
    const firstLink = page.locator("main a[href*='/projects/']").first();
    if (await firstLink.count() > 0) {
      await firstLink.click();
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      for (const tab of ["presupuesto", "ejecucion", "personal", "subcontratistas", "certificados", "cronograma", "avance-fisico"]) {
        await goToTab(page, tab);
        await page.waitForTimeout(500);
      }
    }

    // Stock
    await page.goto("/stock");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("ResizeObserver") &&
        !e.includes("third-party") &&
        !e.includes("Cannot find module")
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

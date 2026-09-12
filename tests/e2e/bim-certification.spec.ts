/**
 * Certificación E2E del módulo BIM + Presupuesto sobre infraestructura efímera.
 *
 * SOLO corre con playwright.bim.config.ts (baseURL loopback + Supabase local).
 * Flujo real de usuario, sin atajos de DB:
 *   login local -> crear proyecto (UI) -> importar Excel (UI) -> tab BIM ->
 *   subir IFC (UI) -> procesamiento auto (agrupación + DeepSeek batch real) ->
 *   viewer + inspector -> review -> confirmar / corregir / rechazar ->
 *   recalcular (preserva decisiones) -> presupuesto agregado -> reload.
 *
 * Falla si: viewer sin canvas, DeepSeek con error, unidad incompatible
 * costeada, CONFIRMED/REJECTED perdidos al recalcular, total monetario
 * incorrecto, reload pierde mappings, o cualquier request toca prod.
 */

import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BIM_BASE_URL ?? "http://127.0.0.1:3000";
const TEST_EMAIL = process.env.BIM_TEST_EMAIL ?? "";
const TEST_PASSWORD = process.env.BIM_TEST_PASSWORD ?? "";
const CATALOG_XLSX =
  process.env.BIM_CATALOG_XLSX ?? path.resolve("tests/e2e/fixtures/aurora-catalog.xlsx");
const IFC_PATH =
  process.env.BIM_IFC_PATH ??
  path.resolve("lib/bim/__tests__/fixtures/aurora-mixed-elements.ifc");
const EVIDENCE_DIR = path.resolve(process.env.BIM_EVIDENCE_DIR ?? "bim-evidence");

const PROD_URL_RE = /supabase\.co|ezucivipgmbvamhugkbj|vercel\.app/i;
const PROJECT_CODE = process.env.BIM_PROJECT_CODE ?? "AURORA-DEMO";

// ---------------------------------------------------------------------------
// Helpers de parseo es-PY (la UI formatea con '.' miles y ',' decimal).
// ---------------------------------------------------------------------------
function parseEsNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9.,-]/g, "").trim();
  if (!cleaned) throw new Error(`No se pudo parsear número de "${raw}"`);
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/\./g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error(`Número inválido "${raw}" -> "${normalized}"`);
  return n;
}

function normUnit(raw: string): string {
  return raw.replace(/²/g, "2").replace(/³/g, "3").trim().toLowerCase();
}

function shot(page: Page, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, name) });
}

test.describe("BIM E2E Certification — Edificio Aurora", () => {
  test("proyecto -> excel -> ifc -> viewer -> deepseek -> review -> presupuesto -> reload", async ({
    page,
  }) => {
    test.slow();
    await mkdir(EVIDENCE_DIR, { recursive: true });
    const metrics: Record<string, unknown> = {
      baseUrl: BASE_URL,
      startedAt: new Date().toISOString(),
    };

    // Guard: baseURL loopback + colector de requests sospechosas.
    const baseHost = new URL(BASE_URL).hostname;
    expect(
      ["127.0.0.1", "localhost", "::1"].includes(baseHost),
      `baseURL debe ser loopback, es ${BASE_URL}`
    ).toBe(true);
    const prodHits: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (PROD_URL_RE.test(url)) prodHits.push(url);
    });

    expect(TEST_EMAIL, "BIM_TEST_EMAIL requerido").toBeTruthy();
    expect(TEST_PASSWORD, "BIM_TEST_PASSWORD requerido").toBeTruthy();

    // --- 1. Login con usuario de test LOCAL ---------------------------------
    await test.step("login local", async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel(/email/i).fill(TEST_EMAIL);
      await page.getByLabel(/contrase/i).fill(TEST_PASSWORD);
      await page.getByRole("button", { name: /ingresar/i }).click();
      await page.waitForURL(/\/(dashboard|projects|orders)/, { timeout: 30_000 });
    });

    // --- 2. Crear proyecto Aurora por UI ------------------------------------
    let projectId = "";
    await test.step("crear proyecto Aurora", async () => {
      await page.goto(`${BASE_URL}/projects`);
      await page.getByRole("button", { name: /nuevo proyecto/i }).click();
      await page.locator("#np_name").fill("Proyecto Demo — Edificio Aurora");
      await page.locator("#np_code").fill(PROJECT_CODE);
      await page.locator("#np_client").fill("Cliente Demo");
      await page.getByRole("button", { name: /crear proyecto/i }).click();
      // El diálogo debe cerrarse al crear. Si queda abierto con error (ej.
      // código duplicado), fallar ACÁ en vez de colgarse buscando el link:
      // el mensaje de error del diálogo contiene el código y daría un
      // falso positivo en assertions de texto.
      await expect(page.locator("#np_name")).toBeHidden({ timeout: 60_000 });
      const projectLink = page.getByRole("link", { name: /edificio aurora/i }).first();
      await expect(projectLink).toBeVisible({ timeout: 60_000 });
      const href = await projectLink.getAttribute("href");
      expect(href, "link al detalle del proyecto").toBeTruthy();
      projectId = href!.split("/").pop()!;
      await page.goto(`${BASE_URL}/projects/${projectId}?tab=bim`);
      await expect(page.getByText(/el bim aporta cantidades/i)).toBeVisible({ timeout: 30_000 });
      await shot(page, "01-project-bim.png");
      metrics.projectId = projectId;
    });

    // --- 3. Importar base económica por UI (importador real) -----------------
    await test.step("importar excel de costos", async () => {
      await page.goto(`${BASE_URL}/projects/${projectId}?tab=presupuesto`);
      await page.getByRole("button", { name: /importar excel/i }).click();
      await page.locator('input[type="file"]').setInputFiles(CATALOG_XLSX);
      await page.getByRole("button", { name: /^siguiente$/i }).click();
      await expect(page.getByText(/se van a importar 11 ítems/i)).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: /importar 11 ítems/i }).click();
      await expect(page.getByText("ALB-001").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("EST-001").first()).toBeVisible({ timeout: 15_000 });
    });

    // --- 4-5. Subir IFC + esperar procesamiento (agrupación + DeepSeek) ------
    const tUploadStart = Date.now();
    await test.step("subir IFC y procesar", async () => {
      await page.goto(`${BASE_URL}/projects/${projectId}?tab=bim`);
      await page.locator('input[type="file"][accept=".ifc"]').setInputFiles(IFC_PATH);
      const summary = page.getByText("BIM procesado");
      await expect(summary).toBeVisible({ timeout: 420_000 });
      metrics.uploadToBudgetMs = Date.now() - tUploadStart;
      const panel = summary.locator("xpath=ancestor::div[2]");
      const text = ((await panel.textContent()) ?? "").replace(/\s+/g, " ");
      metrics.processingSummary = text;
      const nums = text.match(/(\d+)\s*elementos\s*·\s*(\d+)\s*grupos/i);
      const sug = text.match(/(\d+)\s*matches sugeridos/i);
      const rev = text.match(/(\d+)\s*requieren revisión/i);
      const nom = text.match(/(\d+)\s*sin correspondencia/i);
      metrics.elementCount = nums ? Number(nums[1]) : null;
      metrics.groupCount = nums ? Number(nums[2]) : null;
      metrics.suggested = sug ? Number(sug[1]) : null;
      metrics.review = rev ? Number(rev[1]) : null;
      metrics.noMatch = nom ? Number(nom[1]) : null;
      expect(metrics.elementCount, "elementos IFC > 0").toBeGreaterThan(0);
      expect(metrics.groupCount, "grupos técnicos > 0").toBeGreaterThan(0);
      // DeepSeek respondió: el resumen solo existe si processBimGroups no devolvió error.
      await expect(page.getByText(/error de deepseek|no se pudo inicializar el matcher/i)).toHaveCount(0);
      await shot(page, "04-processing-summary.png");
    });

    // --- 6. Viewer: canvas renderizado, sin error ----------------------------
    await test.step("viewer 3D", async () => {
      await expect(page.getByText("Modelo 3D").first()).toBeVisible({ timeout: 60_000 });
      const canvas = page.locator("canvas").first();
      await expect(canvas, "el viewer debe renderizar un canvas WebGL").toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByText(/no se pudo cargar el visor/i)).toHaveCount(0);
      await shot(page, "02-ifc-viewer.png");
    });

    // --- 7. Selección + inspector (vía foco de grupo) ------------------------
    await test.step("selección e inspector", async () => {
      await page.getByRole("button", { name: /revisar presupuesto/i }).click();
      const showToggle = page.getByRole("button", { name: /^mostrar$/i });
      if (await showToggle.count()) await showToggle.first().click();
      // El inspector aparece al enfocar un grupo (muestra su primer elemento).
      const reviewHeading = page.getByText("Revisión por grupo");
      await expect(reviewHeading).toBeVisible({ timeout: 30_000 });
      const firstGroupButton = reviewHeading.locator("xpath=following::button[1]");
      await firstGroupButton.click();
      await expect(page.getByText("IFC Type:")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("GUID:")).toBeVisible();
      // Cantidad extraída del IFC (fail si el inspector dice que no hay).
      await expect(page.getByText(/sin cantidad extraída del ifc/i)).toHaveCount(0);
      await expect(
        page.getByText(/quantity set ifc|propiedad ifc/i).first()
      ).toBeVisible();
      await shot(page, "03-selected-element.png");
    });

    // --- 8. Review: estados + decisiones humanas -----------------------------
    await test.step("review y decisiones humanas", async () => {
      await expect(page.getByRole("button", { name: /confirmar/i }).first()).toBeVisible({
        timeout: 30_000,
      });
      await shot(page, "05-semantic-review.png");

      // 8a. Confirmar un match correcto.
      await page.getByRole("button", { name: /^confirmar$/i }).first().click();
      await expect(page.getByText("Confirmado").first()).toBeVisible({ timeout: 30_000 });
      await shot(page, "06-confirmed-match.png");

      // 8b. Corrección manual: cambiar el rubro del primer grupo a otro distinto.
      const confirmedBox = page.getByText("✓").first();
      const beforeCode = ((await confirmedBox.textContent()) ?? "").match(/[A-Z]+-\d+/)?.[0];
      await page.getByRole("button", { name: /cambiar rubro/i }).first().click();
      const select = page.locator("select").first();
      await expect(select).toBeVisible({ timeout: 15_000 });
      const options = await select.locator("option").allTextContents();
      let picked = "";
      for (const opt of options.slice(1)) {
        const code = opt.match(/[A-Z]+-\d+/)?.[0];
        if (code && code !== beforeCode) {
          picked = opt;
          break;
        }
      }
      expect(picked, "debe existir un rubro alternativo para la corrección").toBeTruthy();
      await select.selectOption({ label: picked });
      await expect(page.getByText("Confirmado").first()).toBeVisible({ timeout: 30_000 });
      const afterCode = ((await page.getByText("✓").first().textContent()) ?? "").match(
        /[A-Z]+-\d+/
      )?.[0];
      expect(afterCode, "la corrección manual debe cambiar el rubro").not.toBe(beforeCode);
      metrics.manualCorrection = { from: beforeCode, to: afterCode };
      await shot(page, "07-manual-correction.png");

      // 8c. Rechazar otro grupo (dejar sin asignar). nth(1): el primer grupo ya
      // está confirmado, el segundo botón pertenece a otra tarjeta.
      const groupCount = (metrics.groupCount as number) ?? 0;
      expect(groupCount, "se necesitan ≥2 grupos para el caso NO_MATCH/REJECTED").toBeGreaterThanOrEqual(2);
      await page.getByRole("button", { name: /dejar sin asignar/i }).nth(1).click();
      await expect(page.getByText("Sin asignar").first()).toBeVisible({ timeout: 30_000 });
      await shot(page, "08-rejected-group.png");

      metrics.confirmedCode = afterCode;
    });

    // --- 9. Recalcular: CONFIRMED/REJECTED intactos --------------------------
    await test.step("recalcular preserva decisiones", async () => {
      await page.getByRole("button", { name: /actualizar resumen/i }).click();
      const refreshBtn = page.getByRole("button", { name: /actualizar resumen/i });
      await expect(refreshBtn).toBeEnabled({ timeout: 420_000 });
      await page.waitForTimeout(2000);
      await expect(page.getByText("Confirmado").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText("Sin asignar").first()).toBeVisible({ timeout: 60_000 });
      const stillCode = ((await page.getByText("✓").first().textContent()) ?? "").match(
        /[A-Z]+-\d+/
      )?.[0];
      expect(stillCode, "CONFIRMED sobrevive al recalcular").toBe(metrics.confirmedCode as string);
    });

    // --- 10. Presupuesto agregado: fórmula canónica --------------------------
    await test.step("presupuesto agregado", async () => {
      const budgetHeading = page.getByText(/presupuesto resultante/i);
      await expect(budgetHeading).toBeVisible({ timeout: 30_000 });
      const table = budgetHeading.locator("xpath=following::table[1]");
      const rows = table.locator("tbody tr");
      const n = await rows.count();
      expect(n, "al menos una fila de presupuesto").toBeGreaterThan(0);
      const checked: Array<Record<string, unknown>> = [];
      for (let i = 0; i < n; i++) {
        const cells = rows.nth(i).locator("td");
        const qty = parseEsNumber((await cells.nth(1).textContent()) ?? "");
        const price = parseEsNumber((await cells.nth(3).textContent()) ?? "");
        const total = parseEsNumber((await cells.nth(4).textContent()) ?? "");
        // La UI muestra cantidad con 2 decimales y PYG sin decimales: la
        // tolerancia cubre el redondeo de display (0.005 × precio + 1).
        const expected = qty * price;
        const tolerance = 0.005 * price + 1;
        expect(
          Math.abs(expected - total),
          `total fila ${i}: ${qty} × ${price} ≈ ${total}`
        ).toBeLessThanOrEqual(tolerance);
        checked.push({ qty, price, total });
      }
      metrics.budgetRows = checked;

      // Fail-closed de unidades: ninguna tarjeta Sugerida/Confirmada puede
      // mezclar magnitudes (m² vs m³, kg vs m², ...). Si la IA sugiriera una
      // unidad incompatible costeada, el test falla.
      const unitMismatches: string[] = [];
      for (const badge of ["Sugerido", "Confirmado"]) {
        const badges = page.getByText(badge, { exact: true });
        const count = await badges.count();
        for (let i = 0; i < count; i++) {
          const card = badges.nth(i).locator("xpath=ancestor::div[.//button][1]");
          const text = ((await card.textContent()) ?? "").replace(/\s+/g, " ");
          const qtyUnit = text.match(/[\d.,]+\s*(m²|m³|m2|m3|m|kg)\b/i)?.[1];
          const itemUnit = text.match(/\/\s*(m²|m³|m2|m3|m|kg|u|gl)\b/i)?.[1];
          if (qtyUnit && itemUnit && normUnit(qtyUnit) !== normUnit(itemUnit)) {
            unitMismatches.push(`${badge}: grupo ${qtyUnit} vs rubro ${itemUnit}`);
          }
        }
      }
      expect(
        unitMismatches,
        `unidades incompatibles costeadas: ${unitMismatches.join(" | ")}`
      ).toEqual([]);
    });

    // --- 11. Reload: persistencia --------------------------------------------
    await test.step("reload y persistencia", async () => {
      await shot(page, "09-final-budget.png");
      await page.reload();
      await expect(page.getByText(/el bim aporta cantidades/i)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText("aurora-mixed-elements.ifc")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
      const showToggle = page.getByRole("button", { name: /^mostrar$/i });
      if (await showToggle.count()) await showToggle.first().click();
      await expect(page.getByText("Confirmado").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText("Sin asignar").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/presupuesto resultante/i)).toBeVisible({ timeout: 60_000 });
      const reloadedCode = ((await page.getByText("✓").first().textContent()) ?? "").match(
        /[A-Z]+-\d+/
      )?.[0];
      expect(reloadedCode, "el mapping grupo→budget_item persiste tras reload").toBe(
        metrics.confirmedCode as string
      );
      await shot(page, "10-after-reload.png");
    });

    // --- Guard final: cero tráfico a producción ------------------------------
    expect(prodHits, `requests a producción detectados: ${prodHits.join(", ")}`).toEqual([]);

    metrics.finishedAt = new Date().toISOString();
    metrics.prodGuardHits = prodHits.length;
    await writeFile(path.join(EVIDENCE_DIR, "metrics.json"), JSON.stringify(metrics, null, 2));
    const txt = [
      "BIM E2E CERTIFICATION — métricas",
      `elementos IFC: ${metrics.elementCount}`,
      `grupos técnicos: ${metrics.groupCount}`,
      `sugeridos: ${metrics.suggested} / revisión: ${metrics.review} / sin correspondencia: ${metrics.noMatch}`,
      `corrección manual: ${JSON.stringify(metrics.manualCorrection)}`,
      `filas de presupuesto verificadas: ${(metrics.budgetRows as unknown[])?.length ?? 0}`,
      `upload→presupuesto: ${metrics.uploadToBudgetMs} ms`,
      `tokens DeepSeek: n/a en UI (ver logs del server en el job)`,
      `prod-guard hits: ${prodHits.length}`,
    ].join("\n");
    await writeFile(path.join(EVIDENCE_DIR, "metrics.txt"), txt);
    console.log(txt);
  });
});

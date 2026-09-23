import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";

function workbookBuffer() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["OBRA DE PRUEBA"],
    [],
    ["Código", "Descripción", "Cantidad"],
    ["1.1", "Excavación", 12],
  ]), "Presupuesto");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

const preview = {
  previewToken: "e2e-signed-preview",
  sheets: ["Presupuesto"],
  result: {
    documentType: "Planilla de obra",
    workbookSummary: { summary: "Se detectó un presupuesto de obra.", sheetCount: 1 },
    project: {
      name: { status: "FOUND", value: "OBRA DE PRUEBA", confidence: 0.98, source: { sheet: "Presupuesto", range: "A1:A1" } },
      code: { status: "NOT_FOUND", value: null, confidence: 1 },
      client: { status: "NOT_FOUND", value: null, confidence: 1 },
      contractor: { status: "FOUND", value: "Contratista de prueba", confidence: 0.94, source: { sheet: "Presupuesto", range: "B1:B1" } },
      location: { status: "NOT_FOUND", value: null, confidence: 1 },
      contractNumber: { status: "NOT_FOUND", value: null, confidence: 1 },
      startDate: { status: "NOT_FOUND", value: null, confidence: 1 },
      endDate: { status: "NOT_FOUND", value: null, confidence: 1 },
      totalAmount: { status: "NOT_FOUND", value: null, confidence: 1 },
    },
    detectedSections: [{ type: "BUDGET", title: "Presupuesto", sheet: "Presupuesto", range: "A3:C4", rowCount: 2, confidence: 0.97, columns: ["Código", "Descripción", "Cantidad"], sampleRows: [["1.1", "Excavación", 12]], warnings: [] }],
    importPlan: { workbookType: "CONSTRUCTION_PROJECT", overallConfidence: 0.97, blocks: [], unresolvedRegions: [], warnings: [] },
    budgetItems: [],
    coverage: [],
    warnings: [], unknownSections: [], overallConfidence: 0.97,
  },
  canonical: {
    budgetItems: [{ code: "1.1", description: "Excavación", unit: "m3", quantity: 12, unitPrice: 120, parentCode: null, confidence: 0.97, source: { sheet: "Presupuesto", row: 4, range: "A4:C4" } }],
    budgetBlockingRows: [],
    budgetQuantitySource: "BUDGET",
    budgetTotal: 1440,
    certificate: { status: "SAFE_TO_APPLY", itemCount: 2, matchedBudgetItems: 2, number: 7, periodStart: "2025-01-01", periodEnd: "2025-01-31", reason: "", items: [
      { code: "1.1", description: "Excavación", unit: "m3", quantityContractual: 12, quantityPrevious: 0, quantityCurrent: 6, quantityCumulative: 6, unitPrice: 120, amountPrevious: 0, amountCurrent: 720, amountCumulative: 720, percentage: 50, source: { sheet: "Certificado", row: 4, range: "A4:C4" } },
      { code: "1.2", description: "Relleno", unit: "m3", quantityContractual: 8, quantityPrevious: 0, quantityCurrent: 4, quantityCumulative: 4, unitPrice: 80, amountPrevious: 0, amountCurrent: 320, amountCumulative: 320, percentage: 50, source: { sheet: "Certificado", row: 5, range: "A5:C5" } },
    ] },
    measurement: { status: "NOT_DETECTED", blockCount: 0, detailRows: 0, matchingItems: 0, reason: "No se detectó medición.", identity: {}, canonicalIdentity: {} },
    warnings: [],
  },
};

test("Obras ofrece el importador antes de crear una obra", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route("**/api/workbook-interpretation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(preview) }));
  await page.goto("/projects");

  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button").first()).toHaveText(/Importar planilla de obra/i);
  await dialog.getByRole("button", { name: /Importar planilla de obra/i }).click();
  await expect(dialog.getByText(/OpenAI.*se envían valores y muestras de la planilla/i)).toBeVisible();

  await dialog.locator('input[type="file"]').setInputFiles({ name: "obra-realista.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbookBuffer() });
  await expect(dialog.getByText("obra-realista.xlsx")).toBeVisible();
  await expect(dialog.getByText(/pendiente de an\u00e1lisis/i)).toBeVisible();
  await dialog.getByRole("button", { name: /Analizar planilla/i }).click();

  await expect(dialog.getByText("Qué entendió el ERP")).toBeVisible();
  await expect(dialog.getByText("OBRA DE PRUEBA")).toBeVisible();
  await expect(dialog.getByText("Presupuesto", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Contratista (solo preview; no se importa)", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Contratista de prueba", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/2\/2 conciliadas/)).toHaveCount(2);
  await expect(dialog.getByText("Este resultado es sólo un preview. No se creó ninguna obra ni se guardaron datos.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Crear obra con estos datos" })).toBeVisible();
  await page.screenshot({ path: "test-results/workbook-import-flow-1366x768.png" });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Nuevo proyecto" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Importar planilla de obra/i })).toBeVisible();
});

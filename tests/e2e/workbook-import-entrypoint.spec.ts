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
  result: {
    documentType: "Planilla de obra",
    workbookSummary: { summary: "Se detectó un presupuesto de obra.", sheetCount: 1 },
    project: {
      name: { status: "FOUND", value: "OBRA DE PRUEBA", confidence: 0.98, source: { sheet: "Presupuesto", range: "A1:A1" } },
      code: { status: "NOT_FOUND", value: null, confidence: 1 },
      client: { status: "NOT_FOUND", value: null, confidence: 1 },
      contractor: { status: "NOT_FOUND", value: null, confidence: 1 },
      location: { status: "NOT_FOUND", value: null, confidence: 1 },
      contractNumber: { status: "NOT_FOUND", value: null, confidence: 1 },
      startDate: { status: "NOT_FOUND", value: null, confidence: 1 },
      endDate: { status: "NOT_FOUND", value: null, confidence: 1 },
      totalAmount: { status: "NOT_FOUND", value: null, confidence: 1 },
    },
    detectedSections: [{ type: "BUDGET", title: "Presupuesto", sheet: "Presupuesto", range: "A3:C4", rowCount: 2, confidence: 0.97, columns: ["Código", "Descripción", "Cantidad"], sampleRows: [["1.1", "Excavación", 12]], warnings: [] }],
    warnings: [], unknownSections: [], overallConfidence: 0.97,
  },
};

test("Obras ofrece el importador antes de crear una obra", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route("**/api/workbook-interpretation", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(preview) }));
  await page.goto("/projects");

  await page.getByRole("button", { name: "Nueva obra" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button").first()).toHaveText(/Importar planilla de obra/i);
  await dialog.getByRole("button", { name: /Importar planilla de obra/i }).click();

  await dialog.locator('input[type="file"]').setInputFiles({ name: "obra-realista.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbookBuffer() });
  await expect(dialog.getByText("obra-realista.xlsx")).toBeVisible();
  await expect(dialog.getByText(/1 hoja/i)).toBeVisible();
  await dialog.getByRole("button", { name: /Analizar planilla/i }).click();

  await expect(dialog.getByText("Qué entendió el ERP")).toBeVisible();
  await expect(dialog.getByText("OBRA DE PRUEBA")).toBeVisible();
  await expect(dialog.getByText("Presupuesto", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Crear proyecto/i })).toHaveCount(0);
  await page.screenshot({ path: "test-results/workbook-import-flow-1366x768.png" });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Nueva obra" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Importar planilla de obra/i })).toBeVisible();
});

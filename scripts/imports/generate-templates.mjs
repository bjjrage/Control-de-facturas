import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = JSON.parse(await fs.readFile(path.join(root, "docs/imports/contratos-v1.json"), "utf8"));
const out = path.join(root, "docs/imports/plantillas");
await fs.mkdir(out, { recursive: true });
for (const template of catalog.templates) {
  const book = new ExcelJS.Workbook();
  book.creator = "ERP IASA";
  book.created = new Date("2026-11-04T00:00:00Z");
  book.modified = book.created;
  const data = book.addWorksheet("Datos");
  for (const text of template.metadata ?? []) data.addRow([text]);
  if (template.metadata) data.addRow([]);
  const header = data.addRow(template.fields.map(field => field.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } };
  header.height = 28;
  data.views = [{ state: "frozen", ySplit: header.number, xSplit: 1 }];
  data.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: template.fields.length } };
  template.fields.forEach((field, i) => {
    data.getColumn(i + 1).width = field.type === "text" ? (field.header.toLowerCase().includes("descripcion") ? 58 : 24) : 24;
    header.getCell(i + 1).note = field.meaning + " Obligatorio: " + String(field.required) + ".";
    for (let row = header.number + 1; row <= header.number + 200; row++) {
      const cell = data.getCell(row, i + 1);
      cell.numFmt = field.type === "text" || field.type === "date" ? "@" : "0.########";
      if (["nonnegative", "positive", "percent"].includes(field.type)) {
        cell.dataValidation = {
          type: "decimal", operator: field.type === "percent" ? "between" : field.type === "positive" ? "greaterThan" : "greaterThanOrEqual",
          formulae: field.type === "percent" ? [0, 100] : [0], allowBlank: true,
          showErrorMessage: true, errorStyle: "stop", errorTitle: "Valor inválido",
          error: field.meaning,
        };
      }
    }
  });
  const guide = book.addWorksheet("Guia");
  guide.columns = [{ width: 29 }, { width: 110 }];
  guide.addRow(["Plantilla", template.title]);
  guide.addRow(["Uso actual", template.support]);
  guide.addRow(["Dónde se carga", template.entrypoint]);
  guide.addRow(["Cómo completar", "Primera hoja Datos. Una fila por registro. No hay datos de ejemplo para evitar cargarlos por accidente."]);
  guide.addRow(["Valores", "Códigos como texto; cantidades como números de Excel. Fechas AAAA-MM-DD. Sin celdas combinadas, subtotales ni macros."]);
  guide.addRow(["Cálculos", "No completar valores calculados. No se reemplazan fórmulas ni cálculos del ERP."]);
  for (const note of template.notes) guide.addRow(["Indicación", note]);
  guide.addRow([]);
  for (const field of template.fields) guide.addRow([field.header, field.meaning + " Obligatorio: " + String(field.required) + "."]);
  guide.eachRow(row => { row.alignment = { vertical: "top", wrapText: true }; row.height = 42; });
  await book.xlsx.writeFile(path.join(out, template.id + ".xlsx"));
}
console.log(JSON.stringify({ templates: catalog.templates.length, output: out, format: "xlsx", formulas: 0 }));

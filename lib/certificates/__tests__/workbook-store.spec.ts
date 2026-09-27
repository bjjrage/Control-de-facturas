import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "@/lib/workbook-interpretation/parser";
import type { WorkbookRepresentation } from "@/lib/workbook-interpretation/types";
import { computeStructureHash, toStoredSheets, workbookFromSnapshot, type WorkingSnapshot } from "../workbook-store";

// Deriva el snapshot del MISMO WorkbookRepresentation ya parseado, igual que
// createCertificateWorkbook (parsea una vez, guarda esa misma lectura) — no
// re-parsea el archivo, que con SheetJS puede rendir "!cols" distinto entre
// lecturas separadas del mismo buffer.
function toSnapshot(parsed: WorkbookRepresentation): WorkingSnapshot {
  // Round-trip por JSON, igual que la columna jsonb.
  return JSON.parse(JSON.stringify({ fileName: parsed.fileName, sheets: toStoredSheets(parsed), definedNames: parsed.definedNames ?? [] }));
}

describe("copia de trabajo del certificado (Excel-first, Fase 1)", () => {
  it("reconstruye del snapshot lo mismo que lee el parser (valores, fórmulas, merges, hojas ocultas, anchos)", () => {
    const book = XLSX.utils.book_new();
    const certificado = XLSX.utils.aoa_to_sheet([
      ["Código", "Descripción", "Cantidad", "P. Unitario", "Subtotal"],
      ["1", "Limpieza de terreno", 37, 294005, null],
    ]);
    certificado.E2 = { t: "n", v: 10878185, f: "C2*D2", w: "10.878.185" };
    certificado["!merges"] = [XLSX.utils.decode_range("A4:B4")];
    certificado.A4 = { t: "s", v: "Total" };
    certificado["!ref"] = "A1:E4";
    certificado["!cols"] = [{ wpx: 80 }, { hidden: true }];
    XLSX.utils.book_append_sheet(book, certificado, "CERTIFICADO");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["mes anterior", 1]]), "Julio");
    book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const parsed = parseWorkbook(new Uint8Array(bytes), "certificado.xlsx");
    const snapshot = toSnapshot(parsed);
    const restored = workbookFromSnapshot(snapshot);

    expect(restored).toEqual(parsed);
    expect(restored.sheets[1].hidden).toBe(true);
    expect(restored.sheets[0].columnWidths?.slice(0, 2)).toEqual([80, 0]);
    expect(restored.sheets[0].cells.find((c) => c.address === "E2")).toMatchObject({ formula: "C2*D2", raw: 10878185 });
  });

  it("el structure_hash no cambia si solo cambia un valor, y cambia si se mueve una columna", () => {
    const base = (): WorkingSnapshot => ({
      fileName: "c.xlsx",
      definedNames: [],
      sheets: [
        {
          name: "CERTIFICADO",
          index: 0,
          hidden: false,
          usedRange: "A1:C2",
          rowCount: 2,
          columnCount: 3,
          merges: [],
          columnWidths: [],
          cells: [
            [1, 1, "Código", null, null, "s"],
            [1, 2, "Descripción", null, null, "s"],
            [1, 3, "Cantidad", null, null, "s"],
            [2, 1, "1", null, null, "s"],
            [2, 2, "Limpieza", null, null, "s"],
            [2, 3, 37, null, null, "n"],
          ],
        },
      ],
    });

    const original = base();
    const valueEdited = base();
    valueEdited.sheets[0].cells = valueEdited.sheets[0].cells.map((c) => (c[0] === 2 && c[1] === 3 ? [2, 3, 40, null, null, "n"] : c));
    expect(computeStructureHash(valueEdited)).toBe(computeStructureHash(original));

    const rowAdded = base();
    rowAdded.sheets[0].cells = [...rowAdded.sheets[0].cells, [3, 1, "2", null, null, "s"], [3, 2, "Replanteo", null, null, "s"], [3, 3, 100, null, null, "n"]];
    expect(computeStructureHash(rowAdded)).toBe(computeStructureHash(original));

    const columnRenamed = base();
    columnRenamed.sheets[0].cells = columnRenamed.sheets[0].cells.map((c) => (c[0] === 1 && c[1] === 3 ? [1, 3, "Unidad", null, null, "s"] : c));
    expect(computeStructureHash(columnRenamed)).not.toBe(computeStructureHash(original));

    const sheetAdded = base();
    sheetAdded.sheets.push({ ...base().sheets[0], name: "curva avance" });
    expect(computeStructureHash(sheetAdded)).not.toBe(computeStructureHash(original));
  });

  const magy = path.join(process.env.USERPROFILE ?? "", "Downloads", "P05 - ID14 - SIPP 3458 - CERTIFICADO Nro. 6.-(2).xlsx");
  it.skipIf(!fs.existsSync(magy))("MAGY: la copia de trabajo reconstruye las 15 hojas, incluidas las ocultas", () => {
    const bytes = fs.readFileSync(magy);
    const parsed = parseWorkbook(bytes, magy);
    const snapshot = toSnapshot(parsed);
    const restored = workbookFromSnapshot(snapshot);

    expect(restored).toEqual({ ...parsed, warnings: [] });
    expect(restored.sheets).toHaveLength(15);
    expect(restored.sheets.filter((s) => s.hidden).map((s) => s.sheetName)).toEqual(
      expect.arrayContaining(["Julio", "Junio", "Mayo", "Abril"])
    );
  });
});

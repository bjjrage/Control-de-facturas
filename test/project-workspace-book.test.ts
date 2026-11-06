import { expect, it } from "vitest";
import type { ICellData } from "@univerjs/presets";
import { createEmptyProjectWorkbook, validateProjectWorkbook, WORKSPACE_SHEETS } from "@/lib/projects/workspace-book";
import { compactProjectWorkbook, WORKSPACE_GUIDE } from "@/lib/projects/workspace-guide";
const id = "a0000000-0000-4000-8000-000000000001";
it("opens five real sheets without invented quantities, prices or resources", () => {
  const book = createEmptyProjectWorkbook(id);
  expect(book.sheetOrder).toEqual(WORKSPACE_SHEETS);
  for (const sheet of Object.values(book.sheets)) {
    for (const [rowIndex, row] of Object.entries(sheet.cellData ?? {})) {
      if (Number(rowIndex) < 3) continue;
      for (const cell of Object.values(row ?? {}) as ICellData[]) expect(cell?.v).toBeUndefined();
    }
  }
  expect(validateProjectWorkbook(book, id)).toBeNull();
});
it("keeps editable price cells distinct from formula-linked quantity and costs", () => {
  const book = createEmptyProjectWorkbook(id);
  expect(book.sheets.presupuesto.cellData?.[3]?.[6]?.f).toBeUndefined();
  expect(book.sheets.presupuesto.cellData?.[3]?.[4]?.f).toContain("'Cómputo'!");
  expect(book.sheets.materiales.cellData?.[3]?.[0]?.f).toContain("UNIQUE(FILTER(APU!");
  expect(book.sheets.cronograma.cellData?.[3]?.[12]?.f).toContain("WORKDAY.INTL");
});
it("validates native save/load while retaining auxiliary sheets, formats, widths and renamed source sheets", () => {
  const book = createEmptyProjectWorkbook(id);
  book.sheets.computo.name = "Mediciones";
  book.sheets.computo.columnData![2] = { w: 500 };
  book.sheets.extra = { ...book.sheets.computo, id: "extra", name: "Notas", cellData: { 0: { 0: { v: "Nota de obra", s: { bl: 1 } } } } };
  book.sheetOrder.push("extra");
  const restored = JSON.parse(JSON.stringify(book));
  expect(validateProjectWorkbook(restored, id)).toBeNull();
  expect(restored.sheets.extra.cellData[0][0]).toEqual({ v: "Nota de obra", s: { bl: 1 } });
  expect(restored.sheets.computo.columnData[2].w).toBe(500);
});
it("rejects a different document identity or missing linked sheet", () => {
  const book = createEmptyProjectWorkbook(id);
  expect(validateProjectWorkbook(book, "other")).toBeTruthy();
  book.sheetOrder = book.sheetOrder.filter(key => key !== "apu");
  expect(validateProjectWorkbook(book, id)).toBeTruthy();
});
it("rejects invalid dimensions and oversized snapshots", () => {
  const book = createEmptyProjectWorkbook(id);
  book.sheets.apu.rowCount = -1;
  expect(validateProjectWorkbook(book, id)).toBeTruthy();
  book.sheets.apu.rowCount = 1000;
  book.name = "a".repeat(4_500_001);
  expect(validateProjectWorkbook(book, id)).toContain("tamaño");
});
it("moves old template hints out of view while retaining user notes and formulas", () => {
  const book = createEmptyProjectWorkbook(id);
  book.sheets.computo.cellData![1][0]!.v = WORKSPACE_GUIDE.computo.legacy;
  book.sheets.apu.cellData![1][0]!.v = "Nota propia de la obra";
  const compact = compactProjectWorkbook(book);
  expect(compact.sheets.computo.cellData![1][0]!.v).toBeUndefined();
  expect(compact.sheets.apu.cellData![1][0]!.v).toBe("Nota propia de la obra");
  expect(compact.sheets.computo.cellData![3][9]).toEqual(book.sheets.computo.cellData![3][9]);
  expect(book.sheets.computo.cellData![1][0]!.v).toBe(WORKSPACE_GUIDE.computo.legacy);
});

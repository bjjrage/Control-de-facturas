import { expect, it } from "vitest";
import { Univer, LocaleType } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import "@univerjs/engine-formula/facade";
import "@univerjs/sheets/facade";
import "@univerjs/sheets-formula/facade";
import "@univerjs/sheets-numfmt/facade";
import { createEmptyProjectWorkbook } from "@/lib/projects/workspace-book";

it("calculates linked quantities, APU, materials and working dates in the installed Univer engine", async () => {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: SheetsEnUS } });
  univer.registerPlugin(UniverRenderEnginePlugin); univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverDocsPlugin); univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin); univer.registerPlugin(UniverSheetsNumfmtPlugin);
  const api = FUniver.newAPI(univer);
  const data = createEmptyProjectWorkbook("engine-test");
  const put = (sheet: string, row: number, cells: Record<number, { v?: string | number; f?: string }>) => {
    data.sheets[sheet].cellData![row] = { ...data.sheets[sheet].cellData![row], ...cells };
  };
  put("computo", 3, { 0: { v: "1" }, 1: { v: "Mampostería" }, 2: { v: "Muro" }, 3: { v: "m2" }, 4: { v: 1 }, 5: { v: 8 }, 7: { v: 2.6 } });
  put("apu", 3, { 0: { v: "1" }, 1: { v: "MAT" }, 2: { v: "LAD" }, 3: { v: "Ladrillo" }, 4: { v: "un" }, 5: { v: 16 }, 6: { v: 5 }, 7: { v: 2500 } });
  put("apu", 4, { 0: { v: "1" }, 1: { v: "MO" }, 2: { v: "ALB" }, 3: { v: "Albañilería" }, 4: { v: "h" }, 5: { v: 0.6 }, 7: { v: 25000 } });
  put("presupuesto", 3, { 0: { v: "1" }, 6: { v: 95000 } });
  put("cronograma", 3, { 0: { v: "1" }, 5: { v: 1 }, 6: { v: 8 }, 7: { f: "=DATE(2026,11,9)" }, 8: { v: "L-V" } });
  const cases: { row: number; serial: number }[] = [];
  for (const calendar of ["L-V", "L-S", "Todos"]) for (let offset = 0; offset < 7; offset++) {
    const row = 4 + cases.length;
    const days = 1 + offset * 2;
    put("cronograma", row, { 0: { v: "1" }, 7: { f: `=DATE(2026,11,${9 + offset})` }, 8: { v: calendar }, 9: { v: days } });
    const date = new Date(Date.UTC(2026, 10, 9 + offset));
    let remaining = days;
    while (true) {
      const weekday = date.getUTCDay();
      if (calendar === "Todos" || (weekday !== 0 && (calendar === "L-S" || weekday !== 6))) remaining--;
      if (!remaining) break;
      date.setUTCDate(date.getUTCDate() + 1);
    }
    cases.push({ row, serial: (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000 });
  }
  // Empty, unused formula rows are omitted in this headless test; all tested
  // expressions and full cross-sheet reference ranges come from the template.
  for (const sheet of Object.values(data.sheets)) for (const row of Object.keys(sheet.cellData!)) {
    if (Number(row) > 25) delete sheet.cellData![Number(row)];
  }
  const book = api.createWorkbook(data);
  const calculate = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { subscription.dispose(); reject(new Error("Univer calculation timed out")); }, 25000);
    const subscription = api.getFormula().calculationEnd(state => { if (state === 3) { clearTimeout(timer); subscription.dispose(); resolve(); } });
    api.getFormula().executeCalculation();
  });
  const raw = (sheet: string, address: string) => book.getSheetByName(sheet)!.getRange(address).getRawValue();
  try {
    await calculate();
    expect(raw("Cómputo", "J4")).toBe(20.8);
    expect(raw("Presupuesto", "H4")).toBe(1976000);
    expect(raw("Presupuesto", "F4")).toBe(57000);
    expect(raw("Materiales", "A4")).toBe("LAD");
    expect(raw("Materiales", "D4")).toBeCloseTo(349.44, 8);
    expect(raw("Cronograma", "E4")).toBe(12.48);
    expect(raw("Cronograma", "M4")).toBe(46336); // 10/11/2026
    for (const item of cases) expect(raw("Cronograma", `M${item.row + 1}`)).toBe(item.serial);
    book.getSheetByName("Cómputo")!.getRange("F4").setValue(16);
    book.getSheetByName("APU")!.getRange("F5").setValue(1.2);
    await calculate();
    expect(raw("Presupuesto", "H4")).toBe(3952000);
    expect(raw("Presupuesto", "F4")).toBe(72000);
    expect(raw("Materiales", "D4")).toBeCloseTo(698.88, 8);
    expect(raw("Cronograma", "E4")).toBe(49.92);
    expect(raw("Cronograma", "M4")).toBe(46343); // 17/11/2026
    book.getSheetByName("APU")!.getRange("H4").clearContent();
    await calculate();
    expect(raw("Presupuesto", "F4")).toBe(""); // Missing cost is not a free resource.
  } finally { univer.dispose(); }
}, 60000);

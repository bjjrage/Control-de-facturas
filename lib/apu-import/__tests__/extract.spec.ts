import { describe, expect, it } from "vitest";
import { extractApuRecipes } from "../extract";
import type { ApuRowLabel, ApuSheetLayout } from "../types";
import type { WorkbookSheetRepresentation } from "@/lib/workbook-interpretation/types";

function sheetFrom(rows: (string | number | null)[][]): WorkbookSheetRepresentation {
  const cells = rows.flatMap((r, i) =>
    r.flatMap((v, j) =>
      v === null
        ? []
        : [{ address: `${String.fromCharCode(65 + j)}${i + 1}`, row: i + 1, column: j + 1, raw: v, formatted: String(v), formula: null, type: typeof v === "number" ? "n" : "s" }]
    )
  );
  return { sheetName: "APU", sheetIndex: 0, usedRange: "A1:F30", rowCount: rows.length, columnCount: 6, mergedCells: [], allCellCount: cells.length, serializedCellCount: cells.length, cells, blocks: [] };
}

const layout: ApuSheetLayout = {
  isApu: true,
  confidence: 0.9,
  columns: { recipeCode: "A", recipeName: null, inputType: null, description: "B", unit: "C", quantity: "D", unitPrice: "E", wastePct: null, lineTotal: null, recipeTotal: "F" },
  notes: "",
  questions: [],
};

describe("extractApuRecipes", () => {
  const sheet = sheetFrom([
    ["Cód.", "Descripción", "Un.", "Cant.", "Precio", "Total"], // 1 encabezado
    ["1.1", "Revoque interior", "m2", null, null, 20000], // 2 partida
    [null, "MATERIALES", null, null, null, null], // 3 sección
    [null, "Cemento", "bolsa", 0.25, 40000, null], // 4
    [null, "Arena lavada", "m3", 0.03, 100000, null], // 5
    [null, "MANO DE OBRA", null, null, null, null], // 6
    [null, "Oficial", "h", 0.8, 5000, null], // 7
    [null, "Ayudante", "h", "abc", 3000, null], // 8 cantidad inválida
    [null, "Nota al pie", null, null, null, null], // 9 sin clasificar
  ]);
  const labels: ApuRowLabel[] = [
    { row: 1, kind: "OTHER", inputType: null },
    { row: 2, kind: "RECIPE_HEADER", inputType: null },
    { row: 3, kind: "SECTION", inputType: "MATERIAL" },
    { row: 4, kind: "INPUT", inputType: null },
    { row: 5, kind: "INPUT", inputType: null },
    { row: 6, kind: "SECTION", inputType: "MANO_DE_OBRA" },
    { row: 7, kind: "INPUT", inputType: null },
    { row: 8, kind: "INPUT", inputType: null },
  ];

  it("arma la partida con su tipo heredado de la sección y valida el total", () => {
    const { recipes } = extractApuRecipes(sheet, layout, labels);
    expect(recipes).toHaveLength(1);
    const r = recipes[0];
    expect(r.name).toBe("Revoque interior");
    expect(r.code).toBe("1.1");
    expect(r.lines.map((l) => [l.tipo, l.descripcion, l.cantidad])).toEqual([
      ["MATERIAL", "Cemento", 0.25],
      ["MATERIAL", "Arena lavada", 0.03],
      ["MANO_DE_OBRA", "Oficial", 0.8],
    ]);
    // 0,25×40.000 + 0,03×100.000 + 0,8×5.000 = 17.000 vs 20.000 declarado
    expect(r.computedTotal).toBe(17000);
    expect(r.totalMismatch).toBe(true);
  });

  it("no descarta nada en silencio: lo dudoso queda sin resolver con su motivo", () => {
    const { unresolved } = extractApuRecipes(sheet, layout, labels);
    expect(unresolved.map((u) => u.row)).toEqual([8, 9]);
    expect(unresolved[0].reason).toMatch(/Cantidad/);
    expect(unresolved[1].reason).toMatch(/no clasificó/);
  });
});

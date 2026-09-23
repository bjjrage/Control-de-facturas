import { describe, it, expect } from "vitest";
import {
  colIndexToLetter,
  formatPlanillaFilterValue,
  isBlankNewPlanillaRow,
  isNewRowId,
  mapFilterBarHeaderWidths,
  matchesPlanillaColumnFilters,
  newRowId,
  omitBlankNewPlanillaRows,
  resolveFormulaTemplate,
  seedRowsWithBlankFloor,
  NEW_ROW_PREFIX,
  MIN_PLANILLA_BLANK_ROWS,
} from "./grid-utils";

describe("identidad de fila — nunca por posición (REGLA #8)", () => {
  it("una fila nueva se marca con el prefijo new: y NO con un uuid pelado", () => {
    const id = newRowId();
    expect(id.startsWith(NEW_ROW_PREFIX)).toBe(true);
    expect(isNewRowId(id)).toBe(true);
  });

  it("dos filas nuevas agregadas una tras otra tienen ids distintos (agregar varias filas)", () => {
    const a = newRowId();
    const b = newRowId();
    expect(a).not.toBe(b);
  });

  it("un uuid real de budget_items (existente) no se confunde con una fila nueva", () => {
    const realId = "3fbe9e2a-1234-4a11-9e11-abcdef123456";
    expect(isNewRowId(realId)).toBe(false);
  });
});

describe("colIndexToLetter — referencias A1", () => {
  it.each([
    [0, "A"],
    [3, "D"],
    [4, "E"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
  ])("índice %i -> %s", (index, expected) => {
    expect(colIndexToLetter(index)).toBe(expected);
  });
});

describe("resolveFormulaTemplate — cantidad × precio_unitario", () => {
  it("sustituye {row} por el número de fila 1-based", () => {
    expect(resolveFormulaTemplate("=D{row}*E{row}", 1)).toBe("=D1*E1");
    expect(resolveFormulaTemplate("=D{row}*E{row}", 42)).toBe("=D42*E42");
  });

  it("recomputa la fórmula al insertar/eliminar filas (misma plantilla, distinta fila)", () => {
    // Simula el reindex que hace handleAfterCreateRow/applyFormulaDefaults
    // cuando una fila se inserta en el medio de la grilla.
    const template = "=D{row}*E{row}";
    const beforeInsert = [1, 2, 3].map((r) => resolveFormulaTemplate(template, r));
    const afterInsertAtIndex1 = [1, 2, 3, 4].map((r) => resolveFormulaTemplate(template, r));
    expect(beforeInsert).toEqual(["=D1*E1", "=D2*E2", "=D3*E3"]);
    expect(afterInsertAtIndex1).toEqual(["=D1*E1", "=D2*E2", "=D3*E3", "=D4*E4"]);
  });
});

describe("PlanillaGrid functional hardening", () => {
  it("siembra el piso de filas vacías cuando abre una planilla sin datos y conserva una reserva", () => {
    let nextIndex = 0;
    const emptyRows = seedRowsWithBlankFloor([], (index) => {
      nextIndex = index + 1;
      return { index };
    });
    expect(emptyRows).toHaveLength(MIN_PLANILLA_BLANK_ROWS);
    expect(emptyRows.map((row) => row.index)).toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(nextIndex).toBe(20);

    const existingRows = seedRowsWithBlankFloor([{ id: "existing" }], () => ({ id: "blank" }));
    expect(existingRows).toHaveLength(MIN_PLANILLA_BLANK_ROWS);
    expect(existingRows[0]).toEqual({ id: "existing" });
  });

  it("omite solo las filas nuevas completamente vacías del snapshot del presupuesto", () => {
    const columns = [
      { key: "code" },
      { key: "description" },
      { key: "quantity" },
      { key: "subtotal", formulaTemplate: "=C{row}*D{row}" },
    ];
    const blank = { _rowId: "new:blank", code: " ", description: null, quantity: null, subtotal: 0 };
    const partial = { _rowId: "new:partial", code: "A-1", description: "", quantity: null, subtotal: 0 };
    const zero = { _rowId: "new:zero", code: "A-2", description: "Trabajo", quantity: 0, subtotal: 0 };
    const existing = { _rowId: "persisted-id", code: "", description: "", quantity: null, subtotal: null };

    expect(isBlankNewPlanillaRow(blank, columns)).toBe(true);
    expect(isBlankNewPlanillaRow(partial, columns)).toBe(false);
    expect(omitBlankNewPlanillaRows([blank, partial, zero, existing], columns)).toEqual([partial, zero, existing]);
  });

  it("un filtro de columna mantiene fuera los valores nuevos no seleccionados", () => {
    const allowed = new Map([["code", new Set(["A"])] ]);
    expect(matchesPlanillaColumnFilters({ code: "A" }, allowed)).toBe(true);
    expect(matchesPlanillaColumnFilters({ code: "C" }, allowed)).toBe(false);
    expect(formatPlanillaFilterValue(null)).toBe("(vacío)");
    expect(matchesPlanillaColumnFilters({ code: null }, new Map([["code", new Set(["(vacío)"])]]))).toBe(true);
    expect(matchesPlanillaColumnFilters({ code: "A" }, new Map([["code", new Set()]]))).toBe(false);
  });

  it("mapea anchos medidos de los encabezados a columna de filas y filtros", () => {
    expect(mapFilterBarHeaderWidths([48, 132, 280, 96], ["code", "description", "quantity"])).toEqual({
      rowHeaderWidth: 48,
      columns: [
        { key: "code", width: 132 },
        { key: "description", width: 280 },
        { key: "quantity", width: 96 },
      ],
    });
    expect(mapFilterBarHeaderWidths([], ["code"])).toBeNull();
  });
});

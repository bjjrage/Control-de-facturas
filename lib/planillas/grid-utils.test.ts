import { describe, it, expect } from "vitest";
import { colIndexToLetter, isNewRowId, newRowId, resolveFormulaTemplate, NEW_ROW_PREFIX } from "./grid-utils";

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

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseInventorySpreadsheet, photoEvidenceProposal } from "../evidence";

describe("evidencia de rendiciones de materiales", () => {
  it("convierte Excel en propuestas sin resolver ni impactar stock", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      { Descripción: "Cemento Portland", Cantidad: 20, Unidad: "bolsa", Partida: "1.2" },
      { Descripción: "Arena", Cantidad: 3, Unidad: "m3" },
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Consumo");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const result = parseInventorySpreadsheet(bytes);

    expect(result.errors).toEqual([]);
    expect(result.rows).toMatchObject([
      { rawDescription: "Cemento Portland", quantity: 20, unit: "bolsa", state: "PROPOSED" },
      { rawDescription: "Arena", quantity: 3, unit: "m3", state: "PROPOSED" },
    ]);
    expect(result.rows[0].productoId).toBeUndefined();
    expect(result.rows[0].budgetItemId).toBeUndefined();
  });

  it("conserva cada fila no vacía como propuesta corregible cuando faltan campos", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      { producto: "Hierro", cantidad: 0 },
      { producto: "", cantidad: 4, unidad: "barra" },
      { producto: "", cantidad: "", unidad: "" },
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Consumo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ producto: "Tornillo", cantidad: 5 }]), "Adicionales");
    const result = parseInventorySpreadsheet(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

    expect(result.failed).toBe(false);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ rawDescription: "Hierro", quantity: null, state: "PROPOSED" });
    expect(result.rows[0].uncertaintyReason).toMatch(/cantidad inválida/);
    expect(result.rows[1]).toMatchObject({ rawDescription: "Fila 3: descripción pendiente", quantity: 4, state: "PROPOSED" });
    expect(result.rows[1].uncertaintyReason).toMatch(/falta descripción/);
    expect(result.rows[2]).toMatchObject({ rawDescription: "Tornillo", quantity: 5, state: "PROPOSED" });
    expect(result.rows[2].uncertaintyReason).toContain("Hoja Adicionales, fila 2");
    expect(result.errors).toEqual([
      "Hoja Consumo, fila 2: cantidad inválida",
      "Hoja Consumo, fila 3: falta descripción",
    ]);
  });

  it("does not drop a first data row when a sheet has no recognized headers", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Cemento", 2, "bolsa"],
      ["Arena", 3, "m3"],
    ]), "Sin encabezados");
    const result = parseInventorySpreadsheet(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

    expect(result.failed).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      rawDescription: "Fila 1: Cemento | 2 | bolsa",
      quantity: null,
      state: "PROPOSED",
    });
    expect(result.rows[0].uncertaintyReason).toContain("no se reconocieron encabezados");
    expect(result.rows[1].rawDescription).toBe("Fila 2: Arena | 3 | m3");
  });

  it("para fotos conserva el contrato de propuesta humana", () => {
    const proposal = photoEvidenceProposal("cuaderno-semana-32.jpg");
    expect(proposal.status).toBe("PROPOSAL_ONLY");
    expect(proposal.requiresHumanConfirmation).toBe(true);
    expect(proposal.message).toMatch(/no se generaron movimientos/);
  });
});

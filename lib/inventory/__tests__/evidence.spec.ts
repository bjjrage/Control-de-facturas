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

  it("marca filas inválidas para revisión", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([{ producto: "Hierro", cantidad: 0 }]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Consumo");
    const result = parseInventorySpreadsheet(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));

    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toMatch(/cantidad inválida/);
  });

  it("para fotos conserva el contrato de propuesta humana", () => {
    const proposal = photoEvidenceProposal("cuaderno-semana-32.jpg");
    expect(proposal.status).toBe("PROPOSAL_ONLY");
    expect(proposal.requiresHumanConfirmation).toBe(true);
    expect(proposal.message).toMatch(/no se generaron movimientos/);
  });
});

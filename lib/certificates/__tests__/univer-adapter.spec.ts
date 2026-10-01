import { describe, expect, it } from "vitest";
import type { IWorkbookData } from "@univerjs/presets";
import type { WorkingSnapshot } from "../workbook-store";
import { univerToWorkingSnapshot, workingSnapshotToUniver } from "../univer-adapter";

/**
 * Fase 3 de "Certificados Excel-first" — ida y vuelta entre la copia de
 * trabajo del ERP y el snapshot que usa Univer para montar la planilla.
 * No prueba el motor de fórmulas en sí (eso ya lo probó la Fase 2 contra el
 * Excel real de MAGY: 2893/2893, 100%) — prueba que la CONVERSIÓN no pierda
 * ni corrompa datos en ninguno de los dos sentidos.
 */
function sample(): WorkingSnapshot {
  return {
    fileName: "certificado.xlsx",
    definedNames: [],
    sheets: [
      {
        name: "CERTIFICADO",
        index: 0,
        hidden: false,
        usedRange: "A1:E2",
        rowCount: 2,
        columnCount: 5,
        merges: ["A1:B1"],
        columnWidths: [80, null, 0],
        cells: [
          [1, 1, "Total certificado", null, null, "s"],
          [2, 1, "1", null, null, "s"],
          [2, 2, "Limpieza de terreno", null, null, "s"],
          [2, 3, 37, null, null, "n"],
          [2, 4, 294005, null, null, "n"],
          [2, 5, 10878185, "10.878.185", "C2*D2", "n"],
        ],
      },
      {
        name: "Julio",
        index: 1,
        hidden: true,
        usedRange: "A1:A1",
        rowCount: 1,
        columnCount: 1,
        merges: [],
        columnWidths: [],
        cells: [[1, 1, "mes anterior", null, null, "s"]],
      },
    ],
  };
}

describe("copia de trabajo ↔ snapshot de Univer", () => {
  it("conserva valores, fórmulas, merges, hojas ocultas y anchos al ir a Univer", () => {
    const univerData = workingSnapshotToUniver(sample(), "cert-1");
    expect(univerData.sheetOrder).toEqual(["CERTIFICADO", "Julio"]);
    expect(univerData.sheets.Julio.hidden).toBe(1);
    expect(univerData.sheets.CERTIFICADO.hidden).toBe(0);
    expect(univerData.sheets.CERTIFICADO.mergeData).toEqual([{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }]);
    expect(univerData.sheets.CERTIFICADO.columnData).toEqual({ 0: { w: 80 }, 2: { w: 0 } });
    // El texto formateado ("=" ausente en cell.v) se pierde a propósito —
    // ver el comentario del adapter; lo que importa es el valor crudo y la
    // fórmula, ya validados por la Fase 2.
    expect(univerData.sheets.CERTIFICADO.cellData![1]![4]).toEqual({ v: 10878185, f: "=C2*D2" });
    expect(univerData.sheets.CERTIFICADO.cellData![1]![2]).toEqual({ v: 37 });
  });

  it("hace el camino inverso sin perder lo que importa (round-trip estable)", () => {
    const original = sample();
    const univerData = workingSnapshotToUniver(original, "cert-1");
    const back = univerToWorkingSnapshot(univerData, original.fileName);

    const certificado = back.sheets.find((s) => s.name === "CERTIFICADO")!;
    const julio = back.sheets.find((s) => s.name === "Julio")!;
    expect(julio.hidden).toBe(true);
    expect(certificado.hidden).toBe(false);
    expect(certificado.merges).toEqual(["A1:B1"]);
    expect(certificado.cells).toEqual(
      expect.arrayContaining([
        [2, 3, 37, null, null, null],
        [2, 5, 10878185, null, "C2*D2", null],
      ])
    );

    // Segunda vuelta: convertir lo ya reconstruido otra vez a Univer y
    // comparar contra la primera — el round-trip debe ser estable (no
    // degradarse en pasadas sucesivas, como pasaría con una edición real
    // seguida de un autoguardado y una reapertura).
    const univerAgain = workingSnapshotToUniver(back, "cert-1");
    expect(univerAgain.sheets.CERTIFICADO.cellData).toEqual(univerData.sheets.CERTIFICADO.cellData);
    expect(univerAgain.sheets.CERTIFICADO.mergeData).toEqual(univerData.sheets.CERTIFICADO.mergeData);
  });

  it("una edición del usuario (cambiar un valor, sin tocar fórmulas) se refleja en el snapshot de vuelta", () => {
    const univerData = workingSnapshotToUniver(sample(), "cert-1");
    const edited: IWorkbookData = {
      ...univerData,
      sheets: {
        ...univerData.sheets,
        CERTIFICADO: {
          ...univerData.sheets.CERTIFICADO,
          cellData: {
            ...univerData.sheets.CERTIFICADO.cellData,
            1: { ...univerData.sheets.CERTIFICADO.cellData![1], 2: { v: 40 } },
          },
        },
      },
    };
    const back = univerToWorkingSnapshot(edited, "certificado.xlsx");
    const certificado = back.sheets.find((s) => s.name === "CERTIFICADO")!;
    expect(certificado.cells.find((c) => c[0] === 2 && c[1] === 3)).toEqual([2, 3, 40, null, null, null]);
    // La fórmula de la columna de al lado no se tocó.
    expect(certificado.cells.find((c) => c[0] === 2 && c[1] === 5)).toEqual([2, 5, 10878185, null, "C2*D2", null]);
  });
});

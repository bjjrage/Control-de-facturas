import { describe, expect, it } from "vitest";
import { encodeSnapshot, decodeSnapshot } from "../snapshot-storage";
import { computeStructureHash, workbookFromSnapshot, type WorkingSnapshot } from "../workbook-store";

function fixture(rows: number): WorkingSnapshot {
  return {
    fileName: "planilla.xlsx", definedNames: [{ name: "Total", ref: "'Hoja 1'!$C$1", sheet: null, value: null }],
    styles: { x1: { n: { pattern: "#,##0.00" }, bl: 1 } },
    sheets: [{ name: "Hoja 1", index: 0, hidden: true, usedRange: `A1:C${rows}`,
      rowCount: rows, columnCount: 3, merges: ["A1:B1"], columnWidths: [80, 140, 90],
      cells: Array.from({ length: rows }, (_,i) => [i+1, 3, i * 2, `${i * 2},00`, `A${i+1}*2`, "n"]),
      styleCells: Array.from({ length: rows }, (_,i) => [i+1, 3, "x1"]),
      rowHeights: { 1: 28 }, hiddenRows: [2], freeze: { rows: 1, columns: 1 },
    }],
  };
}

describe("workbook snapshot persistence", () => {
  it("continues to read legacy JSON snapshots and leaves small snapshots unchanged", () => {
    const snapshot = fixture(3);
    expect(decodeSnapshot(snapshot)).toBe(snapshot);
    expect(encodeSnapshot(snapshot)).toBe(snapshot);
  });

  it("reduces large payloads without changing cells, formulas, formatting or interpretation", () => {
    const snapshot = fixture(18000);
    const stored = encodeSnapshot(snapshot);
    expect(stored).toHaveProperty("encoding", "gzip-base64-v1");
    expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(snapshot).length / 2);
    const restored = decodeSnapshot(JSON.parse(JSON.stringify(stored)));
    expect(restored).toEqual(snapshot);
    expect(computeStructureHash(restored)).toBe(computeStructureHash(snapshot));
    expect(workbookFromSnapshot(restored)).toEqual(workbookFromSnapshot(snapshot));
    restored.sheets[0].cells[1][2] = 42;
    expect(decodeSnapshot(encodeSnapshot(restored)).sheets[0].cells[1][2]).toBe(42);
  });

  it("rejects corrupt compressed payloads rather than silently opening an empty workbook", () => {
    expect(() => decodeSnapshot({ encoding: "gzip-base64-v1", data: "invalid" })).toThrow();
  });
});

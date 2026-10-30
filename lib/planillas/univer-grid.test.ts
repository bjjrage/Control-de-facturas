import { it, expect } from "vitest";
import { fromWorkspaceBook, toWorkspaceBook, WORKSPACE_SHEET } from "./univer-grid";
import { COMPUTO_PRESUPUESTO_COLUMNS as columns } from "./adapters/computo-presupuesto";
it("retains identity, revision and formula across the open-source engine adapter", () => {
  const rows = [{ _rowId: "existing", _version: "v1", code: "01", description: "Trabajo", quantity: 4, unit_price: 100, _formulas: { quantity: "=2+2" } }];
  const book = toWorkspaceBook(rows, columns, "test");
  expect(book.sheets[WORKSPACE_SHEET].columnData?.[6]?.hd).toBe(1);
  const restored = fromWorkspaceBook(book, columns, rows);
  expect(restored).toHaveLength(1); expect(restored[0]).toMatchObject(rows[0]);
});
it("assigns new IDs once and detects deletions and duplicate identities", () => {
  const rows = [{ _rowId: "old", _version: "v1", code: "01", description: "Trabajo" }];
  const book = toWorkspaceBook([], columns, "test"); const cells = book.sheets[WORKSPACE_SHEET].cellData!;
  cells[0] = { 0: { v: "02" }, 1: { v: "Nuevo" } };
  const first = fromWorkspaceBook(book, columns, rows, () => "new:once");
  expect(first[0]._rowId).toBe("new:once"); expect(first[1]._deleted).toBe(true);
  expect(fromWorkspaceBook(book, columns, rows, () => "new:twice")[0]._rowId).toBe("new:once");
  cells[1] = { ...cells[0] }; expect(() => fromWorkspaceBook(book, columns, rows)).toThrow("duplicadas");
});
it("clearing an existing row does not silently delete the budget item", () => {
  const base = [{ _rowId: "existing", _version: "v1", code: "01", description: "Trabajo" }];
  const book = toWorkspaceBook(base, columns, "test");
  book.sheets[WORKSPACE_SHEET].cellData![0] = { 6: { v: "existing" } };
  const restored = fromWorkspaceBook(book, columns, base);
  expect(restored[0]._rowId).toBe("existing"); expect(restored[0]._deleted).not.toBe(true); expect(restored[0].code).toBeNull();
});

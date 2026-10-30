import { it, expect } from "vitest";
import { computoPresupuestoAdapter } from "./computo-presupuesto";

it("loads every budget item across the transport row limit", async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => ({ id: `item-${i}`, code: `${i}`, description: "Trabajo", quantity: 1, unit_price: 100, updated_at: "revision", style: null }));
  const ranges: number[][] = [];
  const query = { select: () => query, eq: () => query, order: () => query,
    range: async (from: number, to: number) => { ranges.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; } };
  const result = await computoPresupuestoAdapter.obtenerFilasIniciales({ from: () => query } as never, { projectId: "project" });
  expect(result).toHaveLength(1201); expect(result[1200]._rowId).toBe("item-1200");
  expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});

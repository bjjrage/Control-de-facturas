import { expect, it, vi } from "vitest";
import { getTool } from "@/lib/agent/registry";
import { getCanonicalInventorySnapshot } from "../service";
vi.mock("../service", () => ({ getCanonicalInventorySnapshot: vi.fn(), getProjectInventorySnapshot: vi.fn(), getBudgetInventoryConsumption: vi.fn() }));
import "@/lib/tools/stock/get-stock-availability";

const snapshot = vi.mocked(getCanonicalInventorySnapshot);
const db = { from: vi.fn(() => {
  const q: any = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "p", unidad: "un", stock_actual: 999, activo: true }, error: null }) };
  return q;
}) };
it("reads confirmed canonical quantity and sums currency buckets per location", async () => {
  snapshot.mockResolvedValue({ error: null, global: [{ quantity: 7 }], locations: [
    { location_id: "l", location_name: "Obra", quantity: 3 },
    { location_id: "l", location_name: "Obra", quantity: 4 },
  ] } as any);
  const result: any = await getTool("get_stock_availability")!.handler({ empresaId: "tenant" } as any, { producto_id: "p" }, { db: db as any });
  expect(result.producto.stock_actual).toBe(7);
  expect(result.por_deposito).toEqual([{ deposito_id: "l", deposito_nombre: "Obra", stock_actual: 7 }]);
  expect(snapshot).toHaveBeenLastCalledWith(db, "tenant", "p");
});
it("fails closed on canonical stock query error", async () => {
  snapshot.mockResolvedValue({ error: "ledger unavailable", global: [], locations: [] });
  await expect(getTool("get_stock_availability")!.handler({ empresaId: "tenant" } as any, { producto_id: "p" }, { db: db as any })).rejects.toThrow("ledger unavailable");
});

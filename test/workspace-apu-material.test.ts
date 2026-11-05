import { expect, it } from "vitest";
import { sourceFunctions } from "./support/source-functions";

function setup(quantity = 1.7424) {
  const stored: Record<string, unknown> = { id: "recipe", empresa_id: "tenant", project_id: "project", budget_item_id: "item", producto_id: "material", cantidad_por_unidad_ejecutada: quantity, desperdicio_pct: 0, precio_unitario_origen: 123, source_sheet: "APU" };
  const filters: [string, unknown][] = [];
  let patch: Record<string, unknown> = {};
  const query = { update(value: Record<string, unknown>) { patch = value; return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, select() { return query; }, async maybeSingle() {
    if (!filters.every(([key, value]) => stored[key] === value)) return { data: null, error: null };
    Object.assign(stored, patch); return { data: { id: stored.id }, error: null };
  } };
  const { saveBudgetItemMaterialAction } = sourceFunctions("app/(internal)/projects/[id]/apu-actions.ts", ["saveBudgetItemMaterialAction"], {
    requirePlan: async () => ({ empresa_id: "tenant" }), createClient: async () => ({ from: () => query }), revalidatePath: () => {},
  });
  return { save: saveBudgetItemMaterialAction, stored };
}
const input = { projectId: "project", budgetItemId: "item", productoId: "material", cantidadPorUnidad: 2.7424, desperdicioPct: 0, expected: { cantidadPorUnidad: 1.7424, desperdicioPct: 0 } };
it("edits the existing material coefficient while preserving source price and provenance", async () => {
  const { save, stored } = setup();
  expect(await save(input)).toEqual({ success: true, error: null });
  expect(stored).toMatchObject({ cantidad_por_unidad_ejecutada: 2.7424, precio_unitario_origen: 123, source_sheet: "APU" });
});
it("refuses a stale APU coefficient or a different project", async () => {
  const { save, stored } = setup(4);
  expect((await save(input)).success).toBe(false);
  expect((await save({ ...input, projectId: "foreign" })).success).toBe(false);
  expect(stored.cantidad_por_unidad_ejecutada).toBe(4);
});
it.each([0, -1, Infinity, NaN, 1.74241])("refuses unsafe or rounded material quantity %s", async quantity => {
  const { save, stored } = setup();
  expect((await save({ ...input, cantidadPorUnidad: quantity })).success).toBe(false);
  expect(stored.cantidad_por_unidad_ejecutada).toBe(1.7424);
});

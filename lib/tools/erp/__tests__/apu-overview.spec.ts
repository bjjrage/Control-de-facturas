import { describe, expect, it, vi } from "vitest";
import { getApuOverviewTool } from "@/lib/tools/erp/get-apu-overview";

function queryBuilder(result: { data: unknown; error: null | { message: string } }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "in", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

const actor = { empresaId: "empresa-1", userId: "user-1", role: "admin" as const, actorType: "user" as const, source: "test" as const };

describe("get_apu_overview: costo unitario combinado", () => {
  it("combined_unit_cost es null (con razón) si falta costo_promedio de un material, aunque haya mano de obra/equipo", async () => {
    const db = {
      from: vi.fn((table: string) => {
        if (table === "projects") return queryBuilder({ data: { id: "proj-1", name: "MAGY", code: "MAGY-01" }, error: null });
        if (table === "budget_items") return queryBuilder({ data: [{ id: "bi-1", code: "5", description: "Cimiento", unit: "m3" }], error: null });
        if (table === "budget_item_materials")
          return queryBuilder({
            data: [
              {
                id: "m-1",
                budget_item_id: "bi-1",
                producto_id: "p-arena",
                cantidad_por_unidad_ejecutada: 0.5,
                desperdicio_pct: 0,
                productos: { id: "p-arena", nombre: "Arena Lavada Gruesa", sku: "ARE-01", unidad: "m3", costo_promedio: 0 },
              },
            ],
            error: null,
          });
        if (table === "budget_item_labor")
          return queryBuilder({
            data: [{ id: "l-1", budget_item_id: "bi-1", rol: "Albañil", horas_por_unidad_ejecutada: 2, costo_hora: 15000 }],
            error: null,
          });
        if (table === "budget_item_equipment") return queryBuilder({ data: [], error: null });
        return queryBuilder({ data: [], error: null });
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const out: any = await getApuOverviewTool.handler(actor, { project_id: "proj-1", budget_item_id: "bi-1" }, { db });
    expect(out.apu_scope).toBe("full");
    expect(out.unavailable_components).toEqual([]);
    expect(out.materials[0].material_unit_cost).toBeNull();
    expect(out.combined_unit_cost).toBeNull();
    expect(out.combined_unit_cost_unavailable_reason).toMatch(/Arena Lavada Gruesa/);
  });

  it("combined_unit_cost numérico cuando todo tiene costo (materiales+mano de obra+equipo)", async () => {
    const db = {
      from: vi.fn((table: string) => {
        if (table === "projects") return queryBuilder({ data: { id: "proj-1", name: "MAGY", code: "MAGY-01" }, error: null });
        if (table === "budget_items") return queryBuilder({ data: [{ id: "bi-1", code: "5", description: "Cimiento", unit: "m3" }], error: null });
        if (table === "budget_item_materials")
          return queryBuilder({
            data: [
              {
                id: "m-1",
                budget_item_id: "bi-1",
                producto_id: "p-cem",
                cantidad_por_unidad_ejecutada: 7,
                desperdicio_pct: 0,
                productos: { id: "p-cem", nombre: "Cemento", sku: "CEM-01", unidad: "bolsas", costo_promedio: 70000 },
              },
            ],
            error: null,
          });
        if (table === "budget_item_labor")
          return queryBuilder({
            data: [{ id: "l-1", budget_item_id: "bi-1", rol: "Albañil", horas_por_unidad_ejecutada: 2, costo_hora: 15000 }],
            error: null,
          });
        if (table === "budget_item_equipment")
          return queryBuilder({
            data: [{ id: "e-1", budget_item_id: "bi-1", tipo_equipo: "Hormigonera", horas_por_unidad_ejecutada: 1, costo_hora: 25000 }],
            error: null,
          });
        return queryBuilder({ data: [], error: null });
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const out: any = await getApuOverviewTool.handler(actor, { project_id: "proj-1", budget_item_id: "bi-1" }, { db });
    // materiales: 7*70000=490000, mano de obra: 2*15000=30000, equipo: 1*25000=25000
    expect(out.combined_unit_cost).toBe(490000 + 30000 + 25000);
    expect(out.combined_unit_cost_unavailable_reason).toBeNull();
  });
});

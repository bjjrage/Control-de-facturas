import { describe, expect, it, vi } from "vitest";
import { getTool } from "@/lib/agent/registry";
import { resolveErpEntityTool } from "@/lib/tools/erp/resolve-erp-entity";
import { postInventoryMovementTool } from "@/lib/tools/erp/post-inventory-movement";
import "@/lib/tools/erp/get-finance-overview";

function queryBuilder(result: { data: unknown; error: null | { message: string } }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "in", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

describe("ERP entity resolution and safe physical actions", () => {
  it("resuelve una obra por nombre sin exigir UUID al usuario", async () => {
    const db = {
      from: vi.fn((table: string) =>
        table === "projects"
          ? queryBuilder({ data: [{ id: "project-1", name: "Algarrobos", code: "ALG-01", client: "Cliente" }], error: null })
          : queryBuilder({ data: [], error: null })
      ),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const output = await resolveErpEntityTool.handler(
      { empresaId: "empresa-1", userId: "user-1", role: "admin", actorType: "user", source: "test" },
      { entity_type: "project", query: "Algarrobos" },
      { db }
    );

    expect(output.exact_match?.id).toBe("project-1");
    expect(output.candidates[0]?.label).toBe("Algarrobos");
    expect(db.from).toHaveBeenCalledWith("projects");
  });

  it("mantiene ambigüedad en vez de inventar una selección", async () => {
    const db = {
      from: vi.fn(() =>
        queryBuilder({
          data: [
            { id: "project-1", name: "Algarrobos Norte", code: "ALG-N", client: null },
            { id: "project-2", name: "Algarrobos Sur", code: "ALG-S", client: null },
          ],
          error: null,
        })
      ),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const output = await resolveErpEntityTool.handler(
      { empresaId: "empresa-1", userId: "user-1", role: "admin", actorType: "user", source: "test" },
      { entity_type: "project", query: "Algarrobos" },
      { db }
    );

    expect(output.exact_match).toBeNull();
    expect(output.ambiguous).toBe(true);
  });

  it("registra el movimiento físico por el servicio canónico y no por una tabla directa", async () => {
    const db = {
      from: vi.fn((table: string) =>
        table === "productos"
          ? queryBuilder({ data: { id: "product-1", unidad: "bolsa", empresa_id: "empresa-1" }, error: null })
          : queryBuilder({ data: [], error: null })
      ),
      rpc: vi.fn(async () => ({ data: "movement-1", error: null })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const output = await postInventoryMovementTool.handler(
      { empresaId: "empresa-1", userId: "user-1", role: "admin", actorType: "user", source: "test", taskId: "task-1" },
      {
        producto_id: "00000000-0000-0000-0000-000000000001",
        quantity: 50,
        unit: "bolsa",
        movement_type: "TRANSFER",
        from_location_id: "00000000-0000-0000-0000-000000000002",
        to_location_id: "00000000-0000-0000-0000-000000000003",
      },
      { db }
    );

    expect(output.movement_id).toBe("movement-1");
    expect(db.rpc).toHaveBeenCalledWith("inventory_post_movement", expect.objectContaining({
      p_movement_type: "TRANSFER",
      p_quantity: 50,
      p_empresa_id: "empresa-1",
    }));
    expect(getTool("post_inventory_movement")?.riskLevel).toBe(2);
    expect(getTool("get_finance_overview")?.riskLevel).toBe(0);
  });
});

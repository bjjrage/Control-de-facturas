import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureProjectInventoryLocation, projectInventoryLocationName } from "../service";

type QueryResult = {
  data: Record<string, unknown> | null;
  error: { code?: string; message: string } | null;
};
type QueryCall = {
  table: string;
  operation: "select" | "insert" | "update";
  filters: [string, unknown][];
  values?: Record<string, unknown>;
};

function inventoryClient(args: {
  project?: Record<string, unknown> | null;
  existing?: Record<string, unknown> | null;
  insertError?: QueryResult["error"];
} = {}) {
  const calls: QueryCall[] = [];
  const client = {
    from(table: string) {
      const call: QueryCall = { table, operation: "select", filters: [] };
      calls.push(call);
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { call.filters.push([column, value]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        insert(values: Record<string, unknown>) { call.operation = "insert"; call.values = values; return builder; },
        update(values: Record<string, unknown>) { call.operation = "update"; call.values = values; return builder; },
        async maybeSingle(): Promise<QueryResult> {
          if (table === "projects") return { data: args.project === undefined ? { id: "project-1", name: "Edificio Norte" } : args.project, error: null };
          return { data: args.existing ?? null, error: null };
        },
        async single(): Promise<QueryResult> {
          return { data: args.insertError ? null : { id: "location-1" }, error: args.insertError ?? null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("ubicación PROJECT canónica por obra", () => {
  it("usa nombre visible estable y crea una única ubicación principal de la empresa", async () => {
    expect(projectInventoryLocationName("  Edificio Norte  ")).toBe("Depósito de obra · Edificio Norte");
    const { client, calls } = inventoryClient();
    const result = await ensureProjectInventoryLocation(client, {
      empresaId: "company-1",
      projectId: "project-1",
      createdBy: "user-1",
    });

    expect(result).toEqual({ data: { id: "location-1", created: true }, error: null });
    const projectQuery = calls.find((call) => call.table === "projects");
    expect(projectQuery?.filters).toContainEqual(["empresa_id", "company-1"]);
    const insert = calls.find((call) => call.operation === "insert");
    expect(insert?.values).toMatchObject({
      empresa_id: "company-1",
      project_id: "project-1",
      location_type: "PROJECT",
      name: "Depósito de obra · Edificio Norte",
      is_primary: true,
    });
  });

  it("reutiliza una ubicación existente y no duplica al reintentar", async () => {
    const { client, calls } = inventoryClient({ existing: { id: "location-existing", active: true } });
    const result = await ensureProjectInventoryLocation(client, {
      empresaId: "company-1",
      projectId: "project-1",
      createdBy: "user-1",
    });

    expect(result).toEqual({ data: { id: "location-existing", created: false }, error: null });
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
    expect(calls.find((call) => call.table === "inventory_locations")?.filters).toEqual(expect.arrayContaining([
      ["empresa_id", "company-1"],
      ["project_id", "project-1"],
      ["location_type", "PROJECT"],
    ]));
  });

  it("no crea una ubicación si la obra no pertenece a la empresa solicitante", async () => {
    const { client, calls } = inventoryClient({ project: null });
    const result = await ensureProjectInventoryLocation(client, {
      empresaId: "other-company",
      projectId: "project-1",
      createdBy: "user-1",
    });

    expect(result.data).toBeNull();
    expect(result.error).toContain("no pertenece");
    expect(calls.some((call) => call.table === "inventory_locations")).toBe(false);
  });
});

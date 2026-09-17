import { describe, it, expect, beforeEach, vi } from "vitest";
import { toolRegistry } from "../registry";
// Importa para auto-registrar los 2 READ tools
import "@/lib/tools/projects/get-project-context";
import "@/lib/tools/stock/get-stock-availability";
import { getTool } from "../registry";
import { GetProjectContextInputSchema } from "@/lib/tools/projects/get-project-context";
import { GetStockAvailabilityInputSchema } from "@/lib/tools/stock/get-stock-availability";

describe("READ tools registration", () => {
  it("get_project_context registrado como LEVEL 0 READ", () => {
    const t = getTool("get_project_context");
    expect(t).toBeDefined();
    expect(t?.riskLevel).toBe(0);
    expect(t?.description.length).toBeGreaterThan(10);
  });

  it("get_stock_availability registrado como LEVEL 0 READ", () => {
    const t = getTool("get_stock_availability");
    expect(t).toBeDefined();
    expect(t?.riskLevel).toBe(0);
  });

  it("validacion Zod de inputs: project_id debe ser uuid", () => {
    expect(() => GetProjectContextInputSchema.parse({ project_id: "no-uuid" })).toThrow();
    expect(() => GetProjectContextInputSchema.parse({ project_id: "00000000-0000-4000-a000-000000000001" })).not.toThrow();
    expect(() => GetStockAvailabilityInputSchema.parse({ producto_id: "bad" })).toThrow();
    expect(() => GetStockAvailabilityInputSchema.parse({ producto_id: "00000000-0000-4000-a000-000000000001" })).not.toThrow();
    expect(() =>
      GetStockAvailabilityInputSchema.parse({
        producto_id: "00000000-0000-4000-a000-000000000001",
        project_id: "00000000-0000-4000-a000-000000000002",
      })
    ).not.toThrow();
  });

  it("handlers no confian en input.empresa_id — solo usan ctx.empresaId", async () => {
    // Creamos un fake DB que capture el filtro empresa_id usado
    let capturedEmpresaFilter: string | null = null;
    const fakeDb = {
      from: vi.fn((table: string) => {
        if (table === "projects") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn(function (this: unknown, col: string, val: unknown) {
              if (col === "empresa_id") capturedEmpresaFilter = val as string;
              return this;
            }),
            single: vi.fn().mockResolvedValue({
              data: {
                id: "00000000-0000-4000-a000-000000000001",
                empresa_id: "empresa-confiable",
                name: "Obra Norte",
                code: "OB-001",
                client: "Cliente",
                location: "Asuncion",
                status: "ACTIVO",
                budget_total: 1000,
                start_date: null,
                end_date: null,
                created_at: new Date().toISOString(),
              },
              error: null,
            }),
          };
        }
        if (table === "budget_items") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            // await sin .single() debe ser thenable
            then: undefined,
          } as unknown as ReturnType<typeof vi.fn>;
        }
        // Para simplificar, retornamos objetos thenable mock
        const builder: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        };
        // Hacer thenable
        (builder as { then: unknown }).then = (onFulfilled: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(onFulfilled as never);
        return builder;
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    // Mock budget_items y execution_entries que el handler también consulta
    const origFrom = fakeDb.from;
    // Fix: cast a firma callable precisa para evitar TS2348 sobre Mock no callable en entornos strict
    (fakeDb as unknown as { from: unknown }).from = vi.fn((table: string) => {
      if (table === "projects") return (origFrom as unknown as (t: string) => unknown)(table);
      if (table === "budget_items" || table === "execution_entries") {
        // Retornar builder thenable que resuelve a array vacio
        const b: Record<string, unknown> = {};
        b.select = vi.fn().mockReturnValue(b);
        b.eq = vi.fn().mockReturnValue(b);
        // thenable
        (b as unknown as { then: (cb: (v: unknown) => void) => void }).then = (cb: (v: unknown) => void) =>
          Promise.resolve({ data: [], error: null }).then(cb as never);
        return (origFrom as unknown as (t: string) => unknown)(table);
      }
      return (origFrom as unknown as (t: string) => unknown)(table);
    }) as unknown as ReturnType<typeof vi.fn>;

    const tool = getTool("get_project_context");
    expect(tool).toBeDefined();
    const ctx = { empresaId: "empresa-confiable", userId: "u1", role: "admin" as const, actorType: "user" as const, source: "web" as const };
    const input = { project_id: "00000000-0000-4000-a000-000000000001", empresa_id: "EMPRESA_INYECTADA" } as unknown as { project_id: string };
    // El handler debe ignorar input.empresa_id y usar ctx.empresaId
    await tool!.handler(ctx, input, { db: fakeDb });
    expect(capturedEmpresaFilter).toBe("empresa-confiable");
    expect(capturedEmpresaFilter).not.toBe("EMPRESA_INYECTADA");
  });
});
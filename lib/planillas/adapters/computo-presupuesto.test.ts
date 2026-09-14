import { describe, it, expect, vi } from "vitest";
import { computoPresupuestoAdapter, COMPUTO_PRESUPUESTO_COLUMNS } from "./computo-presupuesto";

const EMPRESA_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_A = "22222222-2222-2222-2222-222222222222";
const PROJECT_B = "33333333-3333-3333-3333-333333333333"; // pertenece a otra empresa

function createMockSupabase(projectsById: Record<string, { empresa_id: string }>) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_field: string, id: string) => ({
              eq: vi.fn().mockImplementation((_f2: string, empresaId: string) => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: projectsById[id]?.empresa_id === empresaId ? { id } : null,
                  error: null,
                }),
              })),
            })),
          }),
        };
      }
      if (table === "budget_items") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                returns: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`tabla no mockeada: ${table}`);
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("computoPresupuestoAdapter.resolverContexto — aislamiento multi-tenant", () => {
  it("resuelve el contexto cuando el proyecto pertenece a la empresa del usuario", async () => {
    const supabase = createMockSupabase({ [PROJECT_A]: { empresa_id: EMPRESA_A } });
    const contexto = await computoPresupuestoAdapter.resolverContexto(supabase, EMPRESA_A, { projectId: PROJECT_A });
    expect(contexto).toEqual({ projectId: PROJECT_A });
  });

  it("rechaza un proyecto de OTRA empresa aunque el UUID sea válido (cross-tenant)", async () => {
    const supabase = createMockSupabase({ [PROJECT_B]: { empresa_id: "otra-empresa" } });
    await expect(
      computoPresupuestoAdapter.resolverContexto(supabase, EMPRESA_A, { projectId: PROJECT_B })
    ).rejects.toThrow(/no encontrado|no pertenece/i);
  });

  it("rechaza un projectId inexistente", async () => {
    const supabase = createMockSupabase({});
    await expect(
      computoPresupuestoAdapter.resolverContexto(supabase, EMPRESA_A, { projectId: PROJECT_A })
    ).rejects.toThrow();
  });

  it("rechaza contexto sin projectId (tipo inválido, no confía en el shape del cliente)", async () => {
    const supabase = createMockSupabase({ [PROJECT_A]: { empresa_id: EMPRESA_A } });
    await expect(computoPresupuestoAdapter.resolverContexto(supabase, EMPRESA_A, {})).rejects.toThrow(
      /projectId/
    );
    await expect(computoPresupuestoAdapter.resolverContexto(supabase, EMPRESA_A, null)).rejects.toThrow();
    await expect(
      computoPresupuestoAdapter.resolverContexto(supabase, EMPRESA_A, { projectId: 123 })
    ).rejects.toThrow();
  });
});

describe("COMPUTO_PRESUPUESTO_COLUMNS — única fuente de verdad de columnas", () => {
  it("subtotal es de solo lectura y no tiene un writer propio (columna derivada)", () => {
    const subtotal = COMPUTO_PRESUPUESTO_COLUMNS.find((c) => c.key === "subtotal");
    expect(subtotal?.readOnly).toBe(true);
    expect(subtotal?.type).toBe("readonly-numeric");
  });

  it("subtotal se calcula como cantidad × precio_unitario vía fórmula HyperFormula, nunca hardcodeado", () => {
    const subtotal = COMPUTO_PRESUPUESTO_COLUMNS.find((c) => c.key === "subtotal");
    // D=quantity, E=unit_price en el orden real de columnas — si alguien
    // reordena COMPUTO_PRESUPUESTO_COLUMNS sin actualizar la plantilla, esta
    // aserción falla en vez de dejar un subtotal silenciosamente incorrecto.
    const quantityIdx = COMPUTO_PRESUPUESTO_COLUMNS.findIndex((c) => c.key === "quantity");
    const priceIdx = COMPUTO_PRESUPUESTO_COLUMNS.findIndex((c) => c.key === "unit_price");
    const letter = (i: number) => String.fromCharCode(65 + i);
    expect(subtotal?.formulaTemplate).toBe(`=${letter(quantityIdx)}{row}*${letter(priceIdx)}{row}`);
  });

  it("no persiste dos veces el mismo dato: ninguna columna editable duplica a `subtotal`", () => {
    const writableKeys = COMPUTO_PRESUPUESTO_COLUMNS.filter((c) => !c.readOnly).map((c) => c.key);
    expect(writableKeys).not.toContain("subtotal");
  });
});

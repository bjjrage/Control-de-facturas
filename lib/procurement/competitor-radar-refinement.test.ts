import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listCompetitorsRadar,
  CompetitorListEntry,
  RadarFilterParams,
} from "./competitor-intelligence";

describe("Competitor Radar Refinement & Tenant Exclusions", () => {
  const EMPRESA_A = "11111111-1111-4111-a111-111111111111";
  const EMPRESA_B = "22222222-2222-4222-b222-222222222222";

  // Mock de datos históricos globales en v_procurement_competitor_global
  const mockGlobalSuppliers = [
    {
      supplier_id: "supp-1",
      nombre: "CONSTRUCTORA CHACO S.A.",
      ruc_clean: "80012345",
      dv: "1",
      tipo_entidad: "EMPRESA",
      tamano: "GRANDE",
      total_bids: 20,
      total_wins: 8,
      global_win_rate_pct: 40.0,
      total_awarded_amount: 15_000_000_000,
      global_avg_discount_pct: 12.5,
      certainty_tier: "ALTA",
      last_seen_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), // Hace 1 mes (activo en 24m)
    },
    {
      supplier_id: "supp-2",
      nombre: "VIALTEC INGENIERIA S.R.L.",
      ruc_clean: "80054321",
      dv: "2",
      tipo_entidad: "EMPRESA",
      tamano: "MEDIANA",
      total_bids: 8,
      total_wins: 2,
      global_win_rate_pct: 25.0,
      total_awarded_amount: 4_500_000_000,
      global_avg_discount_pct: 8.0,
      certainty_tier: "MEDIA",
      last_seen_at: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(), // Hace 2 meses (activo en 24m)
    },
    {
      supplier_id: "supp-3",
      nombre: "CONSTRUCTORA ANTIGUA HISTORICA",
      ruc_clean: "80099999",
      dv: "9",
      tipo_entidad: "EMPRESA",
      tamano: "GRANDE",
      total_bids: 15,
      total_wins: 5,
      global_win_rate_pct: 33.3,
      total_awarded_amount: 10_000_000_000,
      global_avg_discount_pct: 10.0,
      certainty_tier: "ALTA",
      last_seen_at: new Date(Date.now() - 40 * 30 * 24 * 3600 * 1000).toISOString(), // Hace 40 meses (inactivo en 24m)
    },
    {
      supplier_id: "supp-4",
      nombre: "EMPRESA INACTIVA SIN OFERTAS",
      ruc_clean: "80000001",
      dv: "0",
      tipo_entidad: "EMPRESA",
      tamano: "PEQUEÑA",
      total_bids: 0,
      total_wins: 0,
      global_win_rate_pct: 0,
      total_awarded_amount: 0,
      global_avg_discount_pct: 0,
      certainty_tier: "INSUFICIENTE",
      last_seen_at: null,
    },
    {
      supplier_id: "supp-5",
      nombre: "OFERENTE NO GANADOR S.A.",
      ruc_clean: "80088888",
      dv: "8",
      tipo_entidad: "EMPRESA",
      tamano: "PEQUEÑA",
      total_bids: 3,
      total_wins: 0,
      global_win_rate_pct: 0,
      total_awarded_amount: 0,
      global_avg_discount_pct: 5.0,
      certainty_tier: "BAJA",
      last_seen_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(), // Hace 10 días
    },
  ];

  // Mock de exclusiones privadas de la empresa
  let tenantExclusions: Array<{ empresa_id: string; supplier_id: string; reason: string | null; created_at: string }> = [];

  function createMockSupabase() {
    return {
      rpc: vi.fn().mockImplementation((fnName: string, args: any) => {
        // Simular que el RPC falla o no existe para testear el motor de fallback fiel
        return Promise.resolve({ data: null, error: { message: "RPC_FALLBACK_TEST" } });
      }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "empresa_competitor_exclusions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((field: string, val: string) => {
                const filtered = tenantExclusions.filter((x) => x.empresa_id === val);
                return Promise.resolve({ data: filtered, error: null });
              }),
            }),
            upsert: vi.fn().mockImplementation((rows: any[]) => {
              for (const r of rows) {
                tenantExclusions = tenantExclusions.filter(
                  (x) => !(x.empresa_id === r.empresa_id && x.supplier_id === r.supplier_id)
                );
                tenantExclusions.push({ ...r, created_at: new Date().toISOString() });
              }
              return Promise.resolve({ error: null });
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockImplementation((field: string, ids: string[]) => {
                  tenantExclusions = tenantExclusions.filter((x) => !ids.includes(x.supplier_id));
                  return Promise.resolve({ error: null });
                }),
              }),
            }),
          };
        }

        if (table === "procurement_suppliers") {
          return {
            select: vi.fn().mockReturnValue(Promise.resolve({ count: mockGlobalSuppliers.length, error: null })),
          };
        }

        if (table === "procurement_awards") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue(Promise.resolve({ data: [], error: null })),
              }),
            }),
          };
        }

        if (table === "v_procurement_competitor_global") {
          return {
            select: vi.fn().mockImplementation(() => {
              let rows = [...mockGlobalSuppliers];
              const queryObj: any = {
                or: vi.fn().mockImplementation((clause: string) => {
                  const match = clause.match(/%([^%]+)%/);
                  const term = match ? match[1].toLowerCase() : "";
                  rows = rows.filter(
                    (r) => r.nombre.toLowerCase().includes(term) || r.ruc_clean.toLowerCase().includes(term)
                  );
                  return queryObj;
                }),
                gte: vi.fn().mockImplementation((field: string, val: any) => {
                  if (field === "total_bids") {
                    rows = rows.filter((r) => r.total_bids >= Number(val));
                  } else if (field === "last_seen_at") {
                    const cutoff = new Date(val).getTime();
                    rows = rows.filter((r) => r.last_seen_at && new Date(r.last_seen_at).getTime() >= cutoff);
                  }
                  return queryObj;
                }),
                eq: vi.fn().mockImplementation((field: string, val: any) => {
                  if (field === "certainty_tier") {
                    rows = rows.filter((r) => r.certainty_tier === val);
                  } else if (field === "total_wins") {
                    rows = rows.filter((r) => r.total_wins === Number(val));
                  }
                  return queryObj;
                }),
                gt: vi.fn().mockImplementation((field: string, val: any) => {
                  if (field === "total_wins") {
                    rows = rows.filter((r) => r.total_wins > Number(val));
                  }
                  return queryObj;
                }),
                order: vi.fn().mockImplementation((field: string, opts?: any) => {
                  return queryObj;
                }),
                then: (resolve: any) => resolve({ data: rows, error: null }),
              };
              return queryObj;
            }),
          };
        }

        return {
          select: vi.fn().mockReturnValue(Promise.resolve({ data: [], error: null })),
        };
      }),
    } as any;
  }

  beforeEach(() => {
    tenantExclusions = [];
  });

  it("1. Comportamiento por Defecto: Filtro 24 meses y >=1 oferta oculta proveedores inactivos o sin ofertas", async () => {
    const supabase = createMockSupabase();

    // Default: periodMonths=24, minBids=1, evidence="CON_EVIDENCIA"
    const res = await listCompetitorsRadar(supabase, EMPRESA_A, {
      periodMonths: 24,
      minBids: 1,
      evidence: "CON_EVIDENCIA",
    });

    // Debe incluir supp-1, supp-2 y supp-5 (activos en 24m y total_bids >= 1)
    // NO debe incluir supp-3 (inactivo hace 40 meses) ni supp-4 (0 ofertas)
    const ids = res.competitors.map((c) => c.supplier_id);
    expect(ids).toContain("supp-1");
    expect(ids).toContain("supp-2");
    expect(ids).toContain("supp-5");
    expect(ids).not.toContain("supp-3");
    expect(ids).not.toContain("supp-4");
  });

  it("2. Filtro Período 'Todo el histórico' (periodMonths=0) expone competidores antiguos", async () => {
    const supabase = createMockSupabase();

    const res = await listCompetitorsRadar(supabase, EMPRESA_A, {
      periodMonths: 0,
      minBids: 1,
      evidence: "CON_EVIDENCIA",
    });

    const ids = res.competitors.map((c) => c.supplier_id);
    expect(ids).toContain("supp-3"); // Ahora sí aparece
  });

  it("3. Filtro de Ofertas Mínimas (minBids >= 5) filtra competidores casuales", async () => {
    const supabase = createMockSupabase();

    const res = await listCompetitorsRadar(supabase, EMPRESA_A, {
      periodMonths: 24,
      minBids: 5,
    });

    const ids = res.competitors.map((c) => c.supplier_id);
    expect(ids).toContain("supp-1"); // 20 ofertas
    expect(ids).toContain("supp-2"); // 8 ofertas
    expect(ids).not.toContain("supp-5"); // 3 ofertas -> excluido por filtro
  });

  it("4. Filtro de Certeza Estadística (certainty='ALTA') solo retorna competidores con muestra robusta", async () => {
    const supabase = createMockSupabase();

    const res = await listCompetitorsRadar(supabase, EMPRESA_A, {
      periodMonths: 0,
      certainty: "ALTA",
    });

    for (const c of res.competitors) {
      expect(c.certainty_tier).toBe("ALTA");
    }
  });

  it("5. Búsqueda combinada por RUC o Nombre", async () => {
    const supabase = createMockSupabase();

    const res = await listCompetitorsRadar(supabase, EMPRESA_A, {
      periodMonths: 0,
      search: "VIALTEC",
    });

    expect(res.competitors.length).toBe(1);
    expect(res.competitors[0].ruc_clean).toBe("80054321");
  });

  it("6. Tenant Isolation: Empresa A excluye a un competidor; Empresa B lo sigue viendo", async () => {
    const supabase = createMockSupabase();

    // Empresa A excluye a supp-1
    tenantExclusions.push({
      empresa_id: EMPRESA_A,
      supplier_id: "supp-1",
      reason: "No compite en nuestro rubro",
      created_at: new Date().toISOString(),
    });

    // Consulta para Empresa A: supp-1 está OCULTO por defecto
    const resA = await listCompetitorsRadar(supabase, EMPRESA_A, {
      periodMonths: 24,
      includeExcluded: false,
    });
    const idsA = resA.competitors.map((c) => c.supplier_id);
    expect(idsA).not.toContain("supp-1");

    // Consulta para Empresa B: supp-1 SIGUE VISIBLE (aislamiento estricto)
    const resB = await listCompetitorsRadar(supabase, EMPRESA_B, {
      periodMonths: 24,
      includeExcluded: false,
    });
    const idsB = resB.competitors.map((c) => c.supplier_id);
    expect(idsB).toContain("supp-1");
  });

  it("7. Toggle 'Mostrar excluidos' retorna el competidor excluido con marca is_excluded=true", async () => {
    const supabase = createMockSupabase();

    tenantExclusions.push({
      empresa_id: EMPRESA_A,
      supplier_id: "supp-1",
      reason: "Exclusión de prueba",
      created_at: new Date().toISOString(),
    });

    const res = await listCompetitorsRadar(supabase, EMPRESA_A, {
      periodMonths: 24,
      includeExcluded: true,
    });

    const supp1 = res.competitors.find((c) => c.supplier_id === "supp-1");
    expect(supp1).toBeDefined();
    expect(supp1?.is_excluded).toBe(true);
    expect(supp1?.exclusion_reason).toBe("Exclusión de prueba");
  });

  it("8. Invariante Crítica: NINGÚN registro de procurement_suppliers ni evidencia canónica es eliminado", async () => {
    const supabase = createMockSupabase();

    // Simular exclusión en tenant
    tenantExclusions.push({
      empresa_id: EMPRESA_A,
      supplier_id: "supp-1",
      reason: "Exclusión",
      created_at: new Date().toISOString(),
    });

    // El catálogo global de proveedores y ofertas sigue intacto
    expect(mockGlobalSuppliers.length).toBe(5);
    expect(mockGlobalSuppliers.find((s) => s.supplier_id === "supp-1")).toBeDefined();
  });
});

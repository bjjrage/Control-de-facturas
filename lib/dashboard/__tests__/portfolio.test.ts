import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/types";
import {
  buildOperationalAttentionAlerts,
  buildPortfolioPanorama,
  buildPortfolioRows,
  countMaterialsBelowMinimum,
} from "../portfolio";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    empresa_id: "empresa-1",
    name: "Obra principal",
    code: "OP-01",
    client: null,
    location: null,
    start_date: "2026-01-01",
    end_date: "2026-09-01",
    status: "ACTIVO",
    budget_total: 100,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    execution_token: "token",
    comitente: null,
    contract_number: null,
    contract_amount: 0,
    plazo_dias: null,
    orden_inicio_date: null,
    fiscalizacion_nombre: null,
    fiscalizacion_contrato: null,
    anticipo_pct: 0,
    devolucion_anticipo_pct: 0,
    retencion_pct: 0,
    iva_pct: 10,
    ...overrides,
  };
}

describe("portfolio dashboard calculations", () => {
  it("counts low-stock materials from the summed canonical balances, never from legacy product counters", () => {
    expect(countMaterialsBelowMinimum(
      [{ id: "cement", stock_minimo: 10 }, { id: "sand", stock_minimo: 5 }, { id: "brick", stock_minimo: 0 }],
      [
        { producto_id: "cement", quantity: 4 },
        { producto_id: "cement", quantity: 5 },
        { producto_id: "sand", quantity: 8 },
      ],
    )).toBe(2);
  });

  it("reutiliza presupuesto, compras, avance y desvíos por obra", () => {
    const rows = buildPortfolioRows(
      [project()],
      [
        { project_id: "project-1", quantity: 10, subtotal: 120 },
        { project_id: "project-1", quantity: 10, subtotal: 80 },
      ],
      [{ project_id: "project-1", total_price: 230 }],
      [{ project_id: "project-1", quantity_executed: 10 }],
      "2026-09-20",
    );

    expect(rows[0]).toMatchObject({
      presupuesto: 200,
      compras: 230,
      comprasPct: 115,
      avancePct: 50,
      atrasoDias: 19,
      estado: "Riesgo",
    });
  });

  it("calcula la cartera activa y el avance ponderado sin incluir obras cerradas", () => {
    const rows = buildPortfolioRows(
      [
        project({ id: "active", budget_total: 100, end_date: "2026-10-01" }),
        project({ id: "closed", status: "COMPLETADO", budget_total: 900, end_date: "2025-01-01" }),
      ],
      [
        { project_id: "active", quantity: 10, subtotal: 100 },
        { project_id: "closed", quantity: 10, subtotal: 900 },
      ],
      [],
      [
        { project_id: "active", quantity_executed: 5 },
        { project_id: "closed", quantity_executed: 10 },
      ],
      "2026-09-20",
    );

    expect(buildPortfolioPanorama(rows, 3, 4, 2)).toMatchObject({
      obrasActivas: 1,
      carteraActivaPyg: 100,
      avanceFisicoPonderado: 50,
      productosStockMinimo: 3,
      ordenesCompra: 4,
      certificadosPendientes: 2,
      desviosCosto: 0,
      desviosPlazo: 0,
    });
  });

  it("genera solo señales operativas con datos disponibles", () => {
    const rows = buildPortfolioRows(
      [project()],
      [{ project_id: "project-1", quantity: 1, subtotal: 100 }],
      [{ project_id: "project-1", total_price: 120 }],
      [],
      "2026-09-20",
    );

    const alerts = buildOperationalAttentionAlerts(rows, 2, 1);
    expect(alerts.map((alert) => alert.id)).toEqual([
      "obra-atrasada-project-1",
      "obra-costo-project-1",
      "productos-stock-critico",
      "certificados-pendientes",
    ]);
  });

  it("does not present failed canonical stock reads as zero or healthy", () => {
    expect(buildPortfolioPanorama([], 0, 0, 0, true).stockSourceUnavailable).toBe(true);
    expect(buildOperationalAttentionAlerts([], 0, 0, true)).toContainEqual(expect.objectContaining({
      id: "stock-canonico-no-disponible",
      href: "/inventario",
      tone: "error",
    }));
  });
});

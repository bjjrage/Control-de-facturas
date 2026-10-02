import { describe, expect, it } from "vitest";
import { computePartidaCosts } from "@/lib/costing/cost-budget";
import { resolveProjectPriceSemantics } from "@/lib/costing/project-prices";
import type { CostObservation } from "@/lib/cost-engine/types";
import { planSemanalToFlujoItems } from "@/lib/flujo-caja";
import { calculateWeeklyPlanRequirements } from "../weekly-plan-engine";

describe("precio resuelto → Costeo → Plan Semanal → Flujo de Caja", () => {
  it("una cotización de 80 no reduce los costos calculados desde una compra de 100", () => {
    const purchase: CostObservation = {
      id: "invoice-line-1",
      empresaId: "empresa-1",
      productoId: "cemento",
      proveedorId: "provider-1",
      documentoId: "invoice-1",
      fuente: "FACTURA",
      descripcionItem: "Cemento",
      categoriaInsumo: "MATERIAL",
      cantidad: 10,
      unidad: "bolsa",
      precioUnitario: 100,
      moneda: "PYG",
      fechaObservacion: "2026-09-30",
      estadoEvidencia: "VALIDA",
    };
    const resolved = resolveProjectPriceSemantics({
      purchaseObservations: [purchase],
      quotes: [{ quoteVersionItemId: "quote-item-1", precio: 80, venceEl: "2026-10-31", providerName: "Proveedor A", rfqCode: "RFQ-01", currency: "PYG" }],
      today: "2026-10-01",
    });
    expect(resolved.currentQuote?.precio).toBe(80);
    expect(resolved.price?.precio).toBe(100);

    const costeo = computePartidaCosts(
      [{ id: "budget-item-1", quantity: 3, unitPrice: 1_000 }],
      {
        materials: [{ budgetItemId: "budget-item-1", productoId: "cemento", cantidadPorUnidad: 2, desperdicioPct: 0 }],
        labor: [],
        equipment: [],
        subcontracts: [],
      },
      new Map([["cemento", resolved.price!]])
    );
    expect(costeo["budget-item-1"].costoUnitario).toBe(200);
    expect(costeo["budget-item-1"].costoTotal).toBe(600);

    const plan = calculateWeeklyPlanRequirements({
      project_id: "project-1",
      start_date: "2026-10-05",
      end_date: "2026-10-11",
      budget_items: [{
        id: "budget-item-1", project_id: "project-1", parent_id: null, code: "01", description: "Muro", unit: "m2",
        quantity: 10, unit_price: 1_000, subtotal: 10_000, sort_order: 1, start_date: null, end_date: null,
        depends_on: null, quantity_per_unit: null, material_requirement: "REQUIRES_BOM", created_at: "2026-09-01",
      }],
      executed_quantities_by_item: {},
      targets: [{ budget_item_id: "budget-item-1", input_mode: "QUANTITY", input_value: 3 }],
      materials_by_item: {
        "budget-item-1": [{
          budget_item_id: "budget-item-1", producto_id: "cemento", producto_nombre: "Cemento", unidad_medida: "bolsa",
          cantidad_por_unidad_ejecutada: 2, desperdicio_pct: 0, costo_unitario: resolved.price!.precio,
        }],
      },
      stock_and_inbound: {},
    });
    expect(plan.items[0].materials[0]).toMatchObject({ costo_unitario: 100, caja_adicional_requerida: 600 });
    expect(plan.total_additional_cash_required).toBe(600);

    const cashflow = planSemanalToFlujoItems({
      planId: "plan-1", projectId: "project-1", projectName: "Obra", status: "DRAFT",
      startDate: "2026-10-05", endDate: "2026-10-11",
      faltanteMateriales: plan.total_additional_cash_required,
      costoManoObra: 0,
      costoEquipos: 0,
      costoSubcontratos: 0,
    });
    expect(cashflow).toHaveLength(1);
    expect(cashflow[0]).toMatchObject({ tipo: "salida_proyectada_material", monto: -600 });
  });
});

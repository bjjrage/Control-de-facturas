import { describe, expect, it } from "vitest";
import type { CostObservation } from "@/lib/cost-engine/types";
import { resolveProjectPriceSemantics, type QuoteOption } from "../project-prices";

const today = "2026-10-01";

function observation(overrides: Partial<CostObservation>): CostObservation {
  return {
    id: "purchase-1",
    empresaId: "empresa-1",
    productoId: "cemento",
    fuente: "FACTURA",
    documentoId: "invoice-1",
    proveedorId: "provider-1",
    descripcionItem: "Cemento",
    categoriaInsumo: "MATERIAL",
    cantidad: 1,
    unidad: "bolsa",
    precioUnitario: 100,
    moneda: "PYG",
    fechaObservacion: "2026-09-30",
    estadoEvidencia: "VALIDA",
    ...overrides,
  };
}

const quote: QuoteOption = {
  quoteVersionItemId: "quote-item-1",
  precio: 80,
  venceEl: "2026-10-31",
  providerName: "Proveedor A",
  rfqCode: "RFQ-01",
  currency: "PYG",
};

describe("resolveProjectPriceSemantics", () => {
  it("separa compra 100 de cotización 80 y usa la compra sin adopción", () => {
    const result = resolveProjectPriceSemantics({
      purchaseObservations: [observation({})],
      quotes: [quote],
      today,
    });

    expect(result.lastPurchasePrice).toMatchObject({ precio: 100, fuente: "FACTURA", documentoId: "invoice-1" });
    expect(result.currentQuote).toMatchObject({ precio: 80, quoteVersionItemId: "quote-item-1" });
    expect(result.adoptedPrice).toBeNull();
    expect(result.price).toMatchObject({ precio: 100, fuente: "FACTURA" });
  });

  it("usa precio adoptado humano 85 y conserva fuente, fecha y usuario", () => {
    const adopted = {
      precio: 85,
      fuente: "COTIZACION" as const,
      quoteVersionItemId: "quote-item-1",
      adopted: true,
      adoptedAt: "2026-10-01T10:00:00Z",
      adoptedBy: "user-1",
    };
    const result = resolveProjectPriceSemantics({
      adoptedPrice: adopted,
      purchaseObservations: [observation({})],
      quotes: [quote],
      today,
    });

    expect(result.lastPurchasePrice?.precio).toBe(100);
    expect(result.currentQuote?.precio).toBe(80);
    expect(result.adoptedPrice).toMatchObject({ precio: 85, adopted: true, adoptedBy: "user-1", quoteVersionItemId: "quote-item-1" });
    expect(result.price).toMatchObject({ precio: 85, adopted: true, adoptedBy: "user-1" });
  });

  it("mantiene quote 80 y CPP 90 separados cuando no hay compra", () => {
    const result = resolveProjectPriceSemantics({
      purchaseObservations: [],
      quotes: [quote],
      inventoryCpp: 90,
      today,
    });

    expect(result.lastPurchasePrice).toBeNull();
    expect(result.currentQuote?.precio).toBe(80);
    expect(result.estimatedPrice).toBeNull();
    expect(result.price).toEqual({ precio: 90, fuente: "CPP" });
  });

  it("excluye APU/manual y órdenes de compra del baseline transaccional", () => {
    const result = resolveProjectPriceSemantics({
      purchaseObservations: [
        observation({ id: "apu-1", fuente: "MANUAL", documentoId: "PLANILLA_APU:receta", precioUnitario: 110 }),
        observation({ id: "oc-1", fuente: "ORDEN_COMPRA", documentoId: "order-1", precioUnitario: 100 }),
      ],
      today,
    });

    expect(result.lastPurchasePrice).toBeNull();
    expect(result.estimatedPrice).toBeNull();
    expect(result.price).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WarehousePortalClient } from "@/app/warehouse/[token]/warehouse-portal-client";
import type { WarehousePortalContext } from "@/lib/inventory/warehouse-portal-data";

const base = {
  token: "test-token",
  locationName: "Depósito de prueba",
  projectName: "Obra de prueba",
  projectCode: "TEST",
  orders: [],
  stock: [],
  budgetItems: [],
  allProducts: [],
} as unknown as WarehousePortalContext;

describe("warehouse scanner entry", () => {
  it("shows a scan action even when no purchase order is pending", () => {
    const html = renderToStaticMarkup(createElement(WarehousePortalClient, { context: base }));
    expect(html).toContain("Escanear documento para rendición");
  });

  it("shows receipt scanning when an order can be received", () => {
    const context = {
      ...base,
      orders: [{
        id: "order-1",
        code: "OC-1",
        providerName: "Proveedor",
        items: [{ id: "item-1", productId: "product-1", productName: "Producto", pending: 1, ordered: 1, received: 0, unit: "u" }],
      }],
    } as unknown as WarehousePortalContext;
    const html = renderToStaticMarkup(createElement(WarehousePortalClient, { context }));
    expect(html).toContain("Escanear remito o factura");
  });
});

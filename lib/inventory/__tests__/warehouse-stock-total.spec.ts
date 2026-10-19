import { expect, it } from "vitest";
import { aggregateWarehouseStock } from "@/lib/inventory/warehouse-portal-data";

it("#17 sums all currency balance rows for a product in the selected location", () => {
  const stock = aggregateWarehouseStock([
    { producto_id: "cement", producto: "Cemento", unidad: "bolsa", quantity: 3 },
    { producto_id: "cement", producto: "Cemento", unidad: "bolsa", quantity: 4 },
    { producto_id: "paint", producto: "Pintura", unidad: "l", quantity: 2 },
  ]);
  expect(stock).toEqual([
    { productId: "cement", productName: "Cemento", unit: "bolsa", quantity: 7 },
    { productId: "paint", productName: "Pintura", unit: "l", quantity: 2 },
  ]);
});

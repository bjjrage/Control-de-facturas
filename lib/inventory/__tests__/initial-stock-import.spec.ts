import { describe, expect, it } from "vitest";
import {
  detectInitialStockColumnMapping,
  findUniqueExactInventoryMatch,
  normalizeInventoryImportText,
  parseInventoryImportCurrency,
  parseInventoryImportNumber,
} from "../initial-stock-import";

describe("importación de carga inicial de stock", () => {
  it("interpreta números habituales en formato local e internacional", () => {
    expect(parseInventoryImportNumber("1.234,50")).toBe(1234.5);
    expect(parseInventoryImportNumber("1,234.50")).toBe(1234.5);
    expect(parseInventoryImportNumber("2,75")).toBe(2.75);
    expect(parseInventoryImportNumber("texto")).toBeNull();
  });

  it("solo vincula automáticamente un nombre normalizado con coincidencia única", () => {
    const materials = [
      { id: "cemento", name: "Cemento Portland" },
      { id: "arena-a", name: "Arena lavada" },
      { id: "arena-b", name: "Árena lavada" },
    ];
    expect(normalizeInventoryImportText("Árido / Hormigón")).toBe("arido hormigon");
    expect(findUniqueExactInventoryMatch(" cemento  portland ", materials)?.id).toBe("cemento");
    expect(findUniqueExactInventoryMatch("Arena lavada", materials)).toBeNull();
    expect(findUniqueExactInventoryMatch("Cemento", materials)).toBeNull();
  });

  it("no infiere monedas ambiguas y detecta encabezados sin un orden fijo", () => {
    expect(parseInventoryImportCurrency("USD")).toBe("USD");
    expect(parseInventoryImportCurrency("Dólares")).toBeNull();
    expect(parseInventoryImportCurrency("Gs.")).toBe("PYG");
    expect(detectInitialStockColumnMapping(["Costo unitario", "Almacén", "Stock", "Material", "Unidad", "Divisa"])).toMatchObject({
      material: 3,
      quantity: 2,
      unit: 4,
      location: 1,
      unitCost: 0,
      currency: 5,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  resolveApuMaterialImportMapping,
  resolveApuLaborImportMapping,
  resolveApuEquipmentImportMapping,
} from "../lib/procurement/apu-import";

const budgetItems = [
  { id: "bi-1", code: "5", unit: "m3" },
  { id: "bi-2", code: "8", unit: "m2" },
];

const products = [
  { id: "p-cem", sku: "CEM-01" },
  { id: "p-arena", sku: "ARE-01" },
];

describe("resolveApuMaterialImportMapping", () => {
  it("mapea varias filas de materiales a la misma partida sin pisarse", () => {
    const { mapped, errors } = resolveApuMaterialImportMapping(
      [
        { itemCode: "5", productSku: "CEM-01", quantityPerUnit: 7, desperdicioPct: 5 },
        { itemCode: "5", productSku: "ARE-01", quantityPerUnit: 0.5 },
      ],
      budgetItems,
      products
    );
    expect(errors).toEqual([]);
    expect(mapped).toEqual([
      { budgetItemId: "bi-1", productoId: "p-cem", cantidadPorUnidad: 7, desperdicioPct: 5 },
      { budgetItemId: "bi-1", productoId: "p-arena", cantidadPorUnidad: 0.5, desperdicioPct: 0 },
    ]);
  });

  it("rechaza código de partida inexistente sin insertar nada silenciosamente", () => {
    const { mapped, errors } = resolveApuMaterialImportMapping(
      [{ itemCode: "999", productSku: "CEM-01", quantityPerUnit: 1 }],
      budgetItems,
      products
    );
    expect(mapped).toEqual([]);
    expect(errors[0].reason).toMatch(/no existe en el presupuesto/);
  });

  it("rechaza producto inexistente por sku", () => {
    const { mapped, errors } = resolveApuMaterialImportMapping(
      [{ itemCode: "5", productSku: "NOPE", quantityPerUnit: 1 }],
      budgetItems,
      products
    );
    expect(mapped).toEqual([]);
    expect(errors[0].reason).toMatch(/no existe en el catálogo/);
  });

  it("rechaza combinación partida+producto duplicada dentro del mismo excel", () => {
    const { mapped, errors } = resolveApuMaterialImportMapping(
      [
        { itemCode: "5", productSku: "CEM-01", quantityPerUnit: 7 },
        { itemCode: "5", productSku: "CEM-01", quantityPerUnit: 3 },
      ],
      budgetItems,
      products
    );
    expect(mapped.length).toBe(1);
    expect(errors[0].reason).toMatch(/duplicada/);
  });

  it("rechaza cantidad <= 0", () => {
    const { mapped, errors } = resolveApuMaterialImportMapping(
      [{ itemCode: "5", productSku: "CEM-01", quantityPerUnit: 0 }],
      budgetItems,
      products
    );
    expect(mapped).toEqual([]);
    expect(errors[0].reason).toMatch(/inválida/);
  });
});

describe("resolveApuLaborImportMapping", () => {
  it("mapea varias filas de mano de obra a la misma partida", () => {
    const { mapped, errors } = resolveApuLaborImportMapping(
      [
        { itemCode: "5", rol: "Albañil", horasPorUnidad: 2, costoHora: 15000 },
        { itemCode: "5", rol: "Ayudante", horasPorUnidad: 3, costoHora: 10000 },
      ],
      budgetItems
    );
    expect(errors).toEqual([]);
    expect(mapped).toEqual([
      { budgetItemId: "bi-1", rol: "Albañil", horasPorUnidad: 2, costoHora: 15000 },
      { budgetItemId: "bi-1", rol: "Ayudante", horasPorUnidad: 3, costoHora: 10000 },
    ]);
  });

  it("rechaza rol duplicado en la misma partida", () => {
    const { mapped, errors } = resolveApuLaborImportMapping(
      [
        { itemCode: "5", rol: "Albañil", horasPorUnidad: 2, costoHora: 15000 },
        { itemCode: "5", rol: "albañil", horasPorUnidad: 1, costoHora: 15000 },
      ],
      budgetItems
    );
    expect(mapped.length).toBe(1);
    expect(errors[0].reason).toMatch(/duplicada/);
  });

  it("rechaza costo por hora negativo", () => {
    const { mapped, errors } = resolveApuLaborImportMapping(
      [{ itemCode: "5", rol: "Albañil", horasPorUnidad: 2, costoHora: -1 }],
      budgetItems
    );
    expect(mapped).toEqual([]);
    expect(errors[0].reason).toMatch(/Costo por hora vacío o inválido/);
  });

  it("rechaza costo por hora vacío: nunca lo toma como 0", () => {
    const { mapped, errors } = resolveApuLaborImportMapping(
      [{ itemCode: "5", rol: "Albañil", horasPorUnidad: 2, costoHora: null }],
      budgetItems
    );
    expect(mapped).toEqual([]);
    expect(errors[0].reason).toMatch(/vacío/);
  });
});

describe("resolveApuEquipmentImportMapping", () => {
  it("mapea equipo por partida", () => {
    const { mapped, errors } = resolveApuEquipmentImportMapping(
      [{ itemCode: "8", tipoEquipo: "Hormigonera", horasPorUnidad: 1.5, costoHora: 25000 }],
      budgetItems
    );
    expect(errors).toEqual([]);
    expect(mapped).toEqual([
      { budgetItemId: "bi-2", tipoEquipo: "Hormigonera", horasPorUnidad: 1.5, costoHora: 25000 },
    ]);
  });
});

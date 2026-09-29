import { describe, expect, it } from "vitest";
import {
  matchBudgetItemsToApuTemplates,
  resolveApuTemplateMaterialImportMapping,
  resolveApuTemplateLaborImportMapping,
} from "../lib/procurement/apu-templates";

describe("matchBudgetItemsToApuTemplates", () => {
  const templates = [
    { id: "tpl-mamp", nombre: "Mampostería de elevación con ladrillo común" },
    { id: "tpl-cim", nombre: "Cimiento de PBC" },
  ];

  it("matchea por descripción normalizada (acentos/mayúsculas no importan)", () => {
    const { matched, unmatched } = matchBudgetItemsToApuTemplates(
      [
        { id: "bi-1", description: "MAMPOSTERIA DE ELEVACION CON LADRILLO COMUN" },
        { id: "bi-2", description: "Excavación de zanja" },
      ],
      templates
    );
    expect(matched).toEqual([{ budgetItemId: "bi-1", templateId: "tpl-mamp" }]);
    expect(unmatched).toEqual([{ budgetItemId: "bi-2", description: "Excavación de zanja" }]);
  });

  it("no aplica nada si la descripción es ambigua entre dos plantillas", () => {
    const dupTemplates = [
      { id: "tpl-a", nombre: "Contrapiso" },
      { id: "tpl-b", nombre: "contrapiso" },
    ];
    const { matched, unmatched } = matchBudgetItemsToApuTemplates(
      [{ id: "bi-1", description: "Contrapiso" }],
      dupTemplates
    );
    expect(matched).toEqual([]);
    expect(unmatched.length).toBe(1);
  });
});

describe("resolveApuTemplateMaterialImportMapping", () => {
  const products = [{ id: "p-cem", sku: "CEM-01" }];

  it("agrupa varias filas de material bajo el mismo nombre de plantilla", () => {
    const { mapped, errors } = resolveApuTemplateMaterialImportMapping(
      [
        { templateNombre: "Cimiento de PBC", productSku: "CEM-01", quantityPerUnit: 7, desperdicioPct: 5 },
      ],
      products
    );
    expect(errors).toEqual([]);
    expect(mapped).toEqual([
      { templateNombre: "Cimiento de PBC", productoId: "p-cem", cantidadPorUnidad: 7, desperdicioPct: 5 },
    ]);
  });

  it("rechaza producto inexistente", () => {
    const { mapped, errors } = resolveApuTemplateMaterialImportMapping(
      [{ templateNombre: "Cimiento de PBC", productSku: "NOPE", quantityPerUnit: 1 }],
      products
    );
    expect(mapped).toEqual([]);
    expect(errors[0].reason).toMatch(/no existe en el catálogo/);
  });
});

describe("resolveApuTemplateLaborImportMapping", () => {
  it("mapea mano de obra por nombre de plantilla", () => {
    const { mapped, errors } = resolveApuTemplateLaborImportMapping([
      { templateNombre: "Cimiento de PBC", rol: "Albañil", horasPorUnidad: 2, costoHora: 15000 },
    ]);
    expect(errors).toEqual([]);
    expect(mapped).toEqual([{ templateNombre: "Cimiento de PBC", rol: "Albañil", horasPorUnidad: 2, costoHora: 15000 }]);
  });
});

import { describe, expect, it } from "vitest";
import {
  computePartidaCosts,
  computeProjectCostTotals,
  suggestMaterialPrice,
  type ResolvedPrice,
} from "../lib/costing/cost-budget";
import { explodeMaterialNeeds, groupNeedsByRubro } from "../lib/costing/insumos";
import { matchLaborRate, resolveApuTemplateSubcontractImportMapping } from "../lib/procurement/apu-templates";
import { resolveApuSubcontractImportMapping } from "../lib/procurement/apu-import";

const partidas = [
  { id: "p1", quantity: 10, unitPrice: 200000 },
  { id: "p2", quantity: 5, unitPrice: 100000 },
];

describe("computePartidaCosts: 4 patas del APU", () => {
  it("suma materiales + mano de obra + equipo + subcontrato por unidad y total", () => {
    const prices = new Map<string, ResolvedPrice>([["cem", { precio: 70000, fuente: "COTIZACION" }]]);
    const costs = computePartidaCosts(
      partidas,
      {
        materials: [{ budgetItemId: "p1", productoId: "cem", cantidadPorUnidad: 1, desperdicioPct: 10 }],
        labor: [{ budgetItemId: "p1", horasPorUnidad: 2, costoHora: 15000 }],
        equipment: [{ budgetItemId: "p1", horasPorUnidad: 0.5, costoHora: 20000 }],
        subcontracts: [{ budgetItemId: "p1", precioPorUnidad: 10000 }],
      },
      prices
    );
    // 77.000 + 30.000 + 10.000 + 10.000 = 127.000 por unidad
    expect(costs.p1.costoUnitario).toBeCloseTo(127000);
    expect(costs.p1.costoTotal).toBeCloseTo(1270000);
    expect(costs.p1.margenUnitario).toBeCloseTo(73000);
    expect(costs.p1.margenPct).toBeCloseTo(36.5);
  });

  it("falta precio de un material → costo null con faltantes, nunca 0", () => {
    const costs = computePartidaCosts(
      partidas,
      {
        materials: [{ budgetItemId: "p1", productoId: "arena", cantidadPorUnidad: 1, desperdicioPct: 0 }],
        labor: [{ budgetItemId: "p1", horasPorUnidad: 1, costoHora: 15000 }],
        equipment: [],
        subcontracts: [],
      },
      new Map()
    );
    expect(costs.p1.costoUnitario).toBeNull();
    expect(costs.p1.costoTotal).toBeNull();
    expect(costs.p1.faltantes).toEqual(["arena"]);
    expect(costs.p1.costoManoObra).toBe(15000);
  });

  it("partida solo subcontratada también tiene costo", () => {
    const costs = computePartidaCosts(
      partidas,
      { materials: [], labor: [], equipment: [], subcontracts: [{ budgetItemId: "p2", precioPorUnidad: 60000 }] },
      new Map()
    );
    expect(costs.p2.costoUnitario).toBe(60000);
    expect(costs.p2.costoTotal).toBe(300000);
  });
});

describe("computeProjectCostTotals", () => {
  it("marca el total como incompleto si hay partidas sin APU o con faltantes", () => {
    const costs = computePartidaCosts(
      partidas,
      { materials: [], labor: [], equipment: [], subcontracts: [{ budgetItemId: "p2", precioPorUnidad: 60000 }] },
      new Map()
    );
    const t = computeProjectCostTotals(partidas, costs);
    expect(t.ventaTotal).toBe(2500000);
    expect(t.costoTotal).toBe(300000);
    expect(t.partidasSinApu).toBe(1);
    expect(t.completo).toBe(false);
  });
});

describe("suggestMaterialPrice: orden de fuentes", () => {
  const today = "2026-09-28";
  it("elegido por el usuario manda sobre todo", () => {
    expect(
      suggestMaterialPrice({
        chosen: { precio: 5, fuente: "MANUAL" },
        quotes: [{ quoteVersionItemId: "q1", precio: 1, venceEl: null }],
        today,
      })
    ).toEqual({ precio: 5, fuente: "MANUAL" });
  });
  it("cotización vigente más barata, ignora vencidas", () => {
    const r = suggestMaterialPrice({
      quotes: [
        { quoteVersionItemId: "vieja", precio: 50, venceEl: "2026-01-01" },
        { quoteVersionItemId: "cara", precio: 90, venceEl: null },
        { quoteVersionItemId: "barata", precio: 80, venceEl: "2026-12-31" },
      ],
      estimate: 10,
      today,
    });
    expect(r).toEqual({ precio: 80, fuente: "COTIZACION", quoteVersionItemId: "barata" });
  });
  it("sin cotizaciones → estimación → histórico → null", () => {
    expect(suggestMaterialPrice({ estimate: 70, costoPromedio: 60, today })?.fuente).toBe("ESTIMACION");
    expect(suggestMaterialPrice({ estimate: null, costoPromedio: 60, today })?.fuente).toBe("HISTORICO");
    expect(suggestMaterialPrice({ estimate: null, costoPromedio: 0, today })).toBeNull();
  });
});

describe("explodeMaterialNeeds + groupNeedsByRubro", () => {
  it("suma el mismo insumo entre partidas y agrupa por rubro", () => {
    const needs = explodeMaterialNeeds(
      [
        { id: "p1", quantity: 10 },
        { id: "p2", quantity: 4 },
        { id: "p3", quantity: null },
      ],
      [
        { budgetItemId: "p1", productoId: "cem", cantidadPorUnidad: 7, desperdicioPct: 0 },
        { budgetItemId: "p2", productoId: "cem", cantidadPorUnidad: 2, desperdicioPct: 50 },
        { budgetItemId: "p1", productoId: "hierro", cantidadPorUnidad: 1, desperdicioPct: 0 },
        { budgetItemId: "p3", productoId: "arena", cantidadPorUnidad: 1, desperdicioPct: 0 },
      ]
    );
    const cem = needs.find((n) => n.productoId === "cem")!;
    expect(cem.cantidad).toBe(82); // 70 + 12
    expect(cem.partidas).toEqual(["p1", "p2"]);
    expect(needs.find((n) => n.productoId === "arena")).toBeUndefined();

    const grouped = groupNeedsByRubro(needs, [
      { id: "cem", nombre: "Cemento", unidad: "bolsa", categoriaId: "aglomerantes" },
      { id: "hierro", nombre: "Hierro 8mm", unidad: "kg", categoriaId: null },
    ]);
    expect(grouped.rubros).toHaveLength(1);
    expect(grouped.rubros[0].categoriaId).toBe("aglomerantes");
    expect(grouped.sinRubro.map((s) => s.productoId)).toEqual(["hierro"]);
  });
});

describe("jornales y subcontrato en el APU", () => {
  it("enlaza el rol con la categoría de jornal por nombre normalizado", () => {
    const rates = [
      { id: "r1", categoria: "Oficial albañil" },
      { id: "r2", categoria: "Ayudante" },
    ];
    expect(matchLaborRate("OFICIAL ALBAÑIL", rates)?.id).toBe("r1");
    expect(matchLaborRate("Capataz", rates)).toBeNull();
  });

  it("mapea subcontratos por código de partida y rechaza duplicados", () => {
    const { mapped, errors } = resolveApuSubcontractImportMapping(
      [
        { itemCode: "5", descripcion: "Mano de obra mampostería", precioPorUnidad: 45000 },
        { itemCode: "5", descripcion: "mano de obra mampostería", precioPorUnidad: 1 },
        { itemCode: "99", descripcion: "X", precioPorUnidad: 1 },
      ],
      [{ id: "bi-5", code: "5" }]
    );
    expect(mapped).toEqual([{ budgetItemId: "bi-5", descripcion: "Mano de obra mampostería", precioPorUnidad: 45000 }]);
    expect(errors.map((e) => e.row)).toEqual([2, 3]);
  });

  it("mapea subcontratos de plantilla", () => {
    const { mapped } = resolveApuTemplateSubcontractImportMapping([
      { templateNombre: "Mampostería 15cm", descripcion: "Colocación", precioPorUnidad: 40000 },
    ]);
    expect(mapped).toHaveLength(1);
  });
});

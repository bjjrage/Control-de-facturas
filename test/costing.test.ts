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

describe("cotización multi-ítem → base de precios", () => {
  it("líneas en PYG entran VALIDA; sin precio no entran", async () => {
    const { buildQuoteCostObservations, quoteTotal } = await import("../lib/costing/quote-observations");
    const lines = [
      { productoId: "cem", descripcion: "Cemento", cantidad: 100, unidad: "bolsa", precioUnitario: 70000 },
      { productoId: "are", descripcion: "Arena", cantidad: 5, unidad: "m3", precioUnitario: null },
    ];
    const obs = buildQuoteCostObservations({
      empresaId: "e1", projectId: "p1", providerId: "prov1", quoteVersionId: "qv1", currency: "PYG", fecha: "2026-09-28", lines,
    });
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ producto_id: "cem", precio_unitario: 70000, estado_evidencia: "VALIDA", unidad: "BOLSA", fuente: "COTIZACION" });
    expect(quoteTotal(lines)).toBe(7000000);
  });

  it("otra moneda sin tipo de cambio → REVISION_REQUERIDA sin precio, nunca convierte inventando", async () => {
    const { buildQuoteCostObservations } = await import("../lib/costing/quote-observations");
    const [o] = buildQuoteCostObservations({
      empresaId: "e1", projectId: null, providerId: null, quoteVersionId: "qv1", currency: "USD", fecha: "2026-09-28",
      lines: [{ productoId: "cem", descripcion: "Cemento", cantidad: 1, unidad: "bolsa", precioUnitario: 9 }],
    });
    expect(o.precio_unitario).toBeNull();
    expect(o.estado_evidencia).toBe("REVISION_REQUERIDA");
    expect(o.precio_unitario_original).toBe(9);
    expect(o.moneda_original).toBe("USD");
  });
});

describe("offerExpiryDate", () => {
  it("interpreta días, semanas y meses desde el envío", async () => {
    const { offerExpiryDate } = await import("../lib/costing/cost-budget");
    expect(offerExpiryDate("2026-09-01T10:00:00Z", "30 dias")).toBe("2026-10-01");
    expect(offerExpiryDate("2026-09-01T10:00:00Z", "2 semanas")).toBe("2026-09-15");
    expect(offerExpiryDate("2026-09-01T10:00:00Z", "1 meses")).toBe("2026-10-01");
    expect(offerExpiryDate("2026-09-01T10:00:00Z", "hasta agotar stock")).toBeNull();
  });
});

describe("nextPartidaCodes", () => {
  it("continúa la numeración CM- sin repetir códigos existentes", async () => {
    const { nextPartidaCodes } = await import("../lib/computo/new-partidas");
    expect(nextPartidaCodes([], 2)).toEqual(["CM-001", "CM-002"]);
    expect(nextPartidaCodes(["1", "2", "CM-004"], 2)).toEqual(["CM-005", "CM-006"]);
  });
});

describe("computeRealVsBudget", () => {
  it("compara el real contra el costo presupuestado × % de avance", async () => {
    const { computeRealVsBudget } = await import("../lib/costing/real-vs-budget");
    const rows = computeRealVsBudget({
      partidas: [
        { id: "p1", quantity: 100, costoTotal: 10_000_000 },
        { id: "p2", quantity: 50, costoTotal: null },
        { id: "p3", quantity: 10, costoTotal: 1_000_000 },
      ],
      executedByItem: { p1: 40, p2: 10 },
      realMaterial: { p1: 3_000_000 },
      realLabor: { p1: 2_000_000, p2: 500_000 },
      realSubcontract: {},
    });
    const p1 = rows.find((r) => r.budgetItemId === "p1")!;
    expect(p1.avancePct).toBe(40);
    expect(p1.presupuestadoALaFecha).toBe(4_000_000);
    expect(p1.real).toBe(5_000_000);
    expect(p1.desvio).toBe(1_000_000);
    expect(p1.desvioPct).toBe(25);
    const p2 = rows.find((r) => r.budgetItemId === "p2")!;
    expect(p2.presupuestadoALaFecha).toBeNull();
    expect(p2.desvio).toBeNull();
    expect(rows.find((r) => r.budgetItemId === "p3")).toBeUndefined();
  });
});

describe("mano de obra por período", () => {
  it("presupuesta la mano de obra a la fecha según el avance y calcula el destajo", async () => {
    const { laborBudgetToDate, destajoAmount } = await import("../lib/costing/real-vs-budget");
    const total = laborBudgetToDate(
      [
        { id: "a", quantity: 100, costoManoObraUnitario: 20_000 },
        { id: "b", quantity: 10, costoManoObraUnitario: 0 },
        { id: "c", quantity: 50, costoManoObraUnitario: 10_000 },
      ],
      { a: 50, b: 10, c: 80 }
    );
    // a: 100 × 20.000 × 50 % = 1.000.000 · c: avance topado en 100 % = 500.000
    expect(total).toBe(1_500_000);
    expect(destajoAmount(120, 25_000)).toBe(3_000_000);
  });
});

describe("lista de precios", () => {
  it("usa el historial, cae al costo promedio y nunca inventa un precio", async () => {
    const { buildPriceList, sourceLabel } = await import("../lib/costing/price-list");
    const rows = buildPriceList(
      [
        { id: "a", nombre: "Cemento", unidad: "bolsa", rubro: "Cementos", costoPromedio: null },
        { id: "b", nombre: "Arena", unidad: "m3", rubro: null, costoPromedio: 90_000 },
        { id: "c", nombre: "Listón", unidad: "m", rubro: null, costoPromedio: null },
      ],
      [
        { id: "o1", productoId: "a", fuente: "MANUAL", documentoId: "PLANILLA_APU:Revoque", proveedorId: null, cantidad: 1, unidad: "BOLSA", precio: 42_000, fecha: "2026-09-01", esVolatil: false },
        { id: "o2", productoId: "a", fuente: "FACTURA", documentoId: "f1", proveedorId: "p1", cantidad: 100, unidad: "BOLSA", precio: 45_000, fecha: "2026-09-20", esVolatil: false },
      ],
      "2026-09-28"
    );
    const a = rows.find((r) => r.productoId === "a")!;
    expect(a.origen).toBe("HISTORIAL");
    expect(a.precio).toBeGreaterThan(42_000);
    expect(a.precio).toBeLessThanOrEqual(45_000);
    expect(a.ultimo).toMatchObject({ precio: 45_000, fuente: "Factura", proveedorId: "p1" });
    const b = rows.find((r) => r.productoId === "b")!;
    expect(b).toMatchObject({ precio: 90_000, origen: "COSTO_PROMEDIO", ultimo: null });
    const c = rows.find((r) => r.productoId === "c")!;
    expect(c).toMatchObject({ precio: null, origen: null });
    expect(sourceLabel("MANUAL", "PLANILLA_APU:x")).toBe("Planilla APU");
    expect(sourceLabel("MANUAL", "PRECIO_LISTA")).toBe("Cargado a mano");
  });
});

describe("compras sin material asignado", () => {
  it("agrupa por descripción y se queda con el último precio", async () => {
    const { groupUnlinkedPurchases } = await import("../lib/costing/price-list");
    const out = groupUnlinkedPurchases([
      { descripcion: "Cemento CPF40 50kg", precio: 40_000, fecha: "2026-08-01", fuente: "FACTURA", documentoId: "f1" },
      { descripcion: "Cemento CPF40 50kg", precio: 43_000, fecha: "2026-09-10", fuente: "FACTURA", documentoId: "f2" },
      { descripcion: "Arena fina", precio: 90_000, fecha: "2026-09-01", fuente: "COTIZACION", documentoId: "q1" },
    ]);
    expect(out[0]).toMatchObject({ descripcion: "Cemento CPF40 50kg", registros: 2, ultimoPrecio: 43_000, fuente: "Factura" });
    expect(out[1]).toMatchObject({ descripcion: "Arena fina", registros: 1, fuente: "Cotización" });
  });
});

describe("plan semanal: mano de obra, equipos y subcontratos de las recetas", () => {
  it("calcula horas y costo por categoría a partir de la meta de la semana", async () => {
    const { calculateWeeklyPlanRequirements } = await import("../lib/procurement/weekly-plan-engine");
    const item = {
      id: "b1", project_id: "p1", parent_id: null, code: "17", description: "Revoque interior", unit: "m2",
      quantity: 1000, unit_price: 35_000, subtotal: 35_000_000, sort_order: 1, start_date: null, end_date: null,
      depends_on: null, quantity_per_unit: null, material_requirement: "NO_MATERIAL" as const, created_at: "2026-09-01",
    };
    const summary = calculateWeeklyPlanRequirements({
      project_id: "p1",
      start_date: "2026-09-28",
      end_date: "2026-10-04",
      budget_items: [item],
      executed_quantities_by_item: {},
      targets: [{ budget_item_id: "b1", input_mode: "QUANTITY", input_value: 100 } as any],
      materials_by_item: {},
      stock_and_inbound: {},
      labor_by_item: { b1: [{ label: "Oficial", horas_por_unidad: 0.8, costo_hora: 5000 }, { label: "Ayudante", horas_por_unidad: 0.8, costo_hora: 3000 }] },
      equipment_by_item: { b1: [{ label: "Mezcladora", horas_por_unidad: 0.1, costo_hora: 16000 }] },
      subcontracts_by_item: { b1: [{ label: "Terminación fina", precio_por_unidad: 6000 }] },
    });
    const r = summary.resource_requirements!;
    expect(r.labor).toEqual([
      { label: "Oficial", horas: 80, costo: 400_000 },
      { label: "Ayudante", horas: 80, costo: 240_000 },
    ]);
    expect(r.equipment).toEqual([{ label: "Mezcladora", horas: 10, costo: 160_000 }]);
    expect(r.subcontracts).toEqual([{ label: "Terminación fina", monto: 600_000 }]);
    expect(r.total_labor_cost).toBe(640_000);
  });
});

describe("flujo de caja: salidas del plan semanal", () => {
  it("fecha cada salida con su plazo y omite lo que es cero", async () => {
    const { planSemanalToFlujoItems } = await import("../lib/flujo-caja");
    const items = planSemanalToFlujoItems({
      planId: "pl1", projectId: "p1", projectName: "Santa Elena", status: "DRAFT",
      startDate: "2026-10-05", endDate: "2026-10-11",
      faltanteMateriales: 2_000_000, costoManoObra: 640_000, costoEquipos: 0, costoSubcontratos: 600_000,
    });
    expect(items.map((i) => [i.tipo, i.fecha, i.monto])).toEqual([
      ["salida_proyectada_material", "2026-10-12", -2_000_000],
      ["salida_plan_mano_de_obra", "2026-10-11", -640_000],
      ["salida_plan_subcontrato", "2026-11-10", -600_000],
    ]);
    expect(items[0].descripcion).toContain("borrador");
    expect(items.every((i) => i.moneda === "PYG" && i.project_id === "p1")).toBe(true);
  });
});

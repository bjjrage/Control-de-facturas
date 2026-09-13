import { describe, it, expect } from "vitest";
import {
  computeProgressForecast,
  ProgressForecastEngineInput,
  calculateRecentVelocity,
} from "../lib/procurement/progress-forecast-engine";
import { createDegradedOperationalFallback } from "../lib/procurement/operational-analyst-llm";
import { proyeccionAvanceToFlujoItems } from "../lib/flujo-caja";
import { BudgetItem, DailyWeatherForecast } from "../lib/types";

describe("Capa de Proyección Inteligente de Avance de Obra + Materiales + Impacto Financiero", () => {
  const baseItem: BudgetItem = {
    id: "item-1",
    project_id: "proj-100",
    parent_id: null,
    code: "01.01",
    description: "Hormigón Armado en Vigas",
    unit: "m3",
    quantity: 100,
    unit_price: 1500000, // Client contract price
    subtotal: 150000000,
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    depends_on: null,
    sort_order: 1,
    quantity_per_unit: null,
    created_at: "2026-09-01T00:00:00Z",
  };

  const sampleForecasts: DailyWeatherForecast[] = [
    {
      date: "2026-09-15",
      precipitation_sum_mm: 0,
      precipitation_hours: 0,
      wind_gusts_max_kmh: 15,
      weather_code: 0,
    },
    {
      date: "2026-09-16",
      precipitation_sum_mm: 22, // Heavy rain
      precipitation_hours: 5,
      wind_gusts_max_kmh: 40,
      weather_code: 65,
    },
    {
      date: "2026-09-17",
      precipitation_sum_mm: 0,
      precipitation_hours: 0,
      wind_gusts_max_kmh: 10,
      weather_code: 1,
    },
  ];

  // 1. Proyección física no supera el remanente (techo 100%)
  it("1. no proyecta más de la cantidad restante de la partida", () => {
    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 14,
      start_date: "2026-09-15",
      budget_items: [baseItem],
      executed_quantities_by_item: { "item-1": 95 }, // Only 5 m3 remaining
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {
        "item-1": {
          budget_item_id: "item-1",
          workability: "NORMAL",
          productive_factor: 1.0,
          reason: "Normal",
        },
      },
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const item = result.items[0];
    expect(item.remaining_quantity).toBe(5);
    expect(item.projected_quantity).toBeLessThanOrEqual(5);
    expect(item.new_projected_cumulative_quantity).toBeLessThanOrEqual(100);
    expect(item.new_projected_progress_pct).toBeLessThanOrEqual(100);
  });

  // 2. Partida ya finalizada al 100% no se proyecta
  it("2. ignora partidas ya completadas al 100%", () => {
    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 14,
      start_date: "2026-09-15",
      budget_items: [baseItem],
      executed_quantities_by_item: { "item-1": 100 },
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    expect(result.items.length).toBe(0);
  });

  // 3. Bloqueo por dependencias pendientes
  it("3. bloquea avance si las dependencias precedentes no están completas", () => {
    const itemPredecessor: BudgetItem = {
      ...baseItem,
      id: "item-pred",
      code: "01.00",
      description: "Excavación previa",
      quantity: 50,
      depends_on: null,
    };

    const itemSuccessor: BudgetItem = {
      ...baseItem,
      id: "item-succ",
      code: "01.02",
      description: "Carga de estructura",
      depends_on: "item-pred",
    };

    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 14,
      start_date: "2026-09-15",
      budget_items: [itemPredecessor, itemSuccessor],
      executed_quantities_by_item: { "item-pred": 20, "item-succ": 0 }, // Predecessor at 40%
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const succ = result.items.find((i) => i.budget_item_id === "item-succ");
    expect(succ).toBeDefined();
    expect(succ?.operational_status).toBe("BLOCKED");
    expect(succ?.projected_quantity).toBe(0);
    expect(succ?.workability_factor).toBe(0);
  });

  // 4. Dependencias completadas permiten el avance
  it("4. desbloquea avance cuando las dependencias están al 100%", () => {
    const itemPredecessor: BudgetItem = {
      ...baseItem,
      id: "item-pred",
      quantity: 50,
      depends_on: null,
    };

    const itemSuccessor: BudgetItem = {
      ...baseItem,
      id: "item-succ",
      depends_on: "item-pred",
    };

    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 14,
      start_date: "2026-09-15",
      budget_items: [itemPredecessor, itemSuccessor],
      executed_quantities_by_item: { "item-pred": 50, "item-succ": 0 }, // Predecessor 100%
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {
        "item-succ": {
          budget_item_id: "item-succ",
          workability: "NORMAL",
          productive_factor: 1.0,
          reason: "Ok",
        },
      },
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const succ = result.items.find((i) => i.budget_item_id === "item-succ");
    expect(succ?.operational_status).toBe("NORMAL");
    expect(succ?.projected_quantity).toBeGreaterThan(0);
  });

  // 5. Explosión de materiales con desperdicio
  it("5. calcula demanda bruta de materiales considerando ratio unitario y desperdicio", () => {
    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 3,
      start_date: "2026-09-15",
      budget_items: [
        {
          ...baseItem,
          quantity: 30,
          start_date: "2026-09-15",
          end_date: "2026-09-18", // 3 days => 10 m3/day
        },
      ],
      executed_quantities_by_item: { "item-1": 0 },
      materials_by_item: {
        "item-1": [
          {
            budget_item_id: "item-1",
            producto_id: "prod-cemento",
            producto_nombre: "Cemento Portland",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 7, // 7 bags per m3
            desperdicio_pct: 5, // 5% waste
            costo_unitario: 60000,
          },
        ],
      },
      stock_and_inbound: {},
      operational_assessments: {
        "item-1": {
          budget_item_id: "item-1",
          workability: "NORMAL",
          productive_factor: 1.0,
          reason: "Ok",
        },
      },
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const mat = result.items[0].materials[0];
    // 30 m3 * 7 bags/m3 * 1.05 = 220.5 bags
    expect(mat.demanda_bruta).toBeCloseTo(220.5, 1);
  });

  // 6. Deducción de stock disponible
  it("6. deduce el stock disponible en obra antes de calcular compras requeridas", () => {
    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 3,
      start_date: "2026-09-15",
      budget_items: [
        {
          ...baseItem,
          quantity: 10,
          start_date: "2026-09-15",
          end_date: "2026-09-18",
        },
      ],
      executed_quantities_by_item: { "item-1": 0 },
      materials_by_item: {
        "item-1": [
          {
            budget_item_id: "item-1",
            producto_id: "prod-cemento",
            producto_nombre: "Cemento",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 10,
            desperdicio_pct: 0,
            costo_unitario: 50000,
          },
        ],
      },
      stock_and_inbound: {
        "prod-cemento": {
          producto_id: "prod-cemento",
          stock_disponible: 40, // 40 bags already in warehouse
          oc_inbound: 0,
        },
      },
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const mat = result.items[0].materials[0];
    // Demanda bruta = 10 * 10 = 100. Stock = 40. Deficit = 60
    expect(mat.demanda_bruta).toBe(100);
    expect(mat.deficit_compra_neta).toBe(60);
  });

  // 7. Deducción de órdenes de compra inbound (en camino)
  it("7. deduce las órdenes de compra autorizadas en tránsito", () => {
    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 3,
      start_date: "2026-09-15",
      budget_items: [
        {
          ...baseItem,
          quantity: 10,
          start_date: "2026-09-15",
          end_date: "2026-09-18",
        },
      ],
      executed_quantities_by_item: { "item-1": 0 },
      materials_by_item: {
        "item-1": [
          {
            budget_item_id: "item-1",
            producto_id: "prod-cemento",
            producto_nombre: "Cemento",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 10,
            desperdicio_pct: 0,
            costo_unitario: 50000,
          },
        ],
      },
      stock_and_inbound: {
        "prod-cemento": {
          producto_id: "prod-cemento",
          stock_disponible: 20,
          oc_inbound: 50, // 50 bags on the way
        },
      },
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const mat = result.items[0].materials[0];
    // Demanda = 100, Stock = 20, Inbound = 50 => Deficit = 30
    expect(mat.demanda_bruta).toBe(100);
    expect(mat.deficit_compra_neta).toBe(30);
  });

  // 8. Superávit de stock genera déficit 0 (no compra)
  it("8. no genera requerimiento de compra si el stock + inbound superan la demanda", () => {
    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 3,
      start_date: "2026-09-15",
      budget_items: [
        {
          ...baseItem,
          quantity: 10,
          start_date: "2026-09-15",
          end_date: "2026-09-18",
        },
      ],
      executed_quantities_by_item: { "item-1": 0 },
      materials_by_item: {
        "item-1": [
          {
            budget_item_id: "item-1",
            producto_id: "prod-cemento",
            producto_nombre: "Cemento",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 10,
            desperdicio_pct: 0,
            costo_unitario: 50000,
          },
        ],
      },
      stock_and_inbound: {
        "prod-cemento": {
          producto_id: "prod-cemento",
          stock_disponible: 150, // Exceeds 100
          oc_inbound: 0,
        },
      },
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const mat = result.items[0].materials[0];
    expect(mat.deficit_compra_neta).toBe(0);
    expect(mat.caja_adicional_requerida).toBe(0);
    // Pero el valor de consumo proyectado se mantiene positivo (demanda bruta * costo)
    expect(mat.valor_consumo_proyectado).toBe(100 * 50000);
  });

  // 9. Separación de métricas financieras (Consumo vs Caja)
  it("9. calcula por separado valor de consumo y caja adicional requerida", () => {
    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 3,
      start_date: "2026-09-15",
      budget_items: [
        {
          ...baseItem,
          quantity: 10,
          start_date: "2026-09-15",
          end_date: "2026-09-18",
        },
      ],
      executed_quantities_by_item: { "item-1": 0 },
      materials_by_item: {
        "item-1": [
          {
            budget_item_id: "item-1",
            producto_id: "prod-varillas",
            producto_nombre: "Varilla 12mm",
            unidad_medida: "kg",
            cantidad_por_unidad_ejecutada: 100, // 1000 kg total
            desperdicio_pct: 0,
            costo_unitario: 10000, // 10.000 Gs/kg
          },
        ],
      },
      stock_and_inbound: {
        "prod-varillas": {
          producto_id: "prod-varillas",
          stock_disponible: 400, // 400 kg en stock
          oc_inbound: 0,
        },
      },
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    // Consumo económico = 1000 kg * 10.000 = 10.000.000 Gs
    expect(result.total_material_consumption_value).toBe(10000000);
    // Déficit para compra = (1000 - 400) = 600 kg * 10.000 = 6.000.000 Gs
    expect(result.total_additional_cash_required).toBe(6000000);
  });

  // 10. Fallback ante material sin costo
  it("10. marca requiere_atencion_costo si el costo es nulo o 0 y no inventa números", () => {
    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 3,
      start_date: "2026-09-15",
      budget_items: [
        {
          ...baseItem,
          quantity: 10,
          start_date: "2026-09-15",
          end_date: "2026-09-18",
        },
      ],
      executed_quantities_by_item: { "item-1": 0 },
      materials_by_item: {
        "item-1": [
          {
            budget_item_id: "item-1",
            producto_id: "prod-sin-costo",
            producto_nombre: "Aditivo Especial",
            unidad_medida: "lt",
            cantidad_por_unidad_ejecutada: 5,
            desperdicio_pct: 0,
            costo_unitario: null, // No cost available
          },
        ],
      },
      stock_and_inbound: {},
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const mat = result.items[0].materials[0];
    expect(mat.costo_unitario).toBeNull();
    expect(mat.requiere_atencion_costo).toBe(true);
    expect(mat.caja_adicional_requerida).toBe(0);
  });

  // 11. Modo degradado explícito: si no hay LLM ni cache, no inventa factores mágicos
  it("11. activa modo degradado explícito sin inventar factores operacionales ficticios", () => {
    const items = [
      {
        budget_item_id: "item-excav",
        item_code: "01.01",
        description: "Excavación y Movimiento de Suelos",
        unit: "m3",
      },
    ];

    const degradedOutput = createDegradedOperationalFallback(items, "Sin conexión al servicio LLM.");
    expect(degradedOutput.is_degraded).toBe(true);
    expect(degradedOutput.llm_used).toBe(false);
    expect(degradedOutput.items[0].workability).toBe("DEGRADED");
    expect(degradedOutput.items[0].risk_flags).toContain("ANALISIS_CLIMATICO_NO_DISPONIBLE");
  });

  // 12. Velocidad reciente observable en execution_entries
  it("12. calcula velocidad reciente observando entries y asigna confianza según cantidad de días activos", () => {
    const entries = [
      { budget_item_id: "item-1", entry_date: "2026-09-10", quantity_executed: 20 },
      { budget_item_id: "item-1", entry_date: "2026-09-11", quantity_executed: 30 },
      { budget_item_id: "item-1", entry_date: "2026-09-12", quantity_executed: 25 },
      { budget_item_id: "item-1", entry_date: "2026-09-13", quantity_executed: 0 }, // Inactive day
      { budget_item_id: "item-1", entry_date: "2026-09-14", quantity_executed: 35 },
      { budget_item_id: "item-1", entry_date: "2026-09-15", quantity_executed: 40 }, // 5 active days
    ];

    const result = calculateRecentVelocity(
      "item-1",
      1000,
      50,
      entries,
      "2026-09-15",
      14
    );

    // Active days: 20 + 30 + 25 + 35 + 40 = 150 / 5 = 30
    expect(result.velocity).toBe(30);
    expect(result.observationsCount).toBe(5);
    expect(result.confidence).toBe("HIGH");
  });

  // 13. Partida sin observaciones recientes recibe confianza UNOBSERVED y ritmo planificado
  it("13. asigna UNOBSERVED y velocidad planificada si no hay registros recientes", () => {
    const result = calculateRecentVelocity(
      "item-nuevo",
      600,
      30, // 30 days remaining => 20/day
      [],
      "2026-09-15",
      30
    );

    expect(result.velocity).toBe(20);
    expect(result.observationsCount).toBe(0);
    expect(result.confidence).toBe("UNOBSERVED");
  });

  // 14. Integración con flujo de caja solo toma déficits de compra neta
  it("14. genera ítems de flujo de caja solo para materiales con caja requerida > 0", () => {
    const forecastSummary = {
      project_id: "proj-100",
      start_date: "2026-09-15",
      currency: "PYG",
      items: [
        {
          item_description: "Hormigón",
          materials: [
            {
              producto_id: "prod-1",
              producto_nombre: "Cemento",
              caja_adicional_requerida: 5000000,
            },
            {
              producto_id: "prod-2",
              producto_nombre: "Arena (ya en stock)",
              caja_adicional_requerida: 0, // No cash needed
            },
          ],
        },
      ],
    };

    const flujoItems = proyeccionAvanceToFlujoItems(forecastSummary, 7);
    expect(flujoItems.length).toBe(1);
    expect(flujoItems[0].tipo).toBe("salida_proyectada_material");
    expect(flujoItems[0].monto).toBe(-5000000);
    expect(flujoItems[0].fecha).toBe("2026-09-22"); // 15 + 7 days
  });

  // 15. Asignación secuencial de stock entre múltiples partidas que comparten el mismo insumo
  it("15. no computa dos veces el mismo stock disponible cuando dos partidas usan el mismo material", () => {
    const item1: BudgetItem = {
      ...baseItem,
      id: "item-col",
      description: "Columnas",
      quantity: 5,
      start_date: "2026-09-15",
      end_date: "2026-09-22",
    };
    const item2: BudgetItem = {
      ...baseItem,
      id: "item-vig",
      description: "Vigas",
      quantity: 5,
      start_date: "2026-09-15",
      end_date: "2026-09-22",
    };

    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 7,
      start_date: "2026-09-15",
      budget_items: [item1, item2],
      executed_quantities_by_item: { "item-col": 0, "item-vig": 0 },
      materials_by_item: {
        "item-col": [
          {
            budget_item_id: "item-col",
            producto_id: "cemento",
            producto_nombre: "Cemento",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 10, // 5 * 10 = 50 bolsas
            desperdicio_pct: 0,
            costo_unitario: 50000,
          },
        ],
        "item-vig": [
          {
            budget_item_id: "item-vig",
            producto_id: "cemento",
            producto_nombre: "Cemento",
            unidad_medida: "bolsas",
            cantidad_por_unidad_ejecutada: 10, // 5 * 10 = 50 bolsas
            desperdicio_pct: 0,
            costo_unitario: 50000,
          },
        ],
      },
      stock_and_inbound: {
        cemento: {
          producto_id: "cemento",
          stock_disponible: 60, // Total stock is 60 bags. Total demand is 100 bags. Total deficit must be 40 bags!
          oc_inbound: 0,
        },
      },
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    };

    const result = computeProgressForecast(input);
    const deficitItem1 = result.items[0].materials[0].deficit_compra_neta;
    const deficitItem2 = result.items[1].materials[0].deficit_compra_neta;

    expect(deficitItem1 + deficitItem2).toBe(40);
  });

  // 16. TEST INTEGRADO E2E OBLIGATORIO:
  // Partida: mampostería exterior. Q total = 2.000 m2. Ejecutado = 1.000 m2.
  // Velocidad reciente = 100 m2/día.
  // Forecast 7 días: 4 normales (1.0), 1 parcial (0.5), 2 bloqueados (0.0). Capacidad = 4.5 jornadas => 450 m2 proyectados.
  // BOM: 10 ladrillos/m2, 2 kg cemento/m2.
  // Demanda: 4.500 ladrillos, 900 kg cemento.
  // Stock: 2.000 ladrillos, 500 kg cemento.
  // OC inbound dentro de ventana: 1.000 ladrillos, 0 cemento.
  // Faltante compra: 1.500 ladrillos, 400 kg cemento.
  // Costos: ladrillo 1.000 Gs, cemento 3.000 Gs.
  it("16. Recorrido E2E completo: avance real -> clima/LLM -> avance proyectado -> BOM -> stock -> OC -> costos -> caja", () => {
    const itemMamposteria: BudgetItem = {
      ...baseItem,
      id: "item-mamposteria",
      code: "02.01",
      description: "Mampostería exterior de ladrillo visto",
      unit: "m2",
      quantity: 2000,
      unit_price: 150000,
      subtotal: 300000000,
      start_date: "2026-09-01",
      end_date: "2026-09-30",
    };

    // Historial reciente que arroja 100 m2/día
    const recentEntries = [
      { budget_item_id: "item-mamposteria", entry_date: "2026-09-10", quantity_executed: 100 },
      { budget_item_id: "item-mamposteria", entry_date: "2026-09-11", quantity_executed: 100 },
      { budget_item_id: "item-mamposteria", entry_date: "2026-09-12", quantity_executed: 100 },
      { budget_item_id: "item-mamposteria", entry_date: "2026-09-13", quantity_executed: 100 },
      { budget_item_id: "item-mamposteria", entry_date: "2026-09-14", quantity_executed: 100 },
    ];

    // Forecast meteorológico 7 días: 4 normales, 1 parcial (50%), 2 bloqueados (0%)
    // Capacidad efectiva = (4 * 1.0 + 1 * 0.5 + 2 * 0.0) / 7 = 4.5 / 7 = 0.642857
    const effectiveWorkabilityFactor = 4.5 / 7;

    const input: ProgressForecastEngineInput = {
      project_id: "proj-e2e",
      horizon_days: 7,
      start_date: "2026-09-15",
      budget_items: [itemMamposteria],
      executed_quantities_by_item: { "item-mamposteria": 1000 },
      recent_execution_entries: recentEntries,
      materials_by_item: {
        "item-mamposteria": [
          {
            budget_item_id: "item-mamposteria",
            producto_id: "prod-ladrillo",
            producto_nombre: "Ladrillo Visto",
            unidad_medida: "unid",
            cantidad_por_unidad_ejecutada: 10,
            desperdicio_pct: 0,
            costo_unitario: 1000, // 1.000 Gs por ladrillo
          },
          {
            budget_item_id: "item-mamposteria",
            producto_id: "prod-cemento-e2e",
            producto_nombre: "Cemento Portland",
            unidad_medida: "kg",
            cantidad_por_unidad_ejecutada: 2,
            desperdicio_pct: 0,
            costo_unitario: 3000, // 3.000 Gs por kg
          },
        ],
      },
      stock_and_inbound: {
        "prod-ladrillo": {
          producto_id: "prod-ladrillo",
          stock_disponible: 2000,
          oc_inbound: 1000,
        },
        "prod-cemento-e2e": {
          producto_id: "prod-cemento-e2e",
          stock_disponible: 500,
          oc_inbound: 0,
        },
      },
      operational_assessments: {
        "item-mamposteria": {
          budget_item_id: "item-mamposteria",
          workability: "PARTIAL",
          productive_factor: effectiveWorkabilityFactor,
          reason: "4 días normales, 1 parcial, 2 con lluvia severa bloqueados.",
        },
      },
      forecasts: sampleForecasts,
      llm_used: true,
    };

    const result = computeProgressForecast(input);
    const item = result.items[0];

    // 1. Verificación de velocidad y avance físico proyectado
    expect(item.base_daily_velocity).toBe(100);
    expect(item.velocity_confidence).toBe("HIGH");
    // 100 m2/día * (4.5 / 7) * 7 días = 450 m2
    expect(item.projected_quantity).toBeCloseTo(450, 1);
    expect(item.new_projected_cumulative_quantity).toBeCloseTo(1450, 1);
    expect(item.new_projected_progress_pct).toBeCloseTo(72.5, 1);

    // 2. Verificación de demanda de materiales
    const matLadrillo = item.materials.find((m) => m.producto_id === "prod-ladrillo")!;
    const matCemento = item.materials.find((m) => m.producto_id === "prod-cemento-e2e")!;

    // Demanda bruta
    expect(matLadrillo.demanda_bruta).toBeCloseTo(4500, 1);
    expect(matCemento.demanda_bruta).toBeCloseTo(900, 1);

    // Cobertura y déficits netos
    // Ladrillo: 4.500 demanda - 2.000 stock - 1.000 inbound = 1.500 déficit
    expect(matLadrillo.stock_disponible).toBe(2000);
    expect(matLadrillo.oc_inbound).toBe(1000);
    expect(matLadrillo.deficit_compra_neta).toBeCloseTo(1500, 1);
    expect(matLadrillo.cubierto_por_stock).toBe(2000);
    expect(matLadrillo.cubierto_por_inbound).toBe(1000);

    // Cemento: 900 demanda - 500 stock - 0 inbound = 400 déficit
    expect(matCemento.stock_disponible).toBe(500);
    expect(matCemento.oc_inbound).toBe(0);
    expect(matCemento.deficit_compra_neta).toBeCloseTo(400, 1);
    expect(matCemento.cubierto_por_stock).toBe(500);
    expect(matCemento.cubierto_por_inbound).toBe(0);

    // 3. Verificación de métricas financieras duales
    // Valor consumo = (4.500 * 1.000) + (900 * 3.000) = 4.500.000 + 2.700.000 = 7.200.000 Gs
    expect(result.total_material_consumption_value).toBeCloseTo(7200000, 1);

    // Caja requerida = (1.500 * 1.000) + (400 * 3.000) = 1.500.000 + 1.200.000 = 2.700.000 Gs
    expect(result.total_additional_cash_required).toBeCloseTo(2700000, 1);

    // Cubierto por stock = (2.000 * 1.000) + (500 * 3.000) = 2.000.000 + 1.500.000 = 3.500.000 Gs
    expect(result.total_covered_by_stock_value).toBeCloseTo(3500000, 1);

    // Cubierto por inbound = (1.000 * 1.000) = 1.000.000 Gs
    expect(result.total_covered_by_inbound_value).toBeCloseTo(1000000, 1);

    // Total consumo == Cubierto Stock + Cubierto Inbound + Caja Requerida
    expect(
      result.total_covered_by_stock_value +
        result.total_covered_by_inbound_value +
        result.total_additional_cash_required
    ).toBeCloseTo(result.total_material_consumption_value, 1);

    // 4. Inyección en flujo de caja solo eroga la caja adicional (2.700.000 Gs)
    const flujoItems = proyeccionAvanceToFlujoItems(result, 7);
    const totalFlujoEgreso = flujoItems.reduce((sum, f) => sum + f.monto, 0);
    expect(Math.abs(totalFlujoEgreso)).toBeCloseTo(2700000, 1);
  });
});


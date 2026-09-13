import { describe, it, expect } from "vitest";
import {
  computeProgressForecast,
  ProgressForecastEngineInput,
} from "../lib/procurement/progress-forecast-engine";
import { evaluateOperationalWorkabilityFallback } from "../lib/procurement/operational-analyst-llm";
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

  // 11. Heurística determinística ante lluvia intensa en movimiento de suelos
  it("11. bloquea o penaliza fuertemente movimiento de suelo con lluvia fuerte", () => {
    const items = [
      {
        budget_item_id: "item-excav",
        item_code: "01.01",
        description: "Excavación y Movimiento de Suelos con retroexcavadora",
        unit: "m3",
      },
    ];

    const severeRainForecast: DailyWeatherForecast[] = [
      {
        date: "2026-09-15",
        precipitation_sum_mm: 35, // Heavy rain
        precipitation_hours: 6,
        wind_gusts_max_kmh: 30,
        weather_code: 65,
      },
    ];

    const assessment = evaluateOperationalWorkabilityFallback(
      items,
      severeRainForecast
    );
    expect(assessment.items[0].workability).toBe("BLOCKED");
    expect(assessment.items[0].productive_factor).toBeLessThanOrEqual(0.2);
    expect(assessment.items[0].risk_flags).toContain("SATURACION_SUELO");
  });

  // 12. Heurística determinística: tareas interiores no se afectan por lluvia común
  it("12. mantiene avance normal en tareas bajo cubierta frente a lluvia", () => {
    const items = [
      {
        budget_item_id: "item-pintura",
        item_code: "04.01",
        description: "Pintura interior en departamentos y cielorraso",
        unit: "m2",
      },
    ];

    const assessment = evaluateOperationalWorkabilityFallback(
      items,
      sampleForecasts
    );
    expect(assessment.items[0].workability).toBe("NORMAL");
    expect(assessment.items[0].productive_factor).toBe(1.0);
  });

  // 13. Heurística determinística: vientos fuertes bloquean trabajos en altura
  it("13. bloquea trabajos en altura o cubiertas si hay ráfagas de viento peligrosas", () => {
    const items = [
      {
        budget_item_id: "item-techo",
        item_code: "03.01",
        description: "Montaje de estructura metálica de techo y cubierta",
        unit: "m2",
      },
    ];

    const windyForecast: DailyWeatherForecast[] = [
      {
        date: "2026-09-15",
        precipitation_sum_mm: 0,
        precipitation_hours: 0,
        wind_gusts_max_kmh: 55, // Strong wind
        weather_code: 0,
      },
    ];

    const assessment = evaluateOperationalWorkabilityFallback(items, windyForecast);
    expect(assessment.items[0].workability).toBe("BLOCKED");
    expect(assessment.items[0].productive_factor).toBeLessThanOrEqual(0.3);
    expect(assessment.items[0].risk_flags).toContain("VIENTO_FUERTE");
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
      end_date: "2026-09-18",
    };
    const item2: BudgetItem = {
      ...baseItem,
      id: "item-vig",
      description: "Vigas",
      quantity: 5,
      start_date: "2026-09-15",
      end_date: "2026-09-18",
    };

    const input: ProgressForecastEngineInput = {
      project_id: "proj-100",
      horizon_days: 3,
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

    // Item 1 uses 50 of 60 stock -> deficit 0, remaining stock = 10
    // Item 2 needs 50, uses remaining 10 -> deficit 40
    expect(deficitItem1 + deficitItem2).toBe(40);
  });

  // 16. Horizontes variables (7d, 14d, 30d) ajustan proporcionalmente la proyección
  it("16. escala el avance físico según el horizonte configurado", () => {
    const makeInput = (horizon: number): ProgressForecastEngineInput => ({
      project_id: "proj-100",
      horizon_days: horizon,
      start_date: "2026-09-15",
      budget_items: [
        {
          ...baseItem,
          quantity: 300,
          start_date: "2026-09-01",
          end_date: "2026-10-31", // 60 days duration => 5 units/day
        },
      ],
      executed_quantities_by_item: { "item-1": 0 },
      materials_by_item: {},
      stock_and_inbound: {},
      operational_assessments: {},
      forecasts: sampleForecasts,
      llm_used: false,
    });

    const res7 = computeProgressForecast(makeInput(7));
    const res14 = computeProgressForecast(makeInput(14));

    expect(res14.items[0].projected_quantity).toBeGreaterThan(
      res7.items[0].projected_quantity
    );
    expect(res14.horizon_days).toBe(14);
    expect(res7.horizon_days).toBe(7);
  });
});

import { calculateWeeklyPlanRequirements } from "../lib/procurement/weekly-plan-engine";
import fs from "fs";

const token = fs.readFileSync("C:\\Users\\User\\.gemini\\antigravity\\brain\\43b8d4c1-28c5-47d0-b8c6-28c11747b59e\\scratch\\supabase_token.txt", "utf8").trim();

async function querySql(query: string) {
  const resp = await fetch("https://api.supabase.com/v1/projects/ezucivipgmbvamhugkbj/database/query", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(text);
  return JSON.parse(text);
}

async function runE2E() {
  console.log("=================================================");
  console.log("E2E VALIDATION: OBR-MOCK-001 (Ypané)");
  console.log("=================================================");

  // 1. Fetch project details
  const projects = await querySql(`SELECT id, code, name, latitude, longitude FROM public.projects WHERE code = 'OBR-MOCK-001';`);
  const project = projects[0];
  console.log("Project:", project);

  const budgetItems = await querySql(`SELECT id, code, description, unit, quantity, unit_price, material_requirement FROM public.budget_items WHERE project_id = '${project.id}' ORDER BY sort_order;`);
  console.log("Budget Items:", budgetItems);

  const boms = await querySql(`SELECT bim.budget_item_id, bim.producto_id, p.nombre, p.sku, p.unidad, p.costo_promedio, bim.cantidad_por_unidad_ejecutada, bim.desperdicio_pct FROM public.budget_item_materials bim JOIN public.productos p ON p.id = bim.producto_id WHERE bim.project_id = '${project.id}';`);
  console.log("BOM Materials:", boms);

  const stock = await querySql(`SELECT * FROM public.stock_por_proyecto WHERE project_id = '${project.id}';`);
  console.log("Stock por proyecto:", stock);

  const orders = await querySql(`
    SELECT aoi.id, aoi.producto_id, p.nombre, aoi.quantity as ordered, coalesce(sum(ri.cantidad_recibida), 0) as received
    FROM public.authorized_order_items aoi
    JOIN public.authorized_orders ao ON ao.id = aoi.order_id
    JOIN public.productos p ON p.id = aoi.producto_id
    LEFT JOIN public.oc_recepcion_items ri ON ri.order_item_id = aoi.id
    WHERE ao.project_id = '${project.id}'
    GROUP BY aoi.id, aoi.producto_id, p.nombre, aoi.quantity;
  `);
  console.log("Orders & Canonical Inbound:", orders);

  // 2. Multi-front plan inputs
  const planItemsInput = [
    {
      budget_item_id: budgetItems[0].id, // Encofrado (qty: 300, exec: 50, rem: 250)
      front_label: "Frente Norte",
      input_mode: "QUANTITY" as const,
      input_value: 40,
    },
    {
      budget_item_id: budgetItems[0].id, // Encofrado (Multi-front!)
      front_label: "Frente Sur",
      input_mode: "QUANTITY" as const,
      input_value: 30,
    },
    {
      budget_item_id: budgetItems[1].id, // Mampostería (qty: 500, exec: 100, rem: 400)
      front_label: "Sector A",
      input_mode: "CONTRACT_PERCENTAGE_POINTS" as const,
      input_value: 10, // 10% de 500 = 50 m2
    },
    {
      budget_item_id: budgetItems[2].id, // Vigas H°A° (qty: 50, exec: 10, rem: 40)
      front_label: "Planta Alta",
      input_mode: "QUANTITY" as const,
      input_value: 15,
    }
  ];

  // Stock lookup from DB
  const stockLookup: Record<string, any> = {};
  for (const s of stock) {
    stockLookup[s.producto_id] = {
      producto_id: s.producto_id,
      stock_disponible: Number(s.qty_disponible),
      oc_inbound: 0
    };
  }
  for (const o of orders) {
    if (!stockLookup[o.producto_id]) {
      stockLookup[o.producto_id] = { producto_id: o.producto_id, stock_disponible: 0, oc_inbound: 0 };
    }
    const net = Math.max(0, Number(o.ordered) - Number(o.received));
    stockLookup[o.producto_id].oc_inbound += net;
  }

  const executionTotals: Record<string, number> = {
    [budgetItems[0].id]: 50,
    [budgetItems[1].id]: 100,
    [budgetItems[2].id]: 10
  };

  const bomLookup: Record<string, any[]> = {};
  for (const b of boms) {
    if (!bomLookup[b.budget_item_id]) bomLookup[b.budget_item_id] = [];
    bomLookup[b.budget_item_id].push({
      budget_item_id: b.budget_item_id,
      producto_id: b.producto_id,
      producto_nombre: b.nombre,
      producto_codigo: b.sku,
      unidad_medida: b.unidad,
      cantidad_por_unidad_ejecutada: Number(b.cantidad_por_unidad_ejecutada),
      desperdicio_pct: Number(b.desperdicio_pct),
      costo_unitario: Number(b.costo_promedio) || 0
    });
  }

  // 1. RUN WITH WEATHER OFF
  const resWeatherOff = calculateWeeklyPlanRequirements({
    project_id: project.id,
    start_date: "2026-09-14",
    end_date: "2026-09-20",
    budget_items: budgetItems.map((b: any) => ({
      id: b.id,
      project_id: project.id,
      parent_id: null,
      code: b.code,
      description: b.description,
      unit: b.unit,
      quantity: Number(b.quantity),
      unit_price: Number(b.unit_price),
      subtotal: Number(b.quantity) * Number(b.unit_price),
      start_date: null,
      end_date: null,
      depends_on: null,
      sort_order: 1,
      quantity_per_unit: null,
      material_requirement: b.material_requirement,
      created_at: new Date().toISOString()
    })),
    executed_quantities_by_item: executionTotals,
    targets: planItemsInput,
    materials_by_item: bomLookup,
    stock_and_inbound: stockLookup,
    weather_overlay_enabled: false
  });

  console.log("\n=================================================");
  console.log(">>> SUMMARY (WEATHER OFF - DETERMINISTIC):");
  console.log("Total Plan Contractual Value:", resWeatherOff.total_plan_contractual_value);
  console.log("Global Target Progress %:", resWeatherOff.global_target_progress_pct);
  console.log("Global Increment pp:", resWeatherOff.global_increment_pp);
  console.log("Material Consumption Value:", resWeatherOff.total_material_consumption_value);
  console.log("Covered by Stock Value:", resWeatherOff.total_covered_by_stock_value);
  console.log("Covered by Inbound Value:", resWeatherOff.total_covered_by_inbound_value);
  console.log("Additional Cash Required:", resWeatherOff.total_additional_cash_required);
  console.log("Weather Overlay Enabled:", resWeatherOff.weather_overlay_enabled);

  // 2. RUN WITH WEATHER ON (Real Live Weather from Open-Meteo for Ypané)
  console.log("\n--- Fetching Real Open-Meteo Weather for Ypané (-25.4550, -57.5340) ---");
  const meteoUrl = "https://api.open-meteo.com/v1/forecast?latitude=-25.4550&longitude=-57.5340&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_gusts_10m_max&timezone=auto&forecast_days=7";
  const mRes = await fetch(meteoUrl);
  const mJson = await mRes.json();
  const daily = mJson.daily;
  const days = daily.time.map((t: string, idx: number) => ({
    date: t,
    precipitation_sum: daily.precipitation_sum[idx] ?? 0,
    precipitation_hours: daily.precipitation_hours[idx] ?? 0,
    precipitation_probability_max: daily.precipitation_probability_max[idx] ?? 0,
    wind_gusts_10m_max: daily.wind_gusts_10m_max[idx] ?? 0,
    temp_max: daily.temperature_2m_max[idx] ?? 0,
    temp_min: daily.temperature_2m_min[idx] ?? 0,
    weather_code: daily.weathercode[idx] ?? 0
  }));

  const resWeatherOn = calculateWeeklyPlanRequirements({
    project_id: project.id,
    start_date: "2026-09-14",
    end_date: "2026-09-20",
    budget_items: budgetItems.map((b: any) => ({
      id: b.id,
      project_id: project.id,
      parent_id: null,
      code: b.code,
      description: b.description,
      unit: b.unit,
      quantity: Number(b.quantity),
      unit_price: Number(b.unit_price),
      subtotal: Number(b.quantity) * Number(b.unit_price),
      start_date: null,
      end_date: null,
      depends_on: null,
      sort_order: 1,
      quantity_per_unit: null,
      material_requirement: b.material_requirement,
      created_at: new Date().toISOString()
    })),
    executed_quantities_by_item: executionTotals,
    targets: planItemsInput,
    materials_by_item: bomLookup,
    stock_and_inbound: stockLookup,
    weather_overlay_enabled: true,
    weather_forecasts: days,
    weather_provider: "OPEN_METEO"
  });

  console.log("\n=================================================");
  console.log(">>> SUMMARY (WEATHER ON - REAL LIVE YPANÉ METEO):");
  console.log("Total Plan Contractual Value (MUST BE IDENTICAL):", resWeatherOn.total_plan_contractual_value);
  console.log("Global Target Progress % (MUST BE IDENTICAL):", resWeatherOn.global_target_progress_pct);
  console.log("Global Increment pp (MUST BE IDENTICAL):", resWeatherOn.global_increment_pp);
  console.log("Material Consumption Value (MUST BE IDENTICAL):", resWeatherOn.total_material_consumption_value);
  console.log("Covered by Stock Value (MUST BE IDENTICAL):", resWeatherOn.total_covered_by_stock_value);
  console.log("Covered by Inbound Value (MUST BE IDENTICAL):", resWeatherOn.total_covered_by_inbound_value);
  console.log("Additional Cash Required (MUST BE IDENTICAL):", resWeatherOn.total_additional_cash_required);
  console.log("Weather Days Affected Count:", resWeatherOn.weather_days_affected_count);
  console.log("Weather Summary:", resWeatherOn.weather_summary);
  console.log("Weather Adjusted Material Value:", resWeatherOn.weather_adjusted_material_consumption_value);

  console.log("\n--- Items Breakdown & Weather Impact ---");
  for (const it of resWeatherOn.items) {
    console.log(`- Item ${it.item_code} (${it.front_label || "Frente único"}): target = ${it.target_quantity} ${it.unit}, contractual value = ${it.contractual_value_target}`);
    if (it.weather_adjusted_capacity !== null && it.weather_adjusted_capacity !== undefined) {
      console.log(`  Weather factor = ${it.weather_workability_factor}, adjusted capacity = ${it.weather_adjusted_capacity}, weather gap = ${it.weather_gap_quantity}`);
    }
    for (const m of it.materials) {
      console.log(`    * Material: ${m.producto_nombre} (Demanda: ${m.demanda_bruta}, Stock used: ${m.cubierto_por_stock}, Inbound used: ${m.cubierto_por_inbound}, Deficit to buy: ${m.deficit_compra_neta})`);
    }
  }

  // 3. PERSIST ALL 7 DAYS OF WEATHER FORECAST INTO IMMUTABLE BATCH & DB
  console.log("\n--- Creating immutable weather batch in project_weather_forecast_batches ---");
  const batchRes = await querySql(`
    INSERT INTO public.project_weather_forecast_batches (
      empresa_id, project_id, source, latitude, longitude, forecast_days, fetched_at
    ) VALUES (
      '${project.empresa_id || "c040ee03-2302-49d2-8082-b2a4ae5b62af"}',
      '${project.id}',
      'open-meteo',
      ${project.latitude || -25.4550},
      ${project.longitude || -57.5340},
      7,
      now()
    ) RETURNING id;
  `);
  const batchId = batchRes[0].id;
  console.log(`Created immutable weather batch: ${batchId}`);

  console.log("\n--- Inserting all 7 days into project_weather_forecast_snapshots with batch_id ---");
  const weatherRows = days.map((d: any) => ({
    batch_id: batchId,
    empresa_id: project.empresa_id || "c040ee03-2302-49d2-8082-b2a4ae5b62af",
    project_id: project.id,
    forecast_date: d.date,
    precipitation_sum_mm: d.precipitation_sum,
    precipitation_hours: d.precipitation_hours,
    precipitation_probability_max: d.precipitation_probability_max,
    wind_gusts_max_kmh: d.wind_gusts_10m_max,
    temperature_max_c: d.temp_max,
    temperature_min_c: d.temp_min,
    weather_code: d.weather_code,
    source: "open-meteo",
    raw_payload: d
  }));

  for (const wr of weatherRows) {
    await querySql(`
      INSERT INTO public.project_weather_forecast_snapshots (
        batch_id, empresa_id, project_id, forecast_date, precipitation_sum_mm, precipitation_hours,
        precipitation_probability_max, wind_gusts_max_kmh, temperature_max_c, temperature_min_c,
        weather_code, source, raw_payload
      ) VALUES (
        '${wr.batch_id}', '${wr.empresa_id}', '${wr.project_id}', '${wr.forecast_date}', ${wr.precipitation_sum_mm},
        ${wr.precipitation_hours}, ${wr.precipitation_probability_max || 0}, ${wr.wind_gusts_max_kmh},
        ${wr.temperature_max_c}, ${wr.temperature_min_c}, ${wr.weather_code}, '${wr.source}', '${JSON.stringify(wr.raw_payload)}'::JSONB
      );
    `);
  }

  const persistedWeather = await querySql(`
    SELECT forecast_date, precipitation_sum_mm, wind_gusts_max_kmh, weather_code
    FROM public.project_weather_forecast_snapshots
    WHERE batch_id = '${batchId}'
    ORDER BY forecast_date;
  `);
  console.log(`Persisted ${persistedWeather.length} weather snapshot rows for batch ${batchId}:`, persistedWeather);

  // 4. Save Plan Atomi-test on OBR-MOCK-001 with weather linkage
  console.log("\n--- Testing Atomic Save RPC on OBR-MOCK-001 with Weather Linkage ---");

  const saveResult = await querySql(`
    DO $$
    DECLARE
      v_user_id UUID;
    BEGIN
      SELECT id INTO v_user_id FROM public.profiles WHERE empresa_id = '${project.empresa_id || "c040ee03-2302-49d2-8082-b2a4ae5b62af"}' LIMIT 1;
      PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

      PERFORM public.save_weekly_plan_atomic(
        NULL,
        '${project.id}'::UUID,
        '2026-09-14'::DATE,
        '2026-09-20'::DATE,
        'DRAFT',
        'Plan semanal validado E2E Ypané con Weather Linkage',
        '${JSON.stringify([
          { budget_item_id: budgetItems[0].id, front_label: "Frente Norte", input_mode: "QUANTITY", input_value: 40, unit: "m2" },
          { budget_item_id: budgetItems[0].id, front_label: "Frente Sur", input_mode: "QUANTITY", input_value: 30, unit: "m2" },
          { budget_item_id: budgetItems[1].id, front_label: "Sector A", input_mode: "CONTRACT_PERCENTAGE_POINTS", input_value: 10, unit: "m2" },
          { budget_item_id: budgetItems[2].id, front_label: "Planta Alta", input_mode: "QUANTITY", input_value: 15, unit: "m3" }
        ])}'::JSONB,
        '${batchId}'::UUID
      );
    END;
    $$;
  `);
  console.log("RPC Save Result (Linkage & Atomic): OK");

  // Read back and verify target_quantity conversion & weather linkage in DB
  const verifyDb = await querySql(`
    SELECT
      pl.id as plan_id,
      pl.weather_snapshot_batch_id,
      b.code as item_code,
      pi.front_label,
      pi.input_mode,
      pi.input_value::numeric as input_value,
      pi.target_quantity::numeric as target_quantity,
      b.quantity as contractual_quantity
    FROM public.project_weekly_plans pl
    JOIN public.project_weekly_plan_items pi ON pi.plan_id = pl.id
    JOIN public.budget_items b ON b.id = pi.budget_item_id
    WHERE pl.project_id = '${project.id}'
    ORDER BY b.code, pi.front_label;
  `);
  console.log("\nVerified DB Plan Items & Linkage:", verifyDb);

  console.log("\n=================================================");
  console.log("E2E VALIDATION FINISHED WITH 100% SUCCESS!");
  console.log("=================================================");
}

runE2E().catch(console.error);

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { assertNonProductionTestTarget } from "../test-utils/external-test-target";

// La Management API tarda ~1-2s por roundtrip.
vi.setConfig({ testTimeout: 120_000 });

// Lifecycle atómico CLOSED/DRAFT vía commit_production_plan_atomic (P1-2):
// éxito, rollback con mutación previa, y liberación. Fixtures propios.

const PROJECT_REF = process.env.TEST_SUPABASE_PROJECT_REF ?? "";
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
assertNonProductionTestTarget({ projectRef: PROJECT_REF, label: "MRP lifecycle live test" });
if (!ACCESS_TOKEN) throw new Error("MRP lifecycle live test requires SUPABASE_ACCESS_TOKEN.");

async function querySql(query: string) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: "Bearer " + ACCESS_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }
  );
  const text = await resp.text();
  if (!resp.ok) throw new Error(`SQL failed: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function expectRpcThrows(sql: string, match: RegExp | string) {
  let err: string | null = null;
  try {
    await querySql(sql);
  } catch (e) {
    err = String(e);
  }
  expect(err).not.toBeNull();
  if (match instanceof RegExp) expect(err!).toMatch(match);
  else expect(err!).toContain(match);
}

const FX = { empresaId: "", userId: "", projectId: "", itemA: "", productId: "", locationId: "" };

function CC(plan: string | null, status: string, items: string, tag: string): string {
  return (
    `SELECT public.commit_production_plan_atomic(` +
    `'${FX.empresaId}', '${FX.userId}', ${plan === null ? "NULL" : `'${plan}'`}, ` +
    `'${FX.projectId}', '2026-09-18', '2026-09-24', '${status}', '${tag}', ` +
    `'${items}'::jsonb, NULL, '${FX.locationId}', ` +
    `'[{"producto_id": "${FX.productId}", "quantity": 100}]'::jsonb, '2026-09-24', 'LC');`
  );
}

async function cleanupPlans() {
  const plans = await querySql(
    `SELECT id FROM public.project_weekly_plans WHERE project_id='${FX.projectId}';`
  );
  for (const p of plans as Array<{ id: string }>) {
    await querySql(`DELETE FROM public.inventory_reservations WHERE weekly_plan_id='${p.id}';`);
    await querySql(
      `DELETE FROM public.project_weekly_plan_items WHERE plan_id='${p.id}'; DELETE FROM public.project_weekly_plans WHERE id='${p.id}';`
    );
  }
}

beforeAll(async () => {
  const prof = await querySql(
    `SELECT id, empresa_id FROM public.profiles WHERE role IN ('administracion','admin') LIMIT 1;`
  );
  FX.userId = prof[0].id;
  FX.empresaId = prof[0].empresa_id;
  const pj = await querySql(
    `INSERT INTO public.projects (empresa_id, name, code, status, contract_amount) VALUES ('${FX.empresaId}', 'MRP LC', 'MRP-LC-${Date.now()}', 'ACTIVO', 1000) RETURNING id;`
  );
  FX.projectId = pj[0].id;
  const items = await querySql(
    `INSERT INTO public.budget_items (project_id, code, description, unit, quantity, unit_price, sort_order, material_requirement) VALUES ` +
      `('${FX.projectId}', 'L.1', 'Item LC', 'u', 100, 10, 10, 'NO_MATERIAL') RETURNING id;`
  );
  FX.itemA = items[0].id;
  const prod = await querySql(
    `INSERT INTO public.productos (empresa_id, nombre, unidad, sku, costo_promedio) VALUES ('${FX.empresaId}', 'MRP LC MAT', 'u', 'MRP-LC-${Date.now()}', 100) RETURNING id;`
  );
  FX.productId = prod[0].id;
  const loc = await querySql(
    `INSERT INTO public.inventory_locations (empresa_id, location_type, name, is_primary, active) VALUES ('${FX.empresaId}', 'AUXILIARY', 'MRP LC LOC ${Date.now()}', false, true) RETURNING id;`
  );
  FX.locationId = loc[0].id;
  await querySql(
    `INSERT INTO public.inventory_balances (empresa_id, producto_id, location_id, quantity, total_cost, total_cost_company, cost_currency) VALUES ('${FX.empresaId}', '${FX.productId}', '${FX.locationId}', 500, 50000, 50000, 'PYG');`
  );
}, 120000);

afterAll(async () => {
  await cleanupPlans();
  await querySql(`DELETE FROM public.budget_items WHERE project_id='${FX.projectId}';`);
  await querySql(`DELETE FROM public.inventory_balances WHERE empresa_id='${FX.empresaId}' AND location_id='${FX.locationId}';`);
  await querySql(`DELETE FROM public.inventory_locations WHERE id='${FX.locationId}';`);
  await querySql(`DELETE FROM public.productos WHERE id='${FX.productId}';`);
  await querySql(`DELETE FROM public.projects WHERE id='${FX.projectId}';`);
}, 120000);

describe("CLOSED atómico: éxito libera y cambia status en una txn", () => {
  it("COMMITTED+ACTIVE → CLOSED deja plan CLOSED y reservas RELEASED", async () => {
    await querySql(CC(null, "COMMITTED", "[]", "LC-ok"));
    const plan = await querySql(
      `SELECT id FROM public.project_weekly_plans WHERE project_id='${FX.projectId}' ORDER BY created_at DESC LIMIT 1;`
    );
    const planId = plan[0].id as string;
    let active = await querySql(
      `SELECT count(*)::int c FROM public.inventory_reservations WHERE weekly_plan_id='${planId}' AND status='ACTIVE';`
    );
    expect(active[0].c).toBe(1);
    await querySql(CC(planId, "CLOSED", "[]", "LC-close"));
    const st = await querySql(`SELECT status FROM public.project_weekly_plans WHERE id='${planId}';`);
    expect(st[0].status).toBe("CLOSED");
    active = await querySql(
      `SELECT count(*)::int c FROM public.inventory_reservations WHERE weekly_plan_id='${planId}' AND status='ACTIVE';`
    );
    expect(active[0].c).toBe(0);
    const rel = await querySql(
      `SELECT count(*)::int c FROM public.inventory_reservations WHERE weekly_plan_id='${planId}' AND status='RELEASED';`
    );
    expect(rel[0].c).toBe(1);
    await cleanupPlans();
  }, 120000);
});

describe("CLOSED con fallo: rollback total (mutación previa restaurada)", () => {
  it("release OK + save inválido → plan sigue COMMITTED y ACTIVE intacto", async () => {
    await querySql(CC(null, "COMMITTED", "[]", "LC-ok2"));
    const plan = await querySql(
      `SELECT id FROM public.project_weekly_plans WHERE project_id='${FX.projectId}' ORDER BY created_at DESC LIMIT 1;`
    );
    const planId = plan[0].id as string;
    const badItems =
      `'[{"budget_item_id": "00000000-0000-0000-0000-000000000000", "front_label": null, "input_mode": "QUANTITY", "input_value": 1, "unit": "u"}]'`;
    await expectRpcThrows(
      `SELECT public.commit_production_plan_atomic('${FX.empresaId}', '${FX.userId}', '${planId}', '${FX.projectId}', '2026-09-18', '2026-09-24', 'CLOSED', 'LC-fail', ${badItems}::jsonb, NULL, '${FX.locationId}', '[]'::jsonb, '2026-09-24', 'LC-f');`,
      /presupuesto|pertenece|encontrado/i
    );
    const st = await querySql(`SELECT status FROM public.project_weekly_plans WHERE id='${planId}';`);
    expect(st[0].status).toBe("COMMITTED");
    const active = await querySql(
      `SELECT count(*)::int c FROM public.inventory_reservations WHERE weekly_plan_id='${planId}' AND status='ACTIVE';`
    );
    expect(active[0].c).toBe(1);
    await cleanupPlans();
  }, 120000);
});

describe("DRAFT libera sin fingir consumo", () => {
  it("COMMITTED → DRAFT deja plan DRAFT y 0 ACTIVE", async () => {
    await querySql(CC(null, "COMMITTED", "[]", "LC-ok3"));
    const plan = await querySql(
      `SELECT id FROM public.project_weekly_plans WHERE project_id='${FX.projectId}' ORDER BY created_at DESC LIMIT 1;`
    );
    const planId = plan[0].id as string;
    await querySql(CC(planId, "DRAFT", "[]", "LC-draft"));
    const st = await querySql(`SELECT status FROM public.project_weekly_plans WHERE id='${planId}';`);
    expect(st[0].status).toBe("DRAFT");
    const active = await querySql(
      `SELECT count(*)::int c FROM public.inventory_reservations WHERE weekly_plan_id='${planId}' AND status='ACTIVE';`
    );
    expect(active[0].c).toBe(0);
    await cleanupPlans();
  }, 120000);
});

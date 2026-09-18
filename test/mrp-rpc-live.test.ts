import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";

// La Management API tarda ~1-2s por roundtrip: techo por test solo de este archivo.
vi.setConfig({ testTimeout: 120_000 });

// Tests LIVE contra Supabase (patrón weekly-plan-atomic-db): validan las RPC
// con contexto JWT real (set_config) + fixtures temporales con cleanup.
// P1-4 A/B/C, TEST 7 (rollback total), TEST 8 (concurrencia), P1-3 (RLS vía pg).

const TOKEN_PATH =
  "C:/Users/User/.gemini/antigravity/brain/43b8d4c1-28c5-47d0-b8c6-28c11747b59e/scratch/supabase_token.txt";
const PROJECT_REF = "ezucivipgmbvamhugkbj";

function token() {
  return fs.readFileSync(TOKEN_PATH, "utf8").trim();
}

async function querySql(query: string) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
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
  return err!;
}

const FX = {
  empresaId: "",
  userId: "",
  projectId: "",
  otherProjectId: "",
  otherItemId: "",
  itemA: "",
  itemB: "",
  productId: "",
  locationId: "",
  recipeId: "",
  codes: [] as string[],
};

async function jwtCall(fnBody: string) {
  return querySql(`DO $$
    DECLARE v_user_id UUID;
    BEGIN
      SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
      PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
      ${fnBody}
    END $$;`);
}

beforeAll(async () => {
  const prof = await querySql(`SELECT id, empresa_id FROM public.profiles LIMIT 1;`);
  FX.userId = prof[0].id;
  FX.empresaId = prof[0].empresa_id;

  const pj = await querySql(
    `INSERT INTO public.projects (empresa_id, name, code, status, contract_amount) VALUES ('${FX.empresaId}', 'MRP TEST', 'MRP-T-${Date.now()}', 'ACTIVO', 1000) RETURNING id;`
  );
  FX.projectId = pj[0].id;

  const items = await querySql(
    `INSERT INTO public.budget_items (project_id, code, description, unit, quantity, unit_price, sort_order, material_requirement) VALUES ` +
      `('${FX.projectId}', 'T.1', 'Item A', 'u', 100, 10, 10, 'NO_MATERIAL'),` +
      `('${FX.projectId}', 'T.2', 'Item B', 'u', 100, 10, 20, 'NO_MATERIAL') RETURNING id, code;`
  );
  FX.itemA = items.find((r: { code: string }) => r.code === "T.1").id;
  FX.itemB = items.find((r: { code: string }) => r.code === "T.2").id;

  const prod = await querySql(
    `INSERT INTO public.productos (empresa_id, nombre, unidad, sku, costo_promedio) VALUES ('${FX.empresaId}', 'MRP TEST MAT', 'u', 'MRP-T-${Date.now()}', 100) RETURNING id;`
  );
  FX.productId = prod[0].id;

  const loc = await querySql(
    `INSERT INTO public.inventory_locations (empresa_id, location_type, name, is_primary, active) VALUES ('${FX.empresaId}', 'AUXILIARY', 'MRP TEST LOC ${Date.now()}', false, true) RETURNING id;`
  );
  FX.locationId = loc[0].id;
  await querySql(
    `INSERT INTO public.inventory_balances (empresa_id, producto_id, location_id, quantity, total_cost, total_cost_company, cost_currency) VALUES ('${FX.empresaId}', '${FX.productId}', '${FX.locationId}', 500, 50000, 50000, 'PYG');`
  );

  // Otro proyecto/item existentes (solo lectura para tests negativos).
  const other = await querySql(
    `SELECT bi.id AS item_id, bi.project_id FROM public.budget_items bi JOIN public.projects p ON p.id = bi.project_id WHERE p.empresa_id <> '${FX.empresaId}' LIMIT 1;`
  );
  if (other.length > 0) {
    FX.otherItemId = other[0].item_id;
    FX.otherProjectId = other[0].project_id;
  }

  const rec = await querySql(
    `INSERT INTO public.production_recipes (empresa_id, project_id, code, name, production_unit, source_type, active) VALUES ('${FX.empresaId}', '${FX.projectId}', 'R-T', 'Receta T', 'u', 'MANUAL', true) RETURNING id;`
  );
  FX.recipeId = rec[0].id;
  await querySql(
    `INSERT INTO public.production_recipe_components (recipe_id, budget_item_id, quantity_per_production_unit, unit, sort_order) VALUES ('${FX.recipeId}', '${FX.itemA}', 2, 'u', 0);`
  );
}, 120000);

afterAll(async () => {
  await querySql(`DELETE FROM public.inventory_reservations WHERE empresa_id='${FX.empresaId}' AND project_id='${FX.projectId}';`);
  await querySql(`DELETE FROM public.production_recipe_components WHERE recipe_id='${FX.recipeId}';`);
  await querySql(`DELETE FROM public.production_recipes WHERE id='${FX.recipeId}';`);
  await querySql(`DELETE FROM public.project_weekly_plan_items WHERE plan_id IN (SELECT id FROM public.project_weekly_plans WHERE project_id='${FX.projectId}');`);
  await querySql(`DELETE FROM public.project_weekly_plans WHERE project_id='${FX.projectId}';`);
  await querySql(`DELETE FROM public.budget_items WHERE project_id='${FX.projectId}';`);
  await querySql(`DELETE FROM public.inventory_balances WHERE empresa_id='${FX.empresaId}' AND location_id='${FX.locationId}';`);
  await querySql(`DELETE FROM public.inventory_locations WHERE id='${FX.locationId}';`);
  await querySql(`DELETE FROM public.productos WHERE id='${FX.productId}';`);
  await querySql(`DELETE FROM public.projects WHERE id='${FX.projectId}';`);
}, 120000);

describe("P1-4 A. Reemplazo con componente inválido: rollback total", () => {
  it("qty 0 en reemplazo falla y la receta previa queda intacta", async () => {
    await expectRpcThrows(
      `DO $$ DECLARE v_uid UUID; BEGIN SELECT id INTO v_uid FROM public.profiles LIMIT 1; PERFORM set_config('request.jwt.claim.sub', v_uid::text, true); PERFORM public.save_production_recipe_atomic('${FX.recipeId}', '${FX.projectId}', 'R-T', 'Receta T', 'u', NULL, NULL, 'MANUAL', NULL, '[{"budget_item_id": "${FX.itemA}", "quantity_per_unit": 0, "unit": "u"}]'::jsonb); END $$;`,
      /Cantidad por unidad debe ser/
    );
    const comps = await querySql(
      `SELECT quantity_per_production_unit FROM public.production_recipe_components WHERE recipe_id='${FX.recipeId}';`
    );
    expect(comps.length).toBe(1);
    expect(Number(comps[0].quantity_per_production_unit)).toBe(2);
  });
});

describe("P1-4 B/C. Cross-project y cross-tenant denied sin escribir", () => {
  it("B. item de otro proyecto → denied", async () => {
    if (!FX.otherItemId) {
      console.warn("sin proyecto ajeno para B; skip");
      return;
    }
    await expectRpcThrows(
      `DO $$ DECLARE v_uid UUID; BEGIN SELECT id INTO v_uid FROM public.profiles LIMIT 1; PERFORM set_config('request.jwt.claim.sub', v_uid::text, true); PERFORM public.save_production_recipe_atomic(NULL, '${FX.projectId}', 'R-X', 'RX', 'u', NULL, NULL, 'MANUAL', NULL, '[{"budget_item_id": "${FX.otherItemId}", "quantity_per_unit": 1, "unit": "u"}]'::jsonb); END $$;`,
      /no pertenece/
    );
  });

  it("C. project de otro tenant → denied", async () => {
    if (!FX.otherProjectId) {
      console.warn("sin proyecto ajeno para C; skip");
      return;
    }
    await expectRpcThrows(
      `DO $$ DECLARE v_uid UUID; BEGIN SELECT id INTO v_uid FROM public.profiles LIMIT 1; PERFORM set_config('request.jwt.claim.sub', v_uid::text, true); PERFORM public.save_production_recipe_atomic(NULL, '${FX.otherProjectId}', 'R-X', 'RX', 'u', NULL, NULL, 'MANUAL', NULL, '[{"budget_item_id": "${FX.itemA}", "quantity_per_unit": 1, "unit": "u"}]'::jsonb); END $$;`,
      /sin permisos/
    );
  });
});

describe("TEST 7. Commit con stock insuficiente: rollback TOTAL (sin plan)", () => {
  it("oversell 600 de 500 falla sin crear plan ni reservas", async () => {
    const before = await querySql(
      `SELECT count(*)::int c FROM public.project_weekly_plans WHERE project_id='${FX.projectId}';`
    );
    await expectRpcThrows(
      `DO $$ DECLARE v_uid UUID; BEGIN SELECT id INTO v_uid FROM public.profiles LIMIT 1; PERFORM set_config('request.jwt.claim.sub', v_uid::text, true); PERFORM public.commit_production_plan_atomic(NULL, '${FX.projectId}', '2026-09-18', '2026-09-24', 'COMMITTED', NULL, '[]'::jsonb, NULL, '${FX.locationId}', '[{"producto_id": "${FX.productId}", "quantity": 600}]'::jsonb, '2026-09-24', NULL); END $$;`,
      /insuficiente/i
    );
    const after = await querySql(
      `SELECT count(*)::int c FROM public.project_weekly_plans WHERE project_id='${FX.projectId}';`
    );
    expect(after[0].c).toBe(before[0].c);
    const res = await querySql(
      `SELECT count(*)::int c FROM public.inventory_reservations WHERE empresa_id='${FX.empresaId}' AND location_id='${FX.locationId}' AND producto_id='${FX.productId}' AND status='ACTIVE';`
    );
    expect(res[0].c).toBe(0);
  });
});

describe("TEST 8. Dos commits concurrentes: uno gana, sin negativo", () => {
  it("Promise.all 400+400 sobre 500: exactamente uno persiste", async () => {
    const mkCall = (tag: string) =>
      `DO $$ DECLARE v_uid UUID; BEGIN SELECT id INTO v_uid FROM public.profiles LIMIT 1; PERFORM set_config('request.jwt.claim.sub', v_uid::text, true); PERFORM public.commit_production_plan_atomic(NULL, '${FX.projectId}', '2026-09-18', '2026-09-24', 'COMMITTED', '${tag}', '[]'::jsonb, NULL, '${FX.locationId}', '[{"producto_id": "${FX.productId}", "quantity": 400}]'::jsonb, '2026-09-24', NULL); END $$;`;
    const results = await Promise.allSettled([querySql(mkCall("T8-A")), querySql(mkCall("T8-B"))]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.filter((r) => r.status === "rejected").length;
    expect(ok).toBe(1);
    expect(fail).toBe(1);
    const sum = await querySql(
      `SELECT COALESCE(SUM(quantity),0)::int total FROM public.inventory_reservations WHERE empresa_id='${FX.empresaId}' AND location_id='${FX.locationId}' AND producto_id='${FX.productId}' AND status='ACTIVE';`
    );
    expect(sum[0].total).toBeLessThanOrEqual(500);
    expect(sum[0].total).toBe(400);
    // Limpieza del ganador para no contaminar otros tests.
    await querySql(
      `DELETE FROM public.inventory_reservations WHERE empresa_id='${FX.empresaId}' AND location_id='${FX.locationId}' AND producto_id='${FX.productId}';`
    );
    await querySql(`DELETE FROM public.project_weekly_plans WHERE project_id='${FX.projectId}';`);
  }, 120000);
});

describe("P1-3. RLS real en catálogo: tenant scoping + sin grants de escritura", () => {
  it("policies con scoping por empresa y relacl sin INSERT/UPDATE/DELETE", async () => {
    const pols = await querySql(
      `SELECT tablename, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('inventory_reservations','production_recipes','production_recipe_components');`
    );
    expect(pols.length).toBeGreaterThan(0);
    for (const p of pols as Array<{ tablename: string; qual: string; with_check: string }>) {
      expect(p.qual || p.with_check || "").toContain("current_empresa_id");
    }
    const acl = await querySql(
      `SELECT relname, relacl::text AS acl FROM pg_class WHERE relname IN ('inventory_reservations','production_recipes','production_recipe_components');`
    );
    for (const row of acl as Array<{ relname: string; acl: string }>) {
      // authenticated=r (select) permitido; a(insert)/w(update)/d(delete) denegados.
      const m = row.acl.match(/authenticated=([a-z]*)/);
      expect(m, row.relname).not.toBeNull();
      expect(m![1]).toContain("r");
      expect(m![1]).not.toContain("a");
      expect(m![1]).not.toContain("w");
      expect(m![1]).not.toContain("d");
    }
  });
});

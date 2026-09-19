import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "fs";

// La Management API tarda ~1-2s por roundtrip: techo por test solo de este archivo.
vi.setConfig({ testTimeout: 120_000 });

// Tests LIVE contra Supabase: las RPC MRP reciben empresa/actor explícitos
// (server-only) y validan tenant + rol. Fixtures temporales con cleanup.
// P1-4 A/B/C, P1-1 re-commit x3, TEST 7 (rollback), TEST 8 (concurrencia),
// P1-3 (RLS vía pg), actor cross-tenant/rol.

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
  otherUserId: "",
  otherUserEmpresa: "",
  projectId: "",
  otherProjectId: "",
  otherItemId: "",
  otherEmpresaId: "",
  itemA: "",
  itemB: "",
  productId: "",
  locationId: "",
  recipeId: "",
};

const saveRecipe = (over: {
  recipe?: string;
  project?: string;
  code?: string;
  comps?: string;
  empresa?: string;
  actor?: string;
}) =>
  `SELECT public.save_production_recipe_atomic('${over.empresa ?? "$E"}', '${over.actor ?? "$U"}', ${
    over.recipe === undefined ? "NULL" : `'${over.recipe}'`
  }, '${over.project ?? "$P"}', '${over.code ?? "R-X"}', 'RX', 'u', NULL, NULL, 'MANUAL', NULL, '${over.comps ?? "[]"}'::jsonb);`;

function fillPlaceholders(sql: string): string {
  return sql
    .split("$E").join(FX.empresaId)
    .split("$U").join(FX.userId)
    .split("$P").join(FX.projectId);
}

async function callSaveRecipe(over: Parameters<typeof saveRecipe>[0]) {
  return querySql(fillPlaceholders(saveRecipe(over)));
}

async function expectSaveThrows(over: Parameters<typeof saveRecipe>[0], match: RegExp | string) {
  return expectRpcThrows(fillPlaceholders(saveRecipe(over)), match);
}

function commitSql(opts: {
  plan?: string | null;
  status?: string;
  items?: string;
  location?: string | null;
  reserve?: string;
  tag?: string;
}) {
  const plan = opts.plan === undefined ? "NULL" : opts.plan === null ? "NULL" : `'${opts.plan}'`;
  const loc = !opts.location ? "NULL" : `'${opts.location}'`;
  return `SELECT public.commit_production_plan_atomic('${FX.empresaId}', '${FX.userId}', ${plan}, '${FX.projectId}', '2026-09-18', '2026-09-24', '${
    opts.status ?? "COMMITTED"
  }', ${opts.tag ? `'${opts.tag}'` : "NULL"}, '${opts.items ?? "[]"}'::jsonb, NULL, ${loc}, '${opts.reserve ?? "[]"}'::jsonb, '2026-09-24', NULL);`;
}

beforeAll(async () => {
  const prof = await querySql(
    `SELECT id, empresa_id FROM public.profiles WHERE role IN ('administracion','admin') LIMIT 1;`
  );
  if (prof.length === 0) throw new Error("sin usuario admin para fixtures");
  FX.userId = prof[0].id;
  FX.empresaId = prof[0].empresa_id;

  // Actor ajeno determinista: UUID inexistente (sin perfil en ningún tenant).
  FX.otherUserId = "00000000-0000-0000-0000-000000000000";
  FX.otherUserEmpresa = FX.empresaId;

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

  // Empresa/proyecto/item B deterministas (propios, con cleanup en afterAll).
  const empB = await querySql(
    `INSERT INTO public.empresas (nombre, slug, plan, modulo_compras, modulo_ventas) VALUES ('MRP TEST B', 'MRP-T-B-${Date.now()}', 'pro', true, false) RETURNING id;`
  );
  FX.otherEmpresaId = empB[0].id;
  const projB = await querySql(
    `INSERT INTO public.projects (empresa_id, name, code, status, contract_amount) VALUES ('${FX.otherEmpresaId}', 'MRP TEST B', 'MRP-TB-${Date.now()}', 'ACTIVO', 100) RETURNING id;`
  );
  FX.otherProjectId = projB[0].id;
  const itemB = await querySql(
    `INSERT INTO public.budget_items (project_id, code, description, unit, quantity, unit_price, sort_order, material_requirement) VALUES ('${FX.otherProjectId}', 'B.1', 'Item B', 'u', 50, 5, 10, 'NO_MATERIAL') RETURNING id;`
  );
  FX.otherItemId = itemB[0].id;

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
  await querySql(`DELETE FROM public.budget_items WHERE project_id='${FX.otherProjectId}';`);
  await querySql(`DELETE FROM public.projects WHERE id='${FX.otherProjectId}';`);
  await querySql(`DELETE FROM public.empresas WHERE id='${FX.otherEmpresaId}';`);
}, 120000);

describe("P1-4 A. Reemplazo con componente inválido: rollback total", () => {
  it("qty 0 en reemplazo falla y la receta previa queda intacta", async () => {
    await expectSaveThrows(
      {
        recipe: FX.recipeId,
        comps: `[{"budget_item_id": "${FX.itemA}", "quantity_per_unit": 0, "unit": "u"}]`,
      },
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
    await expectSaveThrows(
      {
        comps: `[{"budget_item_id": "${FX.otherItemId}", "quantity_per_unit": 1, "unit": "u"}]`,
      },
      /no pertenece/
    );
  });

  it("C. project de otro tenant → denied", async () => {
    await expectSaveThrows({ project: FX.otherProjectId }, /sin permisos/);
  });

  it("actor inexistente → denied (aunque el proyecto sea propio)", async () => {
    await expectRpcThrows(
      fillPlaceholders(
        `SELECT public.save_production_recipe_atomic('${FX.empresaId}', '${FX.otherUserId}', NULL, '${FX.projectId}', 'R-X', 'RX', 'u', NULL, NULL, 'MANUAL', NULL, '[]'::jsonb);`
      ),
      /sin perfil|sin rol/
    );
  });
});

describe("P1-1. Re-commit x3 del mismo plan: reemplaza sin violar unique", () => {
  it("commit → recommit → recommit: 1 ACTIVE final = última cobertura", async () => {
    const mk = (qty: number, tag: string) =>
      fillPlaceholders(
        `SELECT public.commit_production_plan_atomic('${FX.empresaId}', '${FX.userId}', __PLAN__, '${FX.projectId}', '2026-09-18', '2026-09-24', 'COMMITTED', '${tag}', '[]'::jsonb, NULL, '${FX.locationId}', '[{"producto_id": "${FX.productId}", "quantity": ${qty}}]'::jsonb, '2026-09-24', 'P11');`
      );
    // 1er commit crea el plan.
    const r1 = await querySql(mk(100, "P11-A").replace("__PLAN__", "NULL"));
    expect(JSON.stringify(r1)).toContain("SUCCESS");
    const plan = await querySql(
      `SELECT id FROM public.project_weekly_plans WHERE project_id='${FX.projectId}' ORDER BY created_at DESC LIMIT 1;`
    );
    const planId = plan[0].id as string;
    // Re-commits del MISMO plan (reemplazo atómico, sin unique violation).
    await querySql(mk(150, "P11-B").replace("__PLAN__", `'${planId}'`));
    await querySql(mk(120, "P11-C").replace("__PLAN__", `'${planId}'`));

    const active = await querySql(
      `SELECT quantity FROM public.inventory_reservations WHERE weekly_plan_id='${planId}' AND status='ACTIVE';`
    );
    expect(active.length).toBe(1);
    expect(Number(active[0].quantity)).toBe(120);
    const hist = await querySql(
      `SELECT count(*)::int c FROM public.inventory_reservations WHERE weekly_plan_id='${planId}' AND status='RELEASED';`
    );
    expect(hist[0].c).toBe(2);
    // Limpieza de este caso (el afterAll borra el resto).
    await querySql(`DELETE FROM public.inventory_reservations WHERE weekly_plan_id='${planId}';`);
    await querySql(
      `DELETE FROM public.project_weekly_plan_items WHERE plan_id='${planId}'; DELETE FROM public.project_weekly_plans WHERE id='${planId}';`
    );
  }, 120000);
});

describe("TEST 7. Commit con stock insuficiente: rollback TOTAL (sin plan)", () => {
  it("oversell 600 de 500 falla sin crear plan ni reservas", async () => {
    const before = await querySql(
      `SELECT count(*)::int c FROM public.project_weekly_plans WHERE project_id='${FX.projectId}';`
    );
    await expectRpcThrows(
      fillPlaceholders(
        `SELECT public.commit_production_plan_atomic('${FX.empresaId}', '${FX.userId}', NULL, '${FX.projectId}', '2026-09-18', '2026-09-24', 'COMMITTED', NULL, '[]'::jsonb, NULL, '${FX.locationId}', '[{"producto_id": "${FX.productId}", "quantity": 600}]'::jsonb, '2026-09-24', 'T7');`
      ),
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
      fillPlaceholders(
        `SELECT public.commit_production_plan_atomic('${FX.empresaId}', '${FX.userId}', NULL, '${FX.projectId}', '2026-09-18', '2026-09-24', 'COMMITTED', '${tag}', '[]'::jsonb, NULL, '${FX.locationId}', '[{"producto_id": "${FX.productId}", "quantity": 400}]'::jsonb, '2026-09-24', '${tag}');`
      );
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

describe("P2-1. EXECUTE de RPCs mutantes: solo service_role (live)", () => {
  it("authenticated no puede ejecutar; service_role sí", async () => {
    const sigs = [
      "public.reserve_plan_stock(uuid,uuid,uuid,uuid,uuid,jsonb,date,text,boolean)",
      "public.release_plan_reservations(uuid,uuid,uuid)",
      "public.save_production_recipe_atomic(uuid,uuid,uuid,uuid,text,text,text,text,numeric,text,text,jsonb)",
      "public.commit_production_plan_atomic(uuid,uuid,uuid,uuid,date,date,text,text,jsonb,uuid,uuid,jsonb,date,text)",
    ];
    for (const sig of sigs) {
      const rows = await querySql(
        `SELECT has_function_privilege('authenticated', '${sig}', 'EXECUTE') AS auth, has_function_privilege('service_role', '${sig}', 'EXECUTE') AS srv;`
      );
      expect(rows[0].auth, sig).toBe(false);
      expect(rows[0].srv, sig).toBe(true);
    }
  });
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

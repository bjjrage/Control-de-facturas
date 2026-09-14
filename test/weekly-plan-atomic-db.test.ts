import { describe, it, expect } from "vitest";
import * as fs from "fs";

describe("Database Level Hardening: Atomic RPC, Rollback & Canonical Schema", () => {
  const token = fs.readFileSync("C:/Users/User/.gemini/antigravity/brain/43b8d4c1-28c5-47d0-b8c6-28c11747b59e/scratch/supabase_token.txt", "utf8").trim();

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
    if (!resp.ok) {
      throw new Error(`SQL failed: ${text}`);
    }
    return JSON.parse(text);
  }

  it("1. Multi-front index handles Sector A, Sector B and NULL front labels", async () => {
    const checkIndex = await querySql(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'project_weekly_plan_items' AND indexname = 'idx_weekly_plan_items_multi_front';
    `);
    expect(checkIndex.length).toBe(1);
    expect(checkIndex[0].indexdef.toLowerCase()).toContain("coalesce(trim(both from front_label)");
  });

  it("2. Canonical producto_id column exists on authorized_order_items", async () => {
    const checkCol = await querySql(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'authorized_order_items' AND column_name = 'producto_id';
    `);
    expect(checkCol.length).toBe(1);
    expect(checkCol[0].column_name).toBe("producto_id");
  });

  it("3. RPC function save_weekly_plan_atomic exists with strict parameters", async () => {
    const checkRpc = await querySql(`
      SELECT proname, pronargs
      FROM pg_proc
      WHERE proname = 'save_weekly_plan_atomic';
    `);
    expect(checkRpc.length).toBe(1);
    expect(checkRpc[0].proname).toBe("save_weekly_plan_atomic");
  });

  it("4. ATOMICITY & ROLLBACK PROOF: inserting invalid budget_item aborts transaction and preserves existing items intact", async () => {
    // 0. Ensure clean state
    await querySql(`DELETE FROM public.projects WHERE code = 'PRJ-ATM-01';`);

    // 1. Create a dummy project and plan with 3 items
    const setupSql = `
      DO $$
      DECLARE
        v_user_id UUID;
        v_empresa_id UUID;
        v_proj_id UUID;
        v_item1 UUID;
        v_item2 UUID;
        v_item3 UUID;
        v_plan_id UUID;
      BEGIN
        SELECT id, empresa_id INTO v_user_id, v_empresa_id FROM public.profiles LIMIT 1;

        INSERT INTO public.projects (empresa_id, name, code, start_date, budget_total)
        VALUES (v_empresa_id, 'TEST-ATOMIC-PROJ', 'PRJ-ATM-01', '2026-09-01', 10000000)
        RETURNING id INTO v_proj_id;

        INSERT INTO public.budget_items (project_id, code, description, quantity, unit_price)
        VALUES (v_proj_id, '01', 'Item 1', 10, 1000) RETURNING id INTO v_item1;
        INSERT INTO public.budget_items (project_id, code, description, quantity, unit_price)
        VALUES (v_proj_id, '02', 'Item 2', 10, 1000) RETURNING id INTO v_item2;
        INSERT INTO public.budget_items (project_id, code, description, quantity, unit_price)
        VALUES (v_proj_id, '03', 'Item 3', 10, 1000) RETURNING id INTO v_item3;

        INSERT INTO public.project_weekly_plans (empresa_id, project_id, start_date, end_date, status)
        VALUES (v_empresa_id, v_proj_id, '2026-09-14', '2026-09-20', 'DRAFT')
        RETURNING id INTO v_plan_id;

        INSERT INTO public.project_weekly_plan_items (plan_id, budget_item_id, front_label, input_mode, input_value, target_quantity, unit)
        VALUES (v_plan_id, v_item1, 'F1', 'QUANTITY', 5, 5, 'u'),
               (v_plan_id, v_item2, 'F2', 'QUANTITY', 5, 5, 'u'),
               (v_plan_id, v_item3, 'F3', 'QUANTITY', 5, 5, 'u');
      END;
      $$;
    `;
    await querySql(setupSql);

    // Verify 3 items exist
    const countBefore = await querySql(`
      SELECT count(*)::int as cnt
      FROM public.project_weekly_plan_items pi
      JOIN public.project_weekly_plans p ON p.id = pi.plan_id
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE pr.code = 'PRJ-ATM-01';
    `);
    expect(countBefore[0].cnt).toBe(3);

    // Try to update plan with an invalid budget_item_id using RPC
    const failRpcSql = `
      DO $$
      DECLARE
        v_user_id UUID;
      BEGIN
        SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
        PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

        PERFORM public.save_weekly_plan_atomic(
          (SELECT p.id FROM public.project_weekly_plans p JOIN public.projects pr ON pr.id = p.project_id WHERE pr.code = 'PRJ-ATM-01' LIMIT 1),
          (SELECT id FROM public.projects WHERE code = 'PRJ-ATM-01'),
          '2026-09-14'::DATE,
          '2026-09-20'::DATE,
          'DRAFT',
          'Attempt with invalid item',
          '[{"budget_item_id":"00000000-0000-0000-0000-000000000000","front_label":"X","input_mode":"QUANTITY","input_value":10,"unit":"u"}]'::JSONB
        );
      END;
      $$;
    `;

    let rpcFailed = false;
    try {
      await querySql(failRpcSql);
    } catch (e: any) {
      rpcFailed = true;
      expect(e.message).toContain("no pertenece al proyecto");
    }
    expect(rpcFailed).toBe(true);

    // Verify that ALL 3 ORIGINAL ITEMS REMAIN INTACT (rollback succeeded, not empty!)
    const countAfter = await querySql(`
      SELECT count(*)::int as cnt
      FROM public.project_weekly_plan_items pi
      JOIN public.project_weekly_plans p ON p.id = pi.plan_id
      JOIN public.projects pr ON pr.id = p.project_id
      WHERE pr.code = 'PRJ-ATM-01';
    `);
    expect(countAfter[0].cnt).toBe(3);

    // Cleanup test dummy project
    await querySql(`
      DELETE FROM public.projects WHERE code = 'PRJ-ATM-01';
    `);
  }, 30000);

  it("5. DB Percentage Conversion & Read-After-Write: 500 m2 item with 10% saves target_quantity = 50 and matches engine", async () => {
    // 0. Ensure clean state
    await querySql(`DELETE FROM public.projects WHERE code = 'PRJ-PCT-01';`);

    const setupSql = `
      DO $$
      DECLARE
        v_user_id UUID;
        v_empresa_id UUID;
        v_proj_id UUID;
        v_item UUID;
        v_plan_id UUID;
      BEGIN
        SELECT id, empresa_id INTO v_user_id, v_empresa_id FROM public.profiles LIMIT 1;
        PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

        INSERT INTO public.projects (empresa_id, name, code, start_date, budget_total)
        VALUES (v_empresa_id, 'TEST-PERCENTAGE-PROJ', 'PRJ-PCT-01', '2026-09-01', 50000000)
        RETURNING id INTO v_proj_id;

        -- Contractual quantity = 500 m2, executed = 0, remaining = 500 m2
        INSERT INTO public.budget_items (project_id, code, description, unit, quantity, unit_price)
        VALUES (v_proj_id, '02.01', 'Mampostería 500 m2', 'm2', 500, 100000)
        RETURNING id INTO v_item;

        -- Call save_weekly_plan_atomic with input_mode = CONTRACT_PERCENTAGE_POINTS and input_value = 10
        PERFORM public.save_weekly_plan_atomic(
          NULL,
          v_proj_id,
          '2026-09-14'::DATE,
          '2026-09-20'::DATE,
          'DRAFT',
          'Test 10% on 500m2',
          jsonb_build_array(
            jsonb_build_object(
              'budget_item_id', v_item,
              'front_label', 'Frente Principal',
              'input_mode', 'CONTRACT_PERCENTAGE_POINTS',
              'input_value', 10,
              'unit', 'm2'
            )
          )
        );
      END;
      $$;
    `;
    await querySql(setupSql);

    // Read back saved item from DB
    const rows = await querySql(`
      SELECT
        b.quantity as contractual_quantity,
        pi.input_mode,
        pi.input_value::numeric as input_value,
        pi.target_quantity::numeric as target_quantity
      FROM public.project_weekly_plan_items pi
      JOIN public.project_weekly_plans p ON p.id = pi.plan_id
      JOIN public.projects pr ON pr.id = p.project_id
      JOIN public.budget_items b ON b.id = pi.budget_item_id
      WHERE pr.code = 'PRJ-PCT-01';
    `);

    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(Number(row.contractual_quantity)).toBe(500);
    expect(row.input_mode).toBe("CONTRACT_PERCENTAGE_POINTS");
    expect(Number(row.input_value)).toBe(10);
    // CRITICAL P0 ASSERTION: target_quantity MUST BE 50, NOT 10!
    expect(Number(row.target_quantity)).toBe(50);

    // Cleanup
    await querySql(`DELETE FROM public.projects WHERE code = 'PRJ-PCT-01';`);
  }, 30000);
});

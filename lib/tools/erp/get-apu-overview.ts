// READ tool LEVEL 0 — APU/BOM material trazable a budget_item_materials.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetApuOverviewInputSchema = z.object({
  project_id: z.string().uuid(),
  budget_item_id: z.string().uuid().optional().nullable(),
});
export type GetApuOverviewInput = z.infer<typeof GetApuOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetApuOverviewInput, deps: { db: SupabaseClient }) {
  const { db } = deps;
  const { data: project, error: projectError } = await db.from("projects").select("id, name, code").eq("id", input.project_id).eq("empresa_id", ctx.empresaId).maybeSingle();
  if (projectError) throw new Error(`Error leyendo la obra: ${projectError.message}`);
  if (!project) throw new Error("La obra no existe o no pertenece a tu empresa.");

  let budgetQuery = db.from("budget_items").select("id, code, description, unit, quantity, unit_price, subtotal, parent_id, sort_order").eq("project_id", input.project_id).order("sort_order");
  if (input.budget_item_id) budgetQuery = budgetQuery.eq("id", input.budget_item_id);
  let materialQuery = db.from("budget_item_materials").select("id, budget_item_id, producto_id, cantidad_por_unidad_ejecutada, desperdicio_pct, productos(id, nombre, codigo, unidad_medida, costo_promedio)").eq("project_id", input.project_id).eq("empresa_id", ctx.empresaId);
  if (input.budget_item_id) materialQuery = materialQuery.eq("budget_item_id", input.budget_item_id);
  const [{ data: budgetItems, error: budgetError }, { data: materials, error: materialError }] = await Promise.all([budgetQuery, materialQuery]);
  if (budgetError) throw new Error(`Error leyendo partidas para APU: ${budgetError.message}`);
  if (materialError) throw new Error(`Error leyendo materiales del APU: ${materialError.message}`);

  const materialRows = (materials ?? []).map((row) => {
    const product = Array.isArray(row.productos) ? row.productos[0] : row.productos;
    const quantity = Number(row.cantidad_por_unidad_ejecutada ?? 0);
    const waste = Number(row.desperdicio_pct ?? 0);
    const unitCost = product?.costo_promedio == null ? null : Number(product.costo_promedio);
    return { ...row, producto: product ?? null, quantity_with_waste: quantity * (1 + waste / 100), material_unit_cost: unitCost, material_unit_cost_with_waste: unitCost == null ? null : unitCost * quantity * (1 + waste / 100) };
  });
  return { project, budget_items: budgetItems ?? [], materials: materialRows, apu_scope: "materials_only", unavailable_components: ["labor", "equipment", "performance_rates"] };
}

registerTool({
  name: "get_apu_overview",
  description: "Lee el APU/BOM material real de una obra y partida, incluyendo rendimientos materiales, desperdicio, costo promedio y costo material unitario calculado. Declara explícitamente que mano de obra/equipos/rendimientos de esos componentes no están modelados si no existen.",
  inputSchema: GetApuOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getApuOverviewTool = { handler, inputSchema: GetApuOverviewInputSchema };

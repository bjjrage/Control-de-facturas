// READ tool LEVEL 0 — APU/BOM completo: materiales + mano de obra + equipo.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { readApuRows } from "@/lib/costing/apu-source";
import { resolveProjectMaterialPrices } from "@/lib/costing/project-prices";

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

  const [
    { data: budgetItems, error: budgetError },
    { data: materials, error: materialError },
    { data: labor, error: laborError },
    { data: equipment, error: equipmentError },
    { data: subcontracts, error: subcontractError },
  ] = await Promise.all([
readApuRows(db,"budget_items","id,code,description,unit,quantity,unit_price,subtotal,parent_id,sort_order",input.project_id),
readApuRows(db,"budget_item_materials","id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada,desperdicio_pct,precio_unitario_origen,productos(id,nombre,sku,unidad,costo_promedio)",input.project_id,ctx.empresaId),
readApuRows(db,"budget_item_labor","id,budget_item_id,rol,horas_por_unidad_ejecutada,costo_hora",input.project_id,ctx.empresaId),
readApuRows(db,"budget_item_equipment","id,budget_item_id,tipo_equipo,horas_por_unidad_ejecutada,costo_hora",input.project_id,ctx.empresaId),
readApuRows(db,"budget_item_subcontracts","id,budget_item_id,descripcion,precio_por_unidad",input.project_id,ctx.empresaId)
]);
  if (budgetError) throw new Error(`Error leyendo partidas para APU: ${budgetError.message}`);
  if (materialError) throw new Error(`Error leyendo materiales del APU: ${materialError.message}`);
  if (laborError) throw new Error(`Error leyendo mano de obra del APU: ${laborError.message}`);
  if (equipmentError) throw new Error(`Error leyendo equipo del APU: ${equipmentError.message}`);
  if (subcontractError) throw new Error(`Error leyendo subcontratos del APU: ${subcontractError.message}`);

  const materialPrices = await resolveProjectMaterialPrices({supabase:db,admin:db,empresaId:ctx.empresaId,projectId:input.project_id,productIds:(materials??[]).map(m=>m.producto_id)});
  const materialRows = (materials ?? []).filter(row=>!input.budget_item_id || row.budget_item_id===input.budget_item_id).map((row) => {
    const product = Array.isArray(row.productos) ? row.productos[0] : row.productos;
    const quantity = Number(row.cantidad_por_unidad_ejecutada ?? 0);
    const waste = Number(row.desperdicio_pct ?? 0);
    const resolved = materialPrices.get(row.producto_id)?.price;
    const unitCost = resolved && resolved.fuente!=="PLANILLA" ? resolved.precio : row.precio_unitario_origen != null ? Number(row.precio_unitario_origen) : product?.costo_promedio > 0 ? Number(product.costo_promedio) : null;
    return { ...row, producto: product ?? null, quantity_with_waste: quantity * (1 + waste / 100), material_unit_cost: unitCost, material_unit_cost_with_waste: unitCost == null ? null : unitCost * quantity * (1 + waste / 100) };
  });
  const laborRows = (labor ?? []).filter(row=>!input.budget_item_id || row.budget_item_id===input.budget_item_id).map((row) => ({
    ...row,
    labor_unit_cost: Number(row.horas_por_unidad_ejecutada) * Number(row.costo_hora),
  }));
  const equipmentRows = (equipment ?? []).filter(row=>!input.budget_item_id || row.budget_item_id===input.budget_item_id).map((row) => ({
    ...row,
    equipment_unit_cost: Number(row.horas_por_unidad_ejecutada) * Number(row.costo_hora),
  }));

  // Ley del producto: si falta costo_promedio de algún material, el costo
  // combinado NO se muestra como si fuera 0 — se marca null con la razón.
  const missingMaterialCost = materialRows.filter((m) => m.material_unit_cost === null);
  const laborTotal = laborRows.reduce((acc, r) => acc + r.labor_unit_cost, 0);
  const equipmentTotal = equipmentRows.reduce((acc, r) => acc + r.equipment_unit_cost, 0);
  const materialTotal = missingMaterialCost.length > 0 ? null : materialRows.reduce((acc, r) => acc + (r.material_unit_cost_with_waste ?? 0), 0);
  const selectedSubcontracts = (subcontracts ?? []).filter(row=>!input.budget_item_id || row.budget_item_id===input.budget_item_id);
  const subcontractTotal = selectedSubcontracts.reduce((acc: number, r: { precio_por_unidad: unknown }) => acc + Number(r.precio_por_unidad), 0);
  const combined_unit_cost = materialTotal === null ? null : materialTotal + laborTotal + equipmentTotal + subcontractTotal;

  return {
    project,
    budget_items: (budgetItems ?? []).filter(row=>!input.budget_item_id || row.id===input.budget_item_id),
    materials: materialRows,
    labor: laborRows,
    equipment: equipmentRows,
    subcontracts: selectedSubcontracts,
    combined_unit_cost,
    combined_unit_cost_unavailable_reason:
      combined_unit_cost === null
        ? `Falta costo_promedio de: ${missingMaterialCost.map((m) => m.producto?.nombre ?? m.producto_id).join(", ")}`
        : null,
    apu_scope: "full",
    unavailable_components: [],
  };
}

registerTool({
  name: "get_apu_overview",
  description: "Lee el APU/BOM real de una obra y partida: materiales (con costo promedio y desperdicio), mano de obra y equipo (costo por hora cargado a mano), y el costo unitario combinado. Nunca informa un costo combinado como si fuera 0 cuando falta costo_promedio de algún material.",
  inputSchema: GetApuOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getApuOverviewTool = { handler, inputSchema: GetApuOverviewInputSchema };

// READ tool LEVEL 0 — inventario global, por depósito, reservas, movimientos y consumos.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { getBudgetInventoryConsumption, getCanonicalInventorySnapshot, getProjectInventorySnapshot } from "@/lib/inventory/service";

export const GetInventoryOverviewInputSchema = z.object({
  producto_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  limit: z.number().int().min(1).max(200).default(100),
});
export type GetInventoryOverviewInput = z.infer<typeof GetInventoryOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetInventoryOverviewInput, deps: { db: SupabaseClient }) {
  const { db } = deps;
  const global = await getCanonicalInventorySnapshot(db, ctx.empresaId, input.producto_id ?? undefined);
  if (global.error) throw new Error(`Error leyendo stock global: ${global.error}`);
  const projectStock = input.project_id ? await getProjectInventorySnapshot(db, ctx.empresaId, input.project_id, input.producto_id ?? undefined) : { data: [], error: null };
  if (projectStock.error) throw new Error(`Error leyendo stock por obra: ${projectStock.error}`);
  const consumed = await getBudgetInventoryConsumption(db, ctx.empresaId, { projectId: input.project_id ?? undefined, productoId: input.producto_id ?? undefined });
  if (consumed.error) throw new Error(`Error leyendo consumos: ${consumed.error}`);
  let locations = db.from("inventory_locations").select("id, name, location_type, project_id, parent_location_id, is_primary, active").eq("empresa_id", ctx.empresaId).order("name").limit(input.limit);
  if (input.location_id) locations = locations.eq("id", input.location_id);
  const reservations = db.from("inventory_reservations").select("id, location_id, producto_id, project_id, weekly_plan_id, quantity, status, needed_by_date, created_at, released_at").eq("empresa_id", ctx.empresaId).order("created_at", { ascending: false }).limit(input.limit);
  const movements = db.from("inventory_movements").select("id, producto_id, quantity, unit, movement_type, from_location_id, to_location_id, project_id, budget_item_id, source_type, source_id, status, cost_currency, unit_cost, created_at, confirmed_at").eq("empresa_id", ctx.empresaId).order("created_at", { ascending: false }).limit(input.limit);
  const [{ data: locationRows, error: locationError }, { data: reservationRows, error: reservationError }, { data: movementRows, error: movementError }] = await Promise.all([locations, reservations, movements]);
  if (locationError || reservationError || movementError) throw new Error(`Error leyendo operaciones de inventario: ${(locationError ?? reservationError ?? movementError)?.message}`);
  return { global_stock: global.global, stock_by_location: global.locations.filter((row) => !input.location_id || row.location_id === input.location_id), project_stock: projectStock.data, reservations: reservationRows ?? [], movements: movementRows ?? [], locations: locationRows ?? [], consumed_by_budget: consumed.data };
}

registerTool({
  name: "get_inventory_overview",
  description: "Lee stock global y por depósito/obra, reservas MRP, movimientos físicos, ubicaciones y consumo por partida. No confirma recepciones, no transfiere stock y no mueve dinero.",
  inputSchema: GetInventoryOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getInventoryOverviewTool = { handler, inputSchema: GetInventoryOverviewInputSchema };

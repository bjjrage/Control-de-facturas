// lib/tools/stock/get-stock-availability.ts
// READ tool LEVEL 0 — stock físico desde las vistas del ledger canónico.
// No duplica reglas de negocio: lee vistas/tablas existentes con scoping tenant.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { getCanonicalInventorySnapshot, getProjectInventorySnapshot, getBudgetInventoryConsumption } from "@/lib/inventory/service";
import { registerTool } from "@/lib/agent/registry";

export const GetStockAvailabilityInputSchema = z.object({
  producto_id: z.string().uuid({ message: "producto_id debe ser UUID valido" }),
  project_id: z.string().uuid({ message: "project_id debe ser UUID valido" }).optional().nullable(),
});

export type GetStockAvailabilityInput = z.infer<typeof GetStockAvailabilityInputSchema>;

export interface GetStockAvailabilityOutput {
  producto: {
    id: string;
    empresa_id: string;
    nombre: string;
    unidad: string;
    sku: string | null;
    stock_actual: number;
    stock_minimo: number;
    costo_promedio: number;
    activo: boolean;
  };
  por_deposito: Array<{
    deposito_id: string;
    deposito_nombre: string;
    stock_actual: number;
  }>;
  por_proyecto: {
    project_id: string;
    qty_comprada: number;
    qty_consumida: number;
    qty_disponible: number;
    costo_comprado: number | null;
    costo_consumido: number | null;
  } | null;
}

async function handler(
  ctx: AgentToolContext,
  input: GetStockAvailabilityInput,
  deps: { db: SupabaseClient }
): Promise<GetStockAvailabilityOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // 1. Producto (tenant-scoped)
  const { data: producto, error: prodErr } = await db
    .from("productos")
    .select("id, empresa_id, nombre, unidad, sku, stock_minimo, costo_promedio, activo")
    .eq("id", input.producto_id)
    .eq("empresa_id", empresaId)
    .single();

  if (prodErr || !producto) {
    throw new Error(`Material/producto no encontrado o no pertenece a tu empresa (id=${input.producto_id})`);
  }

  const snapshot = await getCanonicalInventorySnapshot(db, empresaId, input.producto_id);
  if (snapshot.error) throw new Error(snapshot.error);
  const locationTotals = new Map<string, { deposito_id: string; deposito_nombre: string; stock_actual: number }>();
  for (const row of snapshot.locations) {
    const current = locationTotals.get(row.location_id) ?? { deposito_id: row.location_id, deposito_nombre: row.location_name, stock_actual: 0 };
    current.stock_actual += Number(row.quantity);
    locationTotals.set(row.location_id, current);
  }
  const porDeposito = [...locationTotals.values()];
  let porProyecto: GetStockAvailabilityOutput["por_proyecto"] = null;
  if (input.project_id) {
    const project = await db.from("projects").select("id").eq("id", input.project_id).eq("empresa_id", empresaId).maybeSingle();
    if (project.error || !project.data) throw new Error("Proyecto no encontrado o no pertenece a tu empresa");
    const [stock, consumed, receipts] = await Promise.all([
      getProjectInventorySnapshot(db, empresaId, input.project_id, input.producto_id),
      getBudgetInventoryConsumption(db, empresaId, { projectId: input.project_id, productoId: input.producto_id }),
      db.from("inventory_movements").select("quantity").eq("empresa_id", empresaId).eq("producto_id", input.producto_id).eq("project_id", input.project_id).eq("movement_type", "RECEIPT").eq("status", "CONFIRMED"),
    ]);
    if (stock.error || consumed.error || receipts.error) throw new Error(stock.error ?? consumed.error ?? receipts.error!.message);
    porProyecto = {
      project_id: input.project_id,
      qty_comprada: (receipts.data ?? []).reduce((sum, row) => sum + Number(row.quantity), 0),
      qty_consumida: consumed.data.reduce((sum, row) => sum + Number(row.quantity_consumed), 0),
      qty_disponible: stock.data.reduce((sum, row) => sum + Number(row.quantity), 0),
      costo_comprado: null,
      costo_consumido: consumed.data.every(row => row.cost_consumed_company != null)
        ? consumed.data.reduce((sum, row) => sum + Number(row.cost_consumed_company), 0) : null,
    };
  }

  return {
    producto: {
      id: (producto as { id: string }).id,
      empresa_id: (producto as { empresa_id: string }).empresa_id,
      nombre: (producto as { nombre: string }).nombre,
      unidad: (producto as { unidad: string }).unidad,
      sku: (producto as { sku: string | null }).sku,
      stock_actual: snapshot.global.reduce((sum, row) => sum + Number(row.quantity), 0),
      stock_minimo: Number((producto as { stock_minimo: number }).stock_minimo),
      costo_promedio: Number((producto as { costo_promedio: number }).costo_promedio ?? 0),
      activo: Boolean((producto as { activo: boolean }).activo),
    },
    por_deposito: porDeposito,
    por_proyecto: porProyecto,
  };
}

registerTool<GetStockAvailabilityInput, GetStockAvailabilityOutput>({
  name: "get_stock_availability",
  description:
    "Consulta disponibilidad de stock de un material/producto. Retorna stock global, desglose por deposito y, si se indica project_id, la lente contable comprado/consumido/disponible para esa obra. Usar para 'cuanto tengo de X' o 'disponibilidad para esta obra'.",
  inputSchema: GetStockAvailabilityInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getStockAvailabilityTool = { handler, inputSchema: GetStockAvailabilityInputSchema };

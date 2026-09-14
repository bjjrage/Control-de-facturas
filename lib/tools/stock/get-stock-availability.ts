// lib/tools/stock/get-stock-availability.ts
// READ tool LEVEL 0 — wrapper fino sobre productos + stock_por_deposito + stock_por_proyecto.
// No duplica reglas de negocio: lee vistas/tablas existentes con scoping tenant.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
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
    costo_comprado: number;
    costo_consumido: number;
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
    .select("id, empresa_id, nombre, unidad, sku, stock_actual, stock_minimo, costo_promedio, activo")
    .eq("id", input.producto_id)
    .eq("empresa_id", empresaId)
    .single();

  if (prodErr || !producto) {
    throw new Error(`Material/producto no encontrado o no pertenece a tu empresa (id=${input.producto_id})`);
  }

  // 2. Stock por deposito (desglose por ubicacion)
  const { data: porDepositoRaw, error: depErr } = await db
    .from("stock_por_deposito")
    .select("deposito_id, stock_actual, depositos!inner(nombre)")
    .eq("producto_id", input.producto_id)
    .eq("empresa_id", empresaId);

  if (depErr) throw new Error(`Error leyendo stock por deposito: ${depErr.message}`);

const porDeposito = ((porDepositoRaw ?? []) as unknown as Array<{
    deposito_id: string;
    stock_actual: number;
    depositos: { nombre: string } | null;
}>).map((r) => ({
    deposito_id: r.deposito_id,
    deposito_nombre: r.depositos?.nombre ?? r.deposito_id,
    stock_actual: Number(r.stock_actual),
  }));

  // 3. Stock por proyecto (si se paso project_id, lens contable)
  let porProyecto: GetStockAvailabilityOutput["por_proyecto"] = null;
  if (input.project_id) {
    // Validar que el proyecto pertenece a la empresa (anti cross-tenant via project_id inventado)
    const { data: proj, error: projErr } = await db
      .from("projects")
      .select("id")
      .eq("id", input.project_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (projErr) throw new Error(`Error validando proyecto: ${projErr.message}`);
    if (!proj) throw new Error(`Proyecto no encontrado o no pertenece a tu empresa (id=${input.project_id})`);

    // View stock_por_proyecto es una vista agregada; puede no tener fila si nunca hubo movimientos imputados
    const { data: spp, error: sppErr } = await db
      .from("stock_por_proyecto")
      .select("qty_comprada, qty_consumida, qty_disponible, costo_comprado, costo_consumido")
      .eq("producto_id", input.producto_id)
      .eq("project_id", input.project_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (sppErr) throw new Error(`Error leyendo stock por proyecto: ${sppErr.message}`);

    if (spp) {
      porProyecto = {
        project_id: input.project_id,
        qty_comprada: Number((spp as { qty_comprada: number }).qty_comprada ?? 0),
        qty_consumida: Number((spp as { qty_consumida: number }).qty_consumida ?? 0),
        qty_disponible: Number((spp as { qty_disponible: number }).qty_disponible ?? 0),
        costo_comprado: Number((spp as { costo_comprado: number }).costo_comprado ?? 0),
        costo_consumido: Number((spp as { costo_consumido: number }).costo_consumido ?? 0),
      };
    } else {
      porProyecto = {
        project_id: input.project_id,
        qty_comprada: 0,
        qty_consumida: 0,
        qty_disponible: 0,
        costo_comprado: 0,
        costo_consumido: 0,
      };
    }
  }

  return {
    producto: {
      id: (producto as { id: string }).id,
      empresa_id: (producto as { empresa_id: string }).empresa_id,
      nombre: (producto as { nombre: string }).nombre,
      unidad: (producto as { unidad: string }).unidad,
      sku: (producto as { sku: string | null }).sku,
      stock_actual: Number((producto as { stock_actual: number }).stock_actual),
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

// ACTION tool LEVEL 2 — movimiento físico de inventario; nunca dinero.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { postManualInventoryMovement } from "@/lib/inventory/service";
import type { InventoryMovementType } from "@/lib/inventory/types";

const RODRIGO_MOVEMENT_TYPES = ["TRANSFER", "RETURN", "ADJUSTMENT"] as const;

export const PostInventoryMovementInputSchema = z.object({
  producto_id: z.string().uuid(),
  quantity: z.number().positive().finite(),
  unit: z.string().trim().min(1).max(40),
  movement_type: z.enum(RODRIGO_MOVEMENT_TYPES),
  from_location_id: z.string().uuid().optional().nullable(),
  to_location_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  budget_item_id: z.string().uuid().optional().nullable(),
  cost_currency: z.string().trim().min(1).max(8).optional().nullable(),
  unit_cost: z.number().finite().optional().nullable(),
  exchange_rate_to_company: z.number().positive().finite().optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

export type PostInventoryMovementInput = z.infer<typeof PostInventoryMovementInputSchema>;
export interface PostInventoryMovementOutput { movement_id: string; movement_type: InventoryMovementType; quantity: number; message: string }

async function handler(ctx: AgentToolContext, input: PostInventoryMovementInput, deps: { db: SupabaseClient }): Promise<PostInventoryMovementOutput> {
  if (!ctx.approvalId) throw new Error("El movimiento de Rodrigo requiere una aprobación identificable.");
  if (input.movement_type === "TRANSFER" && (!input.from_location_id || !input.to_location_id || input.from_location_id === input.to_location_id)) {
    throw new Error("Una transferencia necesita origen y destino distintos.");
  }
  if (input.movement_type === "ADJUSTMENT") {
    if (!input.reason?.trim()) throw new Error("Un ajuste de Rodrigo requiere un motivo.");
    if (!input.cost_currency || input.unit_cost == null) throw new Error("Un ajuste de entrada requiere moneda y costo unitario.");
    if (input.cost_currency !== "PYG" && !input.exchange_rate_to_company) {
      throw new Error("El ajuste en moneda extranjera requiere tipo de cambio a PYG.");
    }
  }

  const { data: product, error: productError } = await deps.db
    .from("productos")
    .select("id, unidad, empresa_id")
    .eq("id", input.producto_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (productError) throw new Error(`Error validando material: ${productError.message}`);
  if (!product) throw new Error("El material no existe o no pertenece a tu empresa.");

  const result = await postManualInventoryMovement(deps.db, {
    empresaId: ctx.empresaId,
    productoId: input.producto_id,
    quantity: input.quantity,
    unit: input.unit,
    movementType: input.movement_type,
    fromLocationId: input.from_location_id ?? null,
    toLocationId: input.to_location_id ?? null,
    projectId: input.project_id ?? null,
    budgetItemId: input.budget_item_id ?? null,
    sourceType: "MANUAL",
    sourceId: ctx.approvalId,
    idempotencyKey: ctx.approvalId,
    costCurrency: input.cost_currency ?? null,
    unitCost: input.unit_cost ?? null,
    exchangeRateToCompany: input.exchange_rate_to_company ?? null,
    createdBy: ctx.userId,
    metadata: { source: "rodrigo", approval_id: ctx.approvalId, reason: input.reason?.trim() ?? null },
  });
  if (result.error || !result.data) throw new Error(`No se pudo registrar el movimiento de inventario: ${result.error ?? "respuesta sin id"}`);
  return { movement_id: result.data, movement_type: input.movement_type, quantity: input.quantity, message: "Movimiento de inventario registrado." };
}

registerTool<PostInventoryMovementInput, PostInventoryMovementOutput>({
  name: "post_inventory_movement",
  description:
    "Registra una transferencia, devolución o ajuste de inventario por el servicio canónico, con aprobación humana e idempotencia ligada a esa aprobación. No registra recepciones ni consumos: usar manage_inventory_operation para esos flujos. Nunca mueve dinero.",
  inputSchema: PostInventoryMovementInputSchema,
  riskLevel: 2,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const postInventoryMovementTool = { handler, inputSchema: PostInventoryMovementInputSchema };

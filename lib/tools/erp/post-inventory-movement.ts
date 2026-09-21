// ACTION tool LEVEL 2 — movimiento físico de inventario; nunca dinero.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { postInventoryMovement } from "@/lib/inventory/service";
import { INVENTORY_MOVEMENT_TYPES, type InventoryMovementType } from "@/lib/inventory/types";

export const PostInventoryMovementInputSchema = z.object({
  producto_id: z.string().uuid(),
  quantity: z.number().positive().finite(),
  unit: z.string().trim().min(1).max(40),
  movement_type: z.enum(INVENTORY_MOVEMENT_TYPES),
  from_location_id: z.string().uuid().optional().nullable(),
  to_location_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  budget_item_id: z.string().uuid().optional().nullable(),
  source_id: z.string().uuid().optional().nullable(),
  idempotency_key: z.string().trim().min(1).max(180).optional(),
  cost_currency: z.string().trim().min(1).max(8).optional().nullable(),
  unit_cost: z.number().finite().optional().nullable(),
  exchange_rate_to_company: z.number().positive().finite().optional().nullable(),
});

export type PostInventoryMovementInput = z.infer<typeof PostInventoryMovementInputSchema>;
export interface PostInventoryMovementOutput { movement_id: string; movement_type: InventoryMovementType; quantity: number; message: string }

async function handler(ctx: AgentToolContext, input: PostInventoryMovementInput, deps: { db: SupabaseClient }): Promise<PostInventoryMovementOutput> {
  if (input.movement_type === "TRANSFER" && (!input.from_location_id || !input.to_location_id || input.from_location_id === input.to_location_id)) {
    throw new Error("Una transferencia necesita origen y destino distintos.");
  }
  if (input.movement_type === "CONSUMPTION" && !input.from_location_id) {
    throw new Error("Un consumo necesita la ubicación de origen.");
  }
  if (input.movement_type === "RECEIPT" && !input.to_location_id) {
    throw new Error("Una recepción necesita la ubicación de destino.");
  }

  const { data: product, error: productError } = await deps.db
    .from("productos")
    .select("id, unidad, empresa_id")
    .eq("id", input.producto_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (productError) throw new Error(`Error validando material: ${productError.message}`);
  if (!product) throw new Error("El material no existe o no pertenece a tu empresa.");

  const idempotencyKey = input.idempotency_key ?? ["rodrigo", ctx.taskId ?? ctx.runId ?? "interactive", input.producto_id, input.movement_type, input.quantity, input.from_location_id ?? "", input.to_location_id ?? ""].join(":");
  const result = await postInventoryMovement(deps.db, {
    empresaId: ctx.empresaId,
    productoId: input.producto_id,
    quantity: input.quantity,
    unit: input.unit,
    movementType: input.movement_type,
    fromLocationId: input.from_location_id ?? null,
    toLocationId: input.to_location_id ?? null,
    projectId: input.project_id ?? null,
    budgetItemId: input.budget_item_id ?? null,
    sourceType: "RODRIGO",
    sourceId: input.source_id ?? null,
    idempotencyKey,
    costCurrency: input.cost_currency ?? null,
    unitCost: input.unit_cost ?? null,
    exchangeRateToCompany: input.exchange_rate_to_company ?? null,
    createdBy: ctx.userId,
    metadata: { source: "rodrigo" },
  });
  if (result.error || !result.data) throw new Error(`No se pudo registrar el movimiento de inventario: ${result.error ?? "respuesta sin id"}`);
  return { movement_id: result.data, movement_type: input.movement_type, quantity: input.quantity, message: "Movimiento de inventario registrado." };
}

registerTool<PostInventoryMovementInput, PostInventoryMovementOutput>({
  name: "post_inventory_movement",
  description:
    "Registra un movimiento físico real de inventario (recepción, transferencia, consumo, devolución o ajuste) usando el servicio/RPC canónico del ERP. Requiere aprobación humana y nunca mueve dinero. Antes de llamarlo, resolver producto y depósitos por nombre.",
  inputSchema: PostInventoryMovementInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const postInventoryMovementTool = { handler, inputSchema: PostInventoryMovementInputSchema };

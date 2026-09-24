// ACTION tool LEVEL 2 — movimiento físico de inventario; nunca dinero.
import { z } from "zod";
import { createHash } from "node:crypto";
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
  cost_currency: z.string().trim().min(1).max(8).optional().nullable(),
  unit_cost: z.number().finite().optional().nullable(),
  exchange_rate_to_company: z.number().positive().finite().optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
}).strict();

export type PostInventoryMovementInput = z.infer<typeof PostInventoryMovementInputSchema>;
export interface PostInventoryMovementOutput { movement_id: string; movement_type: InventoryMovementType; quantity: number; message: string }

export function createRodrigoMovementIdempotencyKey(
  empresaId: string,
  taskId: string,
  input: PostInventoryMovementInput,
) {
  const fingerprint = JSON.stringify([
    empresaId,
    taskId,
    input.producto_id,
    input.quantity,
    input.unit.trim(),
    input.movement_type,
    input.from_location_id ?? null,
    input.to_location_id ?? null,
    input.project_id ?? null,
    input.cost_currency ?? null,
    input.unit_cost ?? null,
    input.exchange_rate_to_company ?? null,
    input.reason?.trim() ?? null,
  ]);
  const hex = createHash("sha256").update(fingerprint).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const key = hex.join("");
  return `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
}

async function handler(ctx: AgentToolContext, input: PostInventoryMovementInput, deps: { db: SupabaseClient }): Promise<PostInventoryMovementOutput> {
  if (!ctx.approvalId || !ctx.taskId) throw new Error("El movimiento de Rodrigo requiere una aprobación y tarea identificables.");
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

  const idempotencyKey = createRodrigoMovementIdempotencyKey(ctx.empresaId, ctx.taskId, input);
  const result = await postManualInventoryMovement(deps.db, {
    empresaId: ctx.empresaId,
    productoId: input.producto_id,
    quantity: input.quantity,
    unit: input.unit,
    movementType: input.movement_type,
    fromLocationId: input.from_location_id ?? null,
    toLocationId: input.to_location_id ?? null,
    projectId: input.project_id ?? null,
    sourceType: "MANUAL",
    sourceId: idempotencyKey,
    idempotencyKey,
    costCurrency: input.cost_currency ?? null,
    unitCost: input.unit_cost ?? null,
    exchangeRateToCompany: input.exchange_rate_to_company ?? null,
    createdBy: ctx.userId,
    metadata: { source: "rodrigo", reason: input.reason?.trim() ?? null },
  });
  if (result.error || !result.data) throw new Error(`No se pudo registrar el movimiento de inventario: ${result.error ?? "respuesta sin id"}`);
  return { movement_id: result.data, movement_type: input.movement_type, quantity: input.quantity, message: "Movimiento de inventario registrado." };
}

registerTool<PostInventoryMovementInput, PostInventoryMovementOutput>({
  name: "post_inventory_movement",
  description:
    "Registra una transferencia, devolución o ajuste de inventario por el servicio canónico, con aprobación humana e idempotencia estable por tarea y solicitud. No registra recepciones ni consumos: usar manage_inventory_operation para esos flujos. Nunca mueve dinero.",
  inputSchema: PostInventoryMovementInputSchema,
  riskLevel: 2,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const postInventoryMovementTool = { handler, inputSchema: PostInventoryMovementInputSchema };

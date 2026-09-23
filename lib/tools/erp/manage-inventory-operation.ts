import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

const receiptItem = z.object({
  order_item_id: z.string().uuid(),
  producto_id: z.string().uuid().optional().nullable(),
  quantity: z.number().positive().finite(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export const ManageInventoryOperationInputSchema = z.object({
  operation: z.enum(["create_receipt", "confirm_receipt", "create_location", "create_portal_link", "process_submission", "confirm_submission", "update_submission_line"]),
  order_id: z.string().uuid().optional(),
  receipt_id: z.string().uuid().optional(),
  submission_id: z.string().uuid().optional(),
  line_id: z.string().uuid().optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  recibido_por: z.string().trim().max(200).optional(),
  delivery_location_id: z.string().uuid().optional(),
  remision_number: z.string().trim().max(100).optional().nullable(),
  idempotency_key: z.string().trim().min(1).max(180).optional(),
  items: z.array(receiptItem).optional(),
  location_id: z.string().uuid().optional(),
  location_name: z.string().trim().max(200).optional(),
  location_type: z.enum(["CENTRAL", "PROJECT", "AUXILIARY"]).optional(),
  project_id: z.string().uuid().optional().nullable(),
  parent_location_id: z.string().uuid().optional().nullable(),
  is_primary: z.boolean().optional(),
  expires_at: z.string().datetime().optional().nullable(),
  producto_id: z.string().uuid().optional().nullable(),
  quantity: z.number().positive().finite().optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  budget_item_id: z.string().uuid().optional().nullable(),
  state: z.enum(["PROPOSED", "CONFIRMED", "REJECTED"]).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
}).superRefine((value, ctx) => {
  const required: Record<string, keyof typeof value> = {
    create_receipt: "order_id",
    confirm_receipt: "receipt_id",
    create_location: "location_name",
    create_portal_link: "location_id",
    process_submission: "submission_id",
    confirm_submission: "submission_id",
    update_submission_line: "line_id",
  };
  const key = required[value.operation];
  if (key && (value[key] === undefined || value[key] === null || value[key] === "")) {
    ctx.addIssue({ code: "custom", path: [key], message: `${String(key)} es obligatorio para ${value.operation}.` });
  }
});
export type ManageInventoryOperationInput = z.infer<typeof ManageInventoryOperationInputSchema>;

function requireField<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null || value === "") throw new Error(`Falta ${label}.`);
  return value;
}

async function handler(_ctx: AgentToolContext, input: ManageInventoryOperationInput, _deps: { db: SupabaseClient }): Promise<Record<string, unknown>> {
  const actions = await import("@/app/(internal)/inventory/actions");
  let result: unknown;
  switch (input.operation) {
    case "create_receipt":
      result = await actions.createCanonicalReceipt({
        orderId: requireField(input.order_id, "order_id"),
        fecha: requireField(input.fecha, "fecha"),
        recibidoPor: requireField(input.recibido_por, "recibido_por"),
        deliveryLocationId: requireField(input.delivery_location_id, "delivery_location_id"),
        remisionNumber: input.remision_number,
        idempotencyKey: requireField(input.idempotency_key, "idempotency_key"),
        items: (input.items ?? []).map((row) => ({ orderItemId: row.order_item_id, productoId: row.producto_id, quantity: row.quantity, notes: row.notes })),
        notes: input.notes,
      });
      break;
    case "confirm_receipt":
      result = await actions.confirmCanonicalReceipt({ receiptId: requireField(input.receipt_id, "receipt_id"), deliveryLocationId: input.delivery_location_id, idempotencyKey: input.idempotency_key });
      break;
    case "create_location":
      result = await actions.createInventoryLocation({
        name: requireField(input.location_name, "location_name"),
        locationType: requireField(input.location_type, "location_type"),
        projectId: input.project_id,
        parentLocationId: input.parent_location_id,
        isPrimary: input.is_primary,
      });
      break;
    case "create_portal_link": {
      const raw = await actions.createWarehousePortalLink(requireField(input.location_id, "location_id"), input.expires_at);
      const safe = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const linkCreated = typeof safe.url === "string" && safe.url.length > 0;
      result = {
        error: safe.error ?? null,
        portal_link_created: linkCreated,
        message: linkCreated ? "Enlace creado; por seguridad, el token no se expone en el chat. Consultalo desde Inventario." : null,
      };
      break;
    }
    case "process_submission":
      result = await actions.processWarehouseSubmission(requireField(input.submission_id, "submission_id"));
      break;
    case "confirm_submission":
      result = await actions.confirmCanonicalWarehouseSubmission({ submissionId: requireField(input.submission_id, "submission_id"), idempotencyKey: input.idempotency_key });
      break;
    case "update_submission_line":
      result = await actions.updateWarehouseSubmissionLine({
        lineId: requireField(input.line_id, "line_id"),
        productoId: input.producto_id,
        quantity: input.quantity,
        unit: input.unit,
        budgetItemId: input.budget_item_id,
        state: requireField(input.state, "state"),
        notes: input.notes,
      });
      break;
  }
  const output: Record<string, unknown> = { operation: input.operation, ...actionResult(result) };
  if (input.operation === "create_portal_link") {
    output.message = output.portal_link_created === true
      ? "Enlace creado; por seguridad, el token no se expone en el chat. Consultalo desde Inventario."
      : "No se pudo crear el enlace del portal de depósito.";
  } else {
    output.message = "Operación física de inventario ejecutada; no se movió dinero.";
  }
  return output;
}

registerTool<ManageInventoryOperationInput, Record<string, unknown>>({
  name: "manage_inventory_operation",
  description: "Opera recepciones de OC, ubicaciones, portal de depósito y rendiciones usando el servicio canónico existente. Es inventario físico, no tesorería; requiere aprobación y referencias resueltas.",
  inputSchema: ManageInventoryOperationInputSchema,
  riskLevel: 2,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const manageInventoryOperationTool = { handler, inputSchema: ManageInventoryOperationInputSchema };

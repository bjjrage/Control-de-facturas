import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult, toFormData } from "./action-utils";

const salesItem = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().finite(),
  unit_price: z.number().nonnegative().finite(),
  vat_rate: z.union([z.literal(0), z.literal(5), z.literal(10)]),
});
export const ManageSalesDocumentInputSchema = z.object({
  operation: z.enum(["create", "update", "emit"]),
  id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  doc_type: z.enum(["PROFORMA", "REMISION", "FACTURA", "NOTA_CREDITO"]).optional(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  currency: z.string().trim().min(1).max(8).optional(),
  notes: z.string().trim().max(3000).optional().nullable(),
  source_document_id: z.string().uuid().optional().nullable(),
  items: z.array(salesItem).min(1).optional(),
});
export type ManageSalesDocumentInput = z.infer<typeof ManageSalesDocumentInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageSalesDocumentInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/ventas/actions");
  let result: unknown;
  if (input.operation === "emit") {
    if (!input.id) throw new Error("Emitir necesita el documento resuelto.");
    result = await actions.emitSalesDocument(input.id);
  } else {
    if (input.operation === "update" && !input.id) throw new Error("Editar necesita el documento resuelto.");
    if (!input.client_id || !input.items?.length) throw new Error("El documento necesita cliente e ítems.");
    result = input.operation === "create"
      ? await actions.createSalesDocument(toFormData({ ...input, items: input.items }))
      : await actions.updateSalesDocument(input.id!, toFormData({ ...input, items: input.items }));
  }
  return { operation: input.operation, id: input.id ?? null, ...actionResult(result), message: "Documento comercial procesado por el ERP." };
}

registerTool<ManageSalesDocumentInput, Record<string, unknown>>({
  name: "manage_sales_document",
  description: "Crea, edita o emite documentos comerciales reales (cotización/proforma, remisión, factura o nota de crédito) usando las acciones existentes. No registra cobros ni toca tesorería; requiere aprobación.",
  inputSchema: ManageSalesDocumentInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageSalesDocumentTool = { handler, inputSchema: ManageSalesDocumentInputSchema };

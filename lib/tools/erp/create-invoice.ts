import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult, toFormData } from "./action-utils";

export const CreateInvoiceInputSchema = z.object({
  provider_id: z.string().uuid(),
  invoice_number: z.string().trim().min(1).max(100),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  currency: z.string().trim().min(1).max(8),
  exchange_rate: z.number().positive().finite().optional().nullable(),
  subtotal: z.number().nonnegative().finite().optional().nullable(),
  vat: z.number().nonnegative().finite().optional().nullable(),
  total: z.number().positive().finite(),
  timbrado: z.string().trim().max(80).optional().nullable(),
  observations: z.string().trim().max(3000).optional().nullable(),
  scanner_session_id: z.string().uuid().optional().nullable(),
});
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceInputSchema>;

async function handler(_ctx: AgentToolContext, input: CreateInvoiceInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/invoices/actions");
  const result = await actions.createInvoice(toFormData(input));
  return { operation: "create", ...actionResult(result), message: "Factura registrada por el ERP; no se creó ningún pago." };
}

registerTool<CreateInvoiceInput, Record<string, unknown>>({
  name: "create_invoice",
  description: "Registra una factura de proveedor real y opcionalmente la vincula a una sesión de scanner completada. No crea órdenes de pago ni movimientos de tesorería; requiere aprobación.",
  inputSchema: CreateInvoiceInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const createInvoiceTool = { handler, inputSchema: CreateInvoiceInputSchema };

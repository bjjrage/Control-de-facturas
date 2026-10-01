// MUTATION tool LEVEL 2 — operaciones existentes de factura de proveedor.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

export const ManageSupplierInvoiceInputSchema = z.object({
  operation: z.enum(["link_order", "unmatch_order", "delete"]),
  invoice_id: z.string().uuid(),
  authorized_order_id: z.string().uuid().optional(),
  match_id: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if (value.operation === "link_order" && !value.authorized_order_id) {
    ctx.addIssue({ code: "custom", path: ["authorized_order_id"], message: "authorized_order_id es obligatorio para link_order." });
  }
  if (value.operation === "unmatch_order" && (!value.match_id || !value.authorized_order_id)) {
    ctx.addIssue({ code: "custom", path: ["match_id"], message: "match_id y authorized_order_id son obligatorios para unmatch_order." });
  }
});
export type ManageSupplierInvoiceInput = z.infer<typeof ManageSupplierInvoiceInputSchema>;

async function handler(ctx: AgentToolContext, input: ManageSupplierInvoiceInput, deps: { db: SupabaseClient }) {
  const { data: invoice, error: invoiceError } = await deps.db
    .from("invoices")
    .select("id, status")
    .eq("id", input.invoice_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (invoiceError) throw new Error(`No se pudo validar la factura: ${invoiceError.message}`);
  if (!invoice) throw new Error("La factura no existe o no pertenece a tu empresa.");

  if (input.operation === "link_order") {
    const { data: order, error: orderError } = await deps.db
      .from("authorized_orders")
      .select("id")
      .eq("id", input.authorized_order_id!)
      .eq("empresa_id", ctx.empresaId)
      .maybeSingle();
    if (orderError) throw new Error(`No se pudo validar la orden: ${orderError.message}`);
    if (!order) throw new Error("La orden no existe o no pertenece a tu empresa.");
  }

  if (input.operation === "unmatch_order") {
    const { data: match, error: matchError } = await deps.db
      .from("invoice_order_matches")
      .select("id, invoice_id, authorized_order_id")
      .eq("id", input.match_id!)
      .eq("invoice_id", input.invoice_id)
      .maybeSingle();
    if (matchError) throw new Error(`No se pudo validar el vínculo: ${matchError.message}`);
    if (!match || match.authorized_order_id !== input.authorized_order_id) throw new Error("El vínculo no corresponde a la factura resuelta.");
  }

  const actions = await import("@/app/(internal)/invoices/actions");
  let result: unknown;
  if (input.operation === "link_order") {
    result = await actions.linkInvoiceToOrder(input.invoice_id, input.authorized_order_id!);
  } else if (input.operation === "unmatch_order") {
    result = await (await import("@/app/(internal)/invoices/[id]/actions")).unmatchOrder(input.invoice_id, input.match_id!, input.authorized_order_id!);
  } else {
    result = await (await import("@/app/(internal)/invoices/[id]/actions")).deleteInvoice(input.invoice_id);
  }
  return { operation: input.operation, invoice_id: input.invoice_id, ...actionResult(result), message: "Factura de proveedor procesada; no se ejecutó ningún pago." };
}

registerTool<ManageSupplierInvoiceInput, Record<string, unknown>>({
  name: "manage_supplier_invoice",
  description: "Vincula o desvincula una factura de proveedor con una OC, o elimina una factura usando acciones reales del ERP. No edita pagos, no crea órdenes de pago y siempre requiere aprobación.",
  inputSchema: ManageSupplierInvoiceInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageSupplierInvoiceTool = { handler, inputSchema: ManageSupplierInvoiceInputSchema };

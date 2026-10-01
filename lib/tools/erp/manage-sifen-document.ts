// MUTATION tool LEVEL 2 — usa la integración SIFEN/Goekua ya existente.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

export const ManageSifenDocumentInputSchema = z.object({
  operation: z.enum(["emit_invoice", "emit_credit_note", "refresh_status"]),
  document_id: z.string().uuid(),
});
export type ManageSifenDocumentInput = z.infer<typeof ManageSifenDocumentInputSchema>;

async function handler(ctx: AgentToolContext, input: ManageSifenDocumentInput, deps: { db: SupabaseClient }) {
  const { data: document, error } = await deps.db
    .from("sales_documents")
    .select("id, doc_type")
    .eq("id", input.document_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo validar el documento SIFEN: ${error.message}`);
  if (!document) throw new Error("El documento no existe o no pertenece a tu empresa.");

  const actions = await import("@/app/(internal)/ventas/sifen-actions");
  const result = input.operation === "emit_invoice"
    ? await actions.emitirFE(input.document_id)
    : input.operation === "emit_credit_note"
      ? await actions.emitirNC(input.document_id)
      : await actions.consultarFE(input.document_id);
  return { operation: input.operation, document_id: input.document_id, ...actionResult(result), message: "Operación SIFEN/Goekua procesada; requiere aprobación y no toca tesorería." };
}

registerTool<ManageSifenDocumentInput, Record<string, unknown>>({
  name: "manage_sifen_document",
  description: "Emite una factura/nota de crédito o refresca el estado SIFEN usando la integración Goekua real ya existente. Es una operación externa o persistente y requiere aprobación; no presenta ofertas DNCP.",
  inputSchema: ManageSifenDocumentInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageSifenDocumentTool = { handler, inputSchema: ManageSifenDocumentInputSchema };

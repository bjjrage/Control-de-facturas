import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

const documentFields = z.object({
  tipo: z.string().trim().min(1).max(200).optional(),
  descripcion: z.string().trim().max(2000).optional().nullable(),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notas: z.string().trim().max(3000).optional().nullable(),
});
export const ManageCompanyDocumentInputSchema = z.object({
  operation: z.enum(["create", "update", "delete"]),
  id: z.string().uuid().optional(),
  fields: documentFields.default({}),
});
export type ManageCompanyDocumentInput = z.infer<typeof ManageCompanyDocumentInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageCompanyDocumentInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/licitaciones/documentos/actions");
  if (input.operation !== "create" && !input.id) throw new Error("La operación necesita el documento resuelto.");
  if (input.operation === "create" && !input.fields.tipo) throw new Error("El documento necesita tipo.");
  const fields = {
    ...input.fields,
    tipo: input.fields.tipo ?? "",
    descripcion: input.fields.descripcion ?? undefined,
    fecha_emision: input.fields.fecha_emision ?? undefined,
    fecha_vencimiento: input.fields.fecha_vencimiento ?? undefined,
    notas: input.fields.notas ?? undefined,
  };
  const result = input.operation === "create"
    ? await actions.crearDocumentoEmpresa(fields)
    : input.operation === "update"
      ? await actions.actualizarDocumentoEmpresa(input.id!, fields)
      : await actions.eliminarDocumentoEmpresa(input.id!);
  return { operation: input.operation, id: input.id ?? null, ...actionResult(result), message: "Documento empresarial actualizado en la fuente canónica." };
}

registerTool<ManageCompanyDocumentInput, Record<string, unknown>>({
  name: "manage_company_document",
  description: "Crea, edita o elimina metadatos de documentos de empresa y sincroniza su proyección de licitaciones usando las acciones reales. No inventa adjuntos binarios; requiere aprobación.",
  inputSchema: ManageCompanyDocumentInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageCompanyDocumentTool = { handler, inputSchema: ManageCompanyDocumentInputSchema };

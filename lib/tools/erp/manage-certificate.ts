import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult, toFormData } from "./action-utils";

export const ManageCertificateInputSchema = z.object({
  operation: z.enum(["create", "update_item", "submit", "verify", "approve"]),
  project_id: z.string().uuid().optional(),
  certificate_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  qty_anterior: z.number().nonnegative().finite().optional(),
  qty_presente: z.number().nonnegative().finite().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ManageCertificateInput = z.infer<typeof ManageCertificateInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageCertificateInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/certificado-actions");
  let result: unknown;
  if (input.operation === "create") {
    if (!input.project_id || !input.period_start || !input.period_end) throw new Error("Crear certificado necesita obra y período.");
    result = await actions.createCertificate(input.project_id, toFormData({ period_start: input.period_start, period_end: input.period_end, notes: input.notes }));
  } else if (input.operation === "update_item") {
    if (!input.item_id) throw new Error("Editar una línea necesita item_id.");
    result = await actions.updateCertificateItem(input.item_id, { qty_anterior: input.qty_anterior, qty_presente: input.qty_presente });
  } else {
    if (!input.certificate_id) throw new Error("La transición necesita certificate_id.");
    result = input.operation === "submit"
      ? await actions.submitCertificate(input.certificate_id)
      : input.operation === "verify"
        ? await actions.verifyCertificate(input.certificate_id)
        : await actions.approveCertificate(input.certificate_id);
  }
  return { operation: input.operation, certificate_id: input.certificate_id ?? null, ...actionResult(result), message: "Certificado de obra procesado por el flujo real de estados." };
}

registerTool<ManageCertificateInput, Record<string, unknown>>({
  name: "manage_certificate",
  description: "Crea y edita certificados de avance en borrador y ejecuta las transiciones Elaborado/Verificado/Aprobado existentes. No factura ni cobra; requiere aprobación.",
  inputSchema: ManageCertificateInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageCertificateTool = { handler, inputSchema: ManageCertificateInputSchema };

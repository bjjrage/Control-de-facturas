// ACTION tool LEVEL 2 — escritura sobre partes/subcontratos/certificados.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult, toFormData } from "./action-utils";

export const ManageLaborSubcontractorInputSchema = z.object({
  operation: z.enum(["add_labor_entry", "add_subcontractor_contract", "approve_subcontractor_certificate", "reject_subcontractor_certificate"]),
  project_id: z.string().uuid().optional(),
  certificate_id: z.string().uuid().optional(),
  approved_pct: z.number().positive().max(100).optional(),
  approved_amount: z.number().positive().optional(),
  worker_name: z.string().trim().max(200).optional(),
  hours: z.number().positive().finite().optional(),
  hourly_cost: z.number().nonnegative().finite().optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  task_description: z.string().trim().max(1000).optional().nullable(),
  subcontractor_id: z.string().uuid().optional().nullable(),
  new_subcontractor_name: z.string().trim().max(200).optional(),
  new_subcontractor_ruc: z.string().trim().max(40).optional().nullable(),
  new_subcontractor_contact: z.string().trim().max(200).optional().nullable(),
  new_subcontractor_phone: z.string().trim().max(80).optional().nullable(),
  new_subcontractor_specialty: z.string().trim().max(200).optional().nullable(),
  budget_item_id: z.string().uuid().optional().nullable(),
  contracted_amount: z.number().positive().optional(),
  retention_pct: z.number().nonnegative().max(100).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  signed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ManageLaborSubcontractorInput = z.infer<typeof ManageLaborSubcontractorInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageLaborSubcontractorInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/caterpillar-actions");
  let result: unknown;
  switch (input.operation) {
    case "add_labor_entry":
      if (!input.project_id || !input.worker_name || !input.hours) throw new Error("El parte necesita obra, trabajador y horas.");
      result = await actions.addLaborEntry(input.project_id, toFormData({ worker_name: input.worker_name, hours: input.hours, hourly_cost: input.hourly_cost ?? 0, entry_date: input.entry_date, task_description: input.task_description }));
      break;
    case "add_subcontractor_contract":
      if (!input.project_id || !input.contracted_amount) throw new Error("El contrato necesita obra y monto contratado.");
      result = await actions.addSubcontractorContract(input.project_id, toFormData({ subcontractor_id: input.subcontractor_id, new_subcontractor_name: input.new_subcontractor_name, new_subcontractor_ruc: input.new_subcontractor_ruc, new_subcontractor_contact: input.new_subcontractor_contact, new_subcontractor_phone: input.new_subcontractor_phone, new_subcontractor_specialty: input.new_subcontractor_specialty, budget_item_id: input.budget_item_id, contracted_amount: input.contracted_amount, retention_pct: input.retention_pct ?? 5, description: input.description, signed_date: input.signed_date }));
      break;
    case "approve_subcontractor_certificate":
      if (!input.certificate_id || !input.approved_pct || !input.approved_amount) throw new Error("Aprobar un certificado necesita certificado, porcentaje y monto.");
      result = await actions.approveCertificate(input.certificate_id, input.approved_pct, input.approved_amount, input.notes ?? null);
      break;
    case "reject_subcontractor_certificate":
      if (!input.certificate_id) throw new Error("Rechazar un certificado necesita certificate_id.");
      result = await actions.rejectCertificate(input.certificate_id, input.notes ?? null);
      break;
  }
  return { operation: input.operation, ...actionResult(result), message: "Mutación de personal/subcontrato ejecutada por el dominio real; no mueve dinero." };
}

registerTool({
  name: "manage_labor_subcontractor",
  description: "Registra partes, crea contratos/asociaciones de subcontratistas y aprueba o rechaza certificados reales. Requiere aprobación humana y nunca mueve dinero.",
  inputSchema: ManageLaborSubcontractorInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageLaborSubcontractorTool = { handler, inputSchema: ManageLaborSubcontractorInputSchema };

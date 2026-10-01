// READ tool LEVEL 0 — partes, subcontratos y personal realmente registrado.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetLaborSubcontractorOverviewInputSchema = z.object({
  project_id: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(100),
});
export type GetLaborSubcontractorOverviewInput = z.infer<typeof GetLaborSubcontractorOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetLaborSubcontractorOverviewInput, deps: { db: SupabaseClient }) {
  const { db } = deps;
  const { data: project, error: projectError } = await db
    .from("projects")
    .select("id, name, code")
    .eq("id", input.project_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (projectError) throw new Error(`Error leyendo la obra: ${projectError.message}`);
  if (!project) throw new Error("La obra no existe o no pertenece a tu empresa.");

  const [certificateRows, labor, contracts, certificates] = await Promise.all([
    db.from("project_certificates").select("id").eq("project_id", input.project_id),
    db.from("daily_labor_entries").select("id, entry_date, worker_name, hours, hourly_cost, labor_cost, task_description, created_at").eq("project_id", input.project_id).order("entry_date", { ascending: false }).limit(input.limit),
    db.from("subcontractor_contracts").select("id, subcontractor_id, budget_item_id, contracted_amount, retention_pct, description, signed_date, status, created_at").eq("project_id", input.project_id).order("created_at", { ascending: false }).limit(input.limit),
    db.from("subcontractor_certificates").select("id, contract_id, claimed_pct, claimed_amount, approved_pct, approved_amount, status, notes, created_at").eq("project_id", input.project_id).order("created_at", { ascending: false }).limit(input.limit),
  ]);
  if (certificateRows.error) throw new Error(`Error leyendo certificados de la obra: ${certificateRows.error.message}`);
  const certificateIds = (certificateRows.data ?? []).map((row) => row.id);
  const staff = certificateIds.length
    ? await db.from("project_certificate_staff").select("id, certificate_id, nombre, rol, created_at").in("certificate_id", certificateIds).limit(input.limit)
    : { data: [], error: null };
  for (const result of [labor, contracts, certificates, staff]) {
    if (result.error) throw new Error(`Error leyendo personal/subcontratos: ${result.error.message}`);
  }

  const subcontractorIds = [...new Set((contracts.data ?? []).map((row) => row.subcontractor_id).filter(Boolean))];
  const subcontractors = subcontractorIds.length
    ? await db.from("subcontractors").select("id, name, ruc, contact_name, contact_phone, specialty").eq("empresa_id", ctx.empresaId).in("id", subcontractorIds)
    : { data: [], error: null };
  if (subcontractors.error) throw new Error(`Error leyendo subcontratistas: ${subcontractors.error.message}`);

  return {
    project,
    labor_entries: labor.data ?? [],
    subcontractors: subcontractors.data ?? [],
    contracts: contracts.data ?? [],
    subcontractor_certificates: certificates.data ?? [],
    certificate_staff: staff.data ?? [],
  };
}

registerTool({
  name: "get_labor_subcontractor_overview",
  description: "Lee partes de personal, subcontratistas, contratos, certificados de subcontratistas y cuadrilla declarada en certificados de una obra. Solo devuelve filas reales tenant-scoped.",
  inputSchema: GetLaborSubcontractorOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getLaborSubcontractorOverviewTool = { handler, inputSchema: GetLaborSubcontractorOverviewInputSchema };

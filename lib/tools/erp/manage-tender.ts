import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

export const ManageTenderInputSchema = z.object({
  operation: z.enum(["set_decision", "stop_following", "convert_to_project", "prepare_offer_package", "commercial_evaluation", "extract_pbc_requirements", "extract_acta_offers"]),
  tender_id: z.string().uuid(),
  decision: z.enum(["SIN_REVISAR", "DESCARTADA", "EN_PREPARACION", "PRESENTADA", "GANADA", "PERDIDA"]).optional(),
  notes: z.string().trim().max(3000).optional(),
  annual_financing_rate_pct: z.number().finite().optional(),
  proposed_offer_amount_pyg: z.number().positive().finite().optional(),
  estimated_indirect_cost_pyg: z.number().nonnegative().finite().optional(),
  analysis_mode: z.enum(["PRE_BID", "POST_OPENING", "LIVE_SBE"]).optional(),
  expected_participants_count: z.number().int().nonnegative().optional(),
  pbc_text: z.string().min(1).max(200000).optional(),
  acta_text: z.string().min(1).max(200000).optional(),
  source: z.enum(["ACTA_PDF", "CUADRO_PDF", "MANUAL"]).optional(),
});
export type ManageTenderInput = z.infer<typeof ManageTenderInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageTenderInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/licitaciones/actions");
  let result: unknown;
  switch (input.operation) {
    case "set_decision":
      if (!input.decision) throw new Error("La decisión es obligatoria.");
      result = await actions.setLicitacionDecision(input.tender_id, input.decision, input.notes);
      break;
    case "stop_following":
      result = await actions.dejarDeSeguirLicitacion(input.tender_id);
      break;
    case "convert_to_project":
      result = await actions.convertirLicitacionAProyecto(input.tender_id);
      break;
    case "prepare_offer_package":
      result = await actions.generarPliegoOfertaCompleto(input.tender_id);
      break;
    case "commercial_evaluation":
      result = await actions.persistirEvaluacionComercial(input.tender_id, {
        annualFinancingRatePct: input.annual_financing_rate_pct,
        proposedOfferAmountPyg: input.proposed_offer_amount_pyg,
        estimatedIndirectCostPyg: input.estimated_indirect_cost_pyg,
        analysisMode: input.analysis_mode,
        expectedParticipantsCount: input.expected_participants_count,
      });
      break;
    case "extract_pbc_requirements":
      result = await actions.extraerRequisitosDePliego(input.tender_id, input.pbc_text ?? "");
      break;
    case "extract_acta_offers":
      result = await actions.extraerOfertasDeActa(input.tender_id, input.acta_text ?? "", input.source);
      break;
  }
  return { operation: input.operation, tender_id: input.tender_id, ...actionResult(result), message: "Operación de licitación procesada por el dominio real." };
}

registerTool<ManageTenderInput, Record<string, unknown>>({
  name: "manage_tender",
  description: "Decide, prepara y convierte licitaciones usando las acciones reales DNCP del ERP; también extrae requisitos/ofertas de texto y guarda evaluación comercial. No envía automáticamente una oferta a DNCP; requiere aprobación.",
  inputSchema: ManageTenderInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageTenderTool = { handler, inputSchema: ManageTenderInputSchema };

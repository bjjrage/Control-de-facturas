// READ tool LEVEL 0 — licitación, documentos y ofertas existentes.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetTenderOverviewInputSchema = z.object({ tender_id: z.string().uuid() });
export type GetTenderOverviewInput = z.infer<typeof GetTenderOverviewInputSchema>;

export interface GetTenderOverviewOutput {
  tender: Record<string, unknown>;
  lots: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  offers: Array<Record<string, unknown>>;
  tender_documents: Array<Record<string, unknown>>;
  company_documents: Array<Record<string, unknown>>;
}

async function handler(ctx: AgentToolContext, input: GetTenderOverviewInput, deps: { db: SupabaseClient }): Promise<GetTenderOverviewOutput> {
  const { data: tender, error: tenderError } = await deps.db
    .from("licitaciones")
    .select("id, empresa_id, dncp_nro, ocid, titulo, comitente_nombre, categoria, categoria_detalle, procurement_method_detalle, award_criteria_detalle, monto_referencial, monto_disponible, moneda, fecha_publicacion, fecha_consultas_fin, fecha_entrega_ofertas, fecha_apertura, lugar_apertura, estado, estado_detalle, invitada, decision, decision_notas, project_id")
    .eq("id", input.tender_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (tenderError) throw new Error(`Error leyendo licitación: ${tenderError.message}`);
  if (!tender) throw new Error("La licitación no existe o no pertenece a tu empresa.");

  const [lots, items, offers, documents] = await Promise.all([
    deps.db.from("licitacion_lotes").select("id, numero, titulo, monto_referencial").eq("licitacion_id", input.tender_id).eq("empresa_id", ctx.empresaId),
    deps.db.from("licitacion_items").select("id, lote_id, codigo_catalogo, codigo_unspsc, descripcion, cantidad, unidad, precio_unitario_referencial").eq("licitacion_id", input.tender_id).eq("empresa_id", ctx.empresaId),
    deps.db.from("licitacion_oferentes").select("id, ruc, nombre, monto_ofertado, gano, lotes_ganados, fuente").eq("licitacion_id", input.tender_id).eq("empresa_id", ctx.empresaId),
    deps.db.from("licitacion_documentos").select("id, tipo, tipo_detalle, titulo, url_dncp, storage_path, descargado_at").eq("licitacion_id", input.tender_id).eq("empresa_id", ctx.empresaId),
  ]);
  for (const result of [lots, items, offers, documents]) if (result.error) throw new Error(`Error leyendo detalle de licitación: ${result.error.message}`);

  const { data: companyDocuments, error: companyDocumentsError } = await deps.db
    .from("empresa_documentos")
    .select("id, tipo, descripcion, storage_path, fecha_emision, fecha_vencimiento, notas")
    .eq("empresa_id", ctx.empresaId)
    .order("fecha_vencimiento", { ascending: true, nullsFirst: false });
  if (companyDocumentsError) throw new Error(`Error leyendo documentos de empresa: ${companyDocumentsError.message}`);

  return {
    tender: tender as Record<string, unknown>,
    lots: (lots.data ?? []) as Array<Record<string, unknown>>,
    items: (items.data ?? []) as Array<Record<string, unknown>>,
    offers: (offers.data ?? []) as Array<Record<string, unknown>>,
    tender_documents: (documents.data ?? []) as Array<Record<string, unknown>>,
    company_documents: (companyDocuments ?? []) as Array<Record<string, unknown>>,
  };
}

registerTool<GetTenderOverviewInput, GetTenderOverviewOutput>({
  name: "get_tender_overview",
  description:
    "Lee una licitación real por su referencia humana ya resuelta: convocatoria, lotes, ítems, oferentes, documentos pedidos/descargados y documentos disponibles de la empresa. No inventa requisitos ni presenta una oferta.",
  inputSchema: GetTenderOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getTenderOverviewTool = { handler, inputSchema: GetTenderOverviewInputSchema };

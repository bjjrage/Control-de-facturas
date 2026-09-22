// READ tool LEVEL 0 — estado SIFEN/Goekua ya persistido en ventas.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { isGoekuaConfigured } from "@/lib/goekua";

export const GetSifenOverviewInputSchema = z.object({
  document_id: z.string().uuid().optional().nullable(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type GetSifenOverviewInput = z.infer<typeof GetSifenOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetSifenOverviewInput, deps: { db: SupabaseClient }) {
  let query = deps.db
    .from("sales_documents")
    .select("id, code, doc_type, issue_date, currency, total, status, cdc, xml_url, kude_url, created_at, updated_at")
    .eq("empresa_id", ctx.empresaId)
    .order("issue_date", { ascending: false })
    .limit(input.limit);
  if (input.document_id) query = query.eq("id", input.document_id);
  const { data, error } = await query;
  if (error) throw new Error(`Error leyendo estado SIFEN: ${error.message}`);
  return { provider: "Goekua", configured: isGoekuaConfigured(), documents: data ?? [], formal_submission_from_rodrigo: false };
}

registerTool({
  name: "get_sifen_overview",
  description: "Lee el estado SIFEN/Goekua persistido en documentos de venta: CDC, XML, KuDE y estado de configuración. No crea una integración nueva ni emite por sí solo.",
  inputSchema: GetSifenOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getSifenOverviewTool = { handler, inputSchema: GetSifenOverviewInputSchema };

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { loadRfqWorkspace } from "@/lib/rfq/service";
export const GetRfqResponsesInputSchema=z.object({rfq_id:z.string().uuid()});
export type GetRfqResponsesInput=z.infer<typeof GetRfqResponsesInputSchema>;
async function handler(ctx:AgentToolContext,input:GetRfqResponsesInput,deps:{db:SupabaseClient}) {
 const w=await loadRfqWorkspace(deps.db,ctx.empresaId,input.rfq_id);
 return {rfq_id:input.rfq_id,respuestas:w.offers,total_respuestas:new Set(w.offers.map(o=>o.quote_version_id)).size,history:w.history,
  resumen_precios:{by_currency:[...new Set(w.offers.map(o=>o.currency))].map(currency=>{const prices=w.offers.filter(o=>o.currency===currency&&o.precio_unitario!==null).map(o=>o.precio_unitario!);return {currency,precio_minimo:prices.length?Math.min(...prices):null,precio_maximo:prices.length?Math.max(...prices):null};}),fx_applied:false}};
}
export type GetRfqResponsesOutput=Awaited<ReturnType<typeof handler>>;
registerTool({name:"get_rfq_responses",description:"Lee ofertas vigentes e historial desde quotes/quote_versions/quote_version_items. Market signals, sin conversión FX inventada.",inputSchema:GetRfqResponsesInputSchema,riskLevel:0,requiredRoles:null,handler});
export const getRfqResponsesTool={handler,inputSchema:GetRfqResponsesInputSchema};

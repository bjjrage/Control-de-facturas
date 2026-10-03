import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { loadRfqWorkspace } from "@/lib/rfq/service";
export const GetRfqInputSchema=z.object({rfq_id:z.string().uuid()});
export type GetRfqInput=z.infer<typeof GetRfqInputSchema>;
async function handler(ctx:AgentToolContext,input:GetRfqInput,deps:{db:SupabaseClient}) {
 const w=await loadRfqWorkspace(deps.db,ctx.empresaId,input.rfq_id);
 return {rfq:w.rfq,items:w.items,suppliers_invited:w.providers.map(p=>({supplier_id:p.provider_id,nombre:p.providers?.name,estado_respuesta:p.status})),created_at:w.rfq.created_at};
}
export type GetRfqOutput=Awaited<ReturnType<typeof handler>>;
registerTool({name:"get_rfq",description:"Lee RFQ, propósito explícito, ítems y proveedores del modelo canónico de la empresa.",inputSchema:GetRfqInputSchema,riskLevel:0,requiredRoles:null,handler});
export const getRfqTool={handler,inputSchema:GetRfqInputSchema};

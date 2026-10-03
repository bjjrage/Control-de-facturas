import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { loadRfqWorkspace } from "@/lib/rfq/service";
import { proposeAllocations } from "@/lib/rfq/domain";
export const PreparePurchaseOrderInputSchema=z.object({rfq_id:z.string().uuid(),selected_supplier_id:z.string().uuid()});
export type PreparePurchaseOrderInput=z.infer<typeof PreparePurchaseOrderInputSchema>;
async function handler(ctx:AgentToolContext,input:PreparePurchaseOrderInput,deps:{db:SupabaseClient}) {
 const w=await loadRfqWorkspace(deps.db,ctx.empresaId,input.rfq_id);
 if(w.rfq.purpose!=="PROCUREMENT")throw new Error("Esta RFQ no permite compra");
 if(!w.providers.some(p=>p.provider_id===input.selected_supplier_id))throw new Error("Proveedor no participante");
 return {rfq_id:input.rfq_id,proposals:proposeAllocations(w.items,w.offers.filter(o=>o.provider_id===input.selected_supplier_id)),
  decision:false,orders_created:0,human_workflow_url:'/rfqs/'+input.rfq_id,message:"Propuesta solamente: guardar asignación, autorizar, revisar preview y confirmar humanamente"};
}
export type PreparePurchaseOrderOutput=Awaited<ReturnType<typeof handler>>;
registerTool({name:"prepare_purchase_order",description:"Devuelve una propuesta editable sin persistir adjudicación ni OC. El humano completa asignación, autorización, preview y confirmación en RFQ.",inputSchema:PreparePurchaseOrderInputSchema,riskLevel:0,requiredRoles:null,handler});
export const preparePurchaseOrderTool={handler,inputSchema:PreparePurchaseOrderInputSchema};

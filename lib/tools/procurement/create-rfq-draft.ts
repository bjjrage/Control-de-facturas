import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { createCanonicalRfq } from "@/lib/rfq/service";
import { purposeSchema } from "@/lib/rfq/domain";
export const CreateRfqDraftInputSchema=z.object({project_id:z.string().uuid().nullable().optional(),purpose:purposeSchema,
 supplier_ids:z.array(z.string().uuid()).default([]),items:z.array(z.object({description:z.string().trim().min(1),quantity:z.number().finite().positive(),unit:z.string().trim().min(1),producto_id:z.string().uuid().nullable().optional()})).min(1),
 required_by:z.string().optional(),notes:z.string().optional()});
export type CreateRfqDraftInput=z.infer<typeof CreateRfqDraftInputSchema>;
async function handler(ctx:AgentToolContext,input:CreateRfqDraftInput,deps:{db:SupabaseClient}) {
 if(ctx.actorType!=="user" || !ctx.userId)throw new Error("La creación de RFQ requiere intención humana explícita");
 const parsed=CreateRfqDraftInputSchema.parse(input);
 const result=await createCanonicalRfq(deps.db,{purpose:parsed.purpose,project_id:parsed.project_id??null,product:parsed.items.map(i=>i.description).join(', ').slice(0,1000),required_date:parsed.required_by,observations:parsed.notes},
 parsed.items.map(i=>({descripcion:i.description,cantidad:i.quantity,unidad:i.unit,producto_id:i.producto_id??null})),parsed.supplier_ids);
 return {rfq_id:result.id,code:result.code,purpose:parsed.purpose,external_dispatch_performed:false,orders_created:0,message:"RFQ canónica creada por pedido humano; compartir links manualmente"};
}
export type CreateRfqDraftOutput=Awaited<ReturnType<typeof handler>>;
registerTool({name:"create_rfq_draft",description:"Crea RFQ solamente ante pedido humano y purpose explícito COST_DISCOVERY/PROCUREMENT. Nunca deduce propósito ni convierte un faltante MRP automáticamente.",inputSchema:CreateRfqDraftInputSchema,riskLevel:2,requiredRoles:["comercial","administracion","admin"],handler});
export const createRfqDraftTool={handler,inputSchema:CreateRfqDraftInputSchema};

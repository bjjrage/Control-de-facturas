import type { SupabaseClient } from "@supabase/supabase-js";
export interface IssuePurchaseOrderParams {db:SupabaseClient;empresaId:string;userId:string;poDraftId:string;confirmIssuance:boolean;}
export interface IssuePurchaseOrderResult {orderId:string;}
/** Retired agent issuance shortcut. RFQ 2.0 human UI owns authorization and exact preview confirmation. */
export async function issuePurchaseOrderDomainService(_params:IssuePurchaseOrderParams):Promise<IssuePurchaseOrderResult> {
 throw new Error("RFQ 2.0: el agente solo propone. El humano debe autorizar y confirmar el preview exacto en /rfqs; compra directa en /orders.");
}

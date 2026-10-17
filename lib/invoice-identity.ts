import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractedInvoiceFields } from "./invoice-extraction";
export async function persistInvoiceIdentity(db: SupabaseClient, input: {
 invoiceId: string; attachmentId: string; sha256: string; fields: ExtractedInvoiceFields; actorId: string;
}): Promise<{ error: string | null }> {
 const {error}=await db.rpc("register_invoice_identity",{
   p_invoice_id:input.invoiceId,p_attachment_id:input.attachmentId,p_sha256:input.sha256,
   p_tax_id:input.fields.provider_tax_id,p_extracted:input.fields,p_verified_by:input.actorId,
 });
 return {error:error?.message??null};
}

/** Fail closed in application routes as well as the canonical SQL gates. */
export async function requireInvoiceIdentity(db: SupabaseClient, invoiceId: string, empresaId: string): Promise<{ error: string | null }> {
 const [{data: invoice,error: invoiceError},{data: evidence,error: evidenceError}] = await Promise.all([
  db.from("invoices").select("provider_id,attachment_id,invoice_number,currency,total").eq("id",invoiceId).eq("empresa_id",empresaId).maybeSingle(),
  db.from("invoice_identity_evidence").select("provider_id,attachment_id,invoice_number,currency,total").eq("invoice_id",invoiceId).eq("empresa_id",empresaId).maybeSingle(),
 ]);
 if(invoiceError || evidenceError || !invoice || !evidence || !invoice.attachment_id ||
  invoice.provider_id!==evidence.provider_id || invoice.attachment_id!==evidence.attachment_id ||
  invoice.invoice_number!==evidence.invoice_number || invoice.currency!==evidence.currency || Number(invoice.total)!==Number(evidence.total)) {
   return {error:"Verificá el original de la factura antes de vincular una OC o autorizar pagos."};
 }
 return {error:null};
}

"use server";

import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ACCEPTED_INVOICE_FILE_TYPES, MAX_INVOICE_FILE_BYTES, extractInvoiceFieldsFromFile } from "@/lib/invoice-extraction";
import { isReceiptPortalEvidenceSignature, isReceiptPortalDate } from "@/lib/inventory/receipt-portal";
import { proposeReceiptQuantities } from "@/lib/inventory/receipt-document";

export async function readReceiptDocument(orderId: string, form: FormData) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const db = await createClient();
  const order = await db.from("authorized_orders").select("id,code,provider_id").eq("id", orderId).eq("empresa_id", profile.empresa_id).maybeSingle();
  if (order.error || !order.data) return { error: "Orden no encontrada para esta empresa." };
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > MAX_INVOICE_FILE_BYTES || !ACCEPTED_INVOICE_FILE_TYPES.includes(file.type)) return { error: "Subí un PDF, JPG, PNG o WEBP de hasta 20 MB." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isReceiptPortalEvidenceSignature(bytes, file.type)) return { error: "El contenido del archivo no corresponde a su formato." };
  const extracted = await extractInvoiceFieldsFromFile(bytes, file.type, "receipt");
  if (extracted.error || !extracted.data) return { error: extracted.error?.replace(/factura/g, "remito") ?? "No se pudo leer el remito." };
  const lines = await db.from("authorized_order_items").select("id,product,unit").eq("order_id", orderId).eq("empresa_id", profile.empresa_id);
  if (lines.error) return { error: "No se pudieron consultar las líneas de la OC." };
  const proposal = proposeReceiptQuantities(extracted.data, lines.data ?? [], order.data.code);
  if (extracted.data.provider_tax_id) {
    const provider = await db.from("providers").select("tax_id").eq("id", order.data.provider_id).eq("empresa_id", profile.empresa_id).maybeSingle();
    const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
    if (provider.error || !digits(provider.data?.tax_id ?? null) || digits(provider.data?.tax_id ?? null) !== digits(extracted.data.provider_tax_id)) {
      return { error: "El RUC del remito no coincide con el proveedor de la OC. Verificá el documento antes de continuar." };
    }
  }
  return { data: { quantities: proposal.quantities, warnings: proposal.warnings, number: extracted.data.invoice_number?.slice(0, 100) ?? null, date: extracted.data.invoice_date && isReceiptPortalDate(extracted.data.invoice_date) ? extracted.data.invoice_date : null, receivedBy: extracted.data.received_by?.slice(0, 120) ?? null } };
}

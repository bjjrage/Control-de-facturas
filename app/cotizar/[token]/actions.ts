"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { isRfqOpen } from "@/lib/rfq-status";
import { revalidatePath } from "next/cache";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function submitQuote(token: string, formData: FormData) {
  const admin = createAdminClient();

  const { data: rfqProvider } = await admin
    .from("rfq_providers")
    .select("*, rfqs!rfq_providers_rfq_id_fkey(*), providers(name)")
    .eq("token", token)
    .maybeSingle();

  if (!rfqProvider) return { error: "Enlace inválido." };
  const empresaId = (rfqProvider as unknown as { empresa_id: string }).empresa_id;
  const rfq = (rfqProvider as unknown as { rfqs: { id: string; quantity: number; status: "BORRADOR" | "COTIZANDO" | "OFERTAS_RECIBIDAS" | "AUTORIZADO" | "CANCELADO"; expires_at: string } }).rfqs;
  const providerName = (rfqProvider as unknown as { providers: { name: string } }).providers.name;

  if (!isRfqOpen(rfq)) {
    return { error: "Esta solicitud ya venció o fue cerrada — contactá a la empresa si querés cotizar igual." };
  }

  const budgetNumber = str(formData, "budget_number");
  const unitPrice = Number(formData.get("unit_price"));
  // El total es siempre unitario × cantidad de la solicitud — no se confía en
  // lo que mande el cliente.
  const totalPrice = Number.isFinite(unitPrice) ? Math.round(unitPrice * rfq.quantity * 100) / 100 : NaN;
  const currency = str(formData, "currency");
  const deliveryTimeValue = formData.get("delivery_time_value");
  const deliveryTimeUnit = formData.get("delivery_time_unit") as string | null;
  const deliveryTime = deliveryTimeValue ? `${deliveryTimeValue} ${deliveryTimeUnit ?? "dias"}` : null;

  const offerValidityValue = formData.get("offer_validity_value");
  const offerValidityUnit = formData.get("offer_validity_unit") as string | null;
  const offerValidity = offerValidityValue ? `${offerValidityValue} ${offerValidityUnit ?? "dias"}` : null;
  const file = formData.get("pdf") as File | null;

  if (!budgetNumber || !currency || !deliveryTime || !offerValidity) {
    return { error: "Completá todos los campos obligatorios." };
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(totalPrice) || totalPrice <= 0) {
    return { error: "Los precios deben ser mayores a cero." };
  }
  // El PDF es opcional: el proveedor puede cotizar solo con los datos del form.
  const hasFile = !!file && file.size > 0;
  let attachmentId: string | null = null;

  if (hasFile) {
    if (file!.type !== "application/pdf") {
      return { error: "El adjunto debe ser un archivo PDF." };
    }
    if (file!.size > MAX_PDF_BYTES) {
      return { error: "El PDF no puede superar los 20MB." };
    }

    const path = `${rfq.id}/${rfqProvider.id}/${Date.now()}-${sanitizeFileName(file!.name)}`;
    const { error: uploadError } = await admin.storage
      .from("quote-pdfs")
      .upload(path, file!, { contentType: file!.type });
    if (uploadError) return { error: "No se pudo subir el archivo: " + uploadError.message };

    const { data: attachment, error: attachmentError } = await admin
      .from("attachments")
      .insert({
        empresa_id: empresaId,
        bucket: "quote-pdfs",
        path,
        file_name: file!.name,
        mime_type: file!.type,
        size_bytes: file!.size,
        rfq_provider_id: rfqProvider.id,
      })
      .select("id")
      .single();
    if (attachmentError || !attachment) return { error: "No se pudo registrar el adjunto." };
    attachmentId = attachment.id;
  }

  let { data: quote } = await admin
    .from("quotes")
    .select("id")
    .eq("rfq_provider_id", rfqProvider.id)
    .maybeSingle();

  if (!quote) {
    const { data: newQuote, error: quoteError } = await admin
      .from("quotes")
      .insert({ rfq_provider_id: rfqProvider.id, empresa_id: empresaId })
      .select("id")
      .single();
    if (quoteError || !newQuote) return { error: "No se pudo registrar la cotización." };
    quote = newQuote;
  }

  const { count } = await admin
    .from("quote_versions")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", quote.id);
  const versionNumber = (count ?? 0) + 1;

  const { error: versionError } = await admin.from("quote_versions").insert({
    quote_id: quote.id,
    empresa_id: empresaId,
    version_number: versionNumber,
    budget_number: budgetNumber,
    unit_price: unitPrice,
    total_price: totalPrice,
    currency,
    invoice_available: formData.get("invoice_available") === "on",
    vat_included: formData.get("vat_included") === "on",
    delivery_time: deliveryTime,
    offer_validity: offerValidity,
    payment_terms: null,
    observations: str(formData, "observations"),
    pdf_attachment_id: attachmentId,
  });
  if (versionError) return { error: "No se pudo guardar la cotización: " + versionError.message };

  await admin
    .from("rfq_providers")
    .update({ status: "RESPONDIDO", responded_at: new Date().toISOString() })
    .eq("id", rfqProvider.id);

  if (rfq.status === "COTIZANDO") {
    await admin.from("rfqs").update({ status: "OFERTAS_RECIBIDAS" }).eq("id", rfq.id);
  }

  await logAudit(admin, {
    action: "quote.submitted",
    rfqId: rfq.id,
    rfqProviderId: rfqProvider.id,
    actorType: "provider",
    actorLabel: providerName,
    detail: { version_number: versionNumber },
  });

  revalidatePath(`/cotizar/${token}`);
  return { error: null };
}

export async function markOpened(token: string) {
  const admin = createAdminClient();
  await admin
    .from("rfq_providers")
    .update({ opened_at: new Date().toISOString() })
    .eq("token", token)
    .is("opened_at", null);
}

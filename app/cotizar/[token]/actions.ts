"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { isRfqOpen } from "@/lib/rfq-status";
import { revalidatePath } from "next/cache";
import { isAllowedQuoteAttachment, uploadQuoteAttachment, saveMultiItemQuoteVersion } from "@/lib/costing/quote-version-service";

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
    if (!isAllowedQuoteAttachment(file!)) {
      return { error: "El adjunto debe ser un PDF o una foto." };
    }
    if (file!.size > MAX_PDF_BYTES) {
      return { error: "El adjunto no puede superar los 20MB." };
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

  if (["BORRADOR", "COTIZANDO"].includes(rfq.status)) {
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

  // BATCH 6 — Evento durable para despertar tasks WAITING_EXTERNAL.
  // El payload del proveedor (observations) es DATA, nunca instrucción.
  try {
    const { emitAgentEvent } = await import("@/lib/agent/events");
    await emitAgentEvent({
      db: admin as never,
      empresaId,
      eventType: "SUPPLIER_QUOTE_RECEIVED",
      sourceType: "portal",
      sourceId: rfqProvider.id,
      correlationKey: `RFQ:${rfq.id}`,
      dedupKey: `QUOTE:${rfq.id}:${rfqProvider.id}:v${versionNumber}`,
      payloadJson: {
        rfq_id: rfq.id,
        rfq_provider_id: rfqProvider.id,
        supplier_name: providerName,
        version_number: versionNumber,
        total_price: totalPrice,
        currency,
      },
    });
  } catch (e) {
    console.error("[agent-life] emit SUPPLIER_QUOTE_RECEIVED fallo:", e);
  }

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

/**
 * Cotización de un RFQ multi-ítem (costeo): un precio por línea. Las líneas
 * sin precio son ítems que el proveedor no cotiza. El total se recalcula en
 * el servidor. Si el proveedor sube solo una foto/PDF sin precios, nuestro
 * equipo los carga a mano desde el adjunto (no hay parseo automático).
 */
export async function submitMultiItemQuote(token: string, formData: FormData) {
  const admin = createAdminClient();

  const { data: rfqProvider } = await admin
    .from("rfq_providers")
    .select("id, empresa_id, provider_id, rfqs!rfq_providers_rfq_id_fkey(id, project_id, status, expires_at), providers(name)")
    .eq("token", token)
    .maybeSingle();
  if (!rfqProvider) return { error: "Enlace inválido." };

  const rp = rfqProvider as unknown as {
    id: string;
    empresa_id: string;
    provider_id: string;
    rfqs: { id: string; project_id: string | null; status: "BORRADOR" | "COTIZANDO" | "OFERTAS_RECIBIDAS" | "AUTORIZADO" | "CANCELADO"; expires_at: string };
    providers: { name: string };
  };
  if (!isRfqOpen(rp.rfqs)) {
    return { error: "Esta solicitud ya venció o fue cerrada — contactá a la empresa si querés cotizar igual." };
  }

  const { data: items } = await admin
    .from("rfq_items")
    .select("id, producto_id, descripcion, cantidad, unidad")
    .eq("rfq_id", rp.rfqs.id)
    .order("sort_order");
  if (!items || items.length === 0) return { error: "La solicitud no tiene ítems." };

  const budgetNumber = str(formData, "budget_number");
  const currency = str(formData, "currency");
  const deliveryTimeValue = formData.get("delivery_time_value");
  const deliveryTimeUnit = formData.get("delivery_time_unit") as string | null;
  const offerValidityValue = formData.get("offer_validity_value");
  const offerValidityUnit = formData.get("offer_validity_unit") as string | null;
  if (!budgetNumber || !currency || !deliveryTimeValue || !offerValidityValue) {
    return { error: "Completá todos los campos obligatorios." };
  }

  const prices: Record<string, number | null> = {};
  for (const it of items) {
    const raw = formData.get(`price_${it.id}`);
    prices[it.id] = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : null;
  }

  let attachmentId: string | null = null;
  const file = formData.get("attachment") as File | null;
  if (file && file.size > 0) {
    const up = await uploadQuoteAttachment(admin, {
      empresaId: rp.empresa_id,
      rfqId: rp.rfqs.id,
      rfqProviderId: rp.id,
      file,
    });
    if (up.error) return { error: up.error };
    attachmentId = up.attachmentId;
  }

  const anyPrice = Object.values(prices).some((p) => p != null);
  if (!anyPrice) {
    if (!attachmentId) return { error: "Cargá los precios o adjuntá la foto/PDF de tu presupuesto." };
    // Solo adjunto: queda registrado y nuestro equipo carga los precios a mano.
    await admin
      .from("rfq_providers")
      .update({ status: "RESPONDIDO", responded_at: new Date().toISOString() })
      .eq("id", rp.id);
    if (["BORRADOR", "COTIZANDO"].includes(rp.rfqs.status)) {
      await admin.from("rfqs").update({ status: "OFERTAS_RECIBIDAS" }).eq("id", rp.rfqs.id);
    }
    await logAudit(admin, {
      action: "quote.attachment_only",
      rfqId: rp.rfqs.id,
      rfqProviderId: rp.id,
      actorType: "provider",
      actorLabel: rp.providers.name,
      detail: { attachment_id: attachmentId },
    });
    revalidatePath(`/cotizar/${token}`);
    return { error: null };
  }

  const result = await saveMultiItemQuoteVersion(admin, {
    empresaId: rp.empresa_id,
    rfq: rp.rfqs,
    rfqProvider: { id: rp.id, provider_id: rp.provider_id },
    items: items.map((it) => ({ ...it, cantidad: Number(it.cantidad) })),
    prices,
    budgetNumber,
    currency,
    deliveryTime: `${deliveryTimeValue} ${deliveryTimeUnit ?? "dias"}`,
    offerValidity: `${offerValidityValue} ${offerValidityUnit ?? "dias"}`,
    invoiceAvailable: formData.get("invoice_available") === "on",
    vatIncluded: formData.get("vat_included") === "on",
    observations: str(formData, "observations"),
    attachmentId,
    cargadoPor: "PROVEEDOR",
  });
  if (result.error) return { error: result.error };

  await logAudit(admin, {
    action: "quote.submitted",
    rfqId: rp.rfqs.id,
    rfqProviderId: rp.id,
    actorType: "provider",
    actorLabel: rp.providers.name,
    detail: { version_number: result.versionNumber, multi_item: true },
  });

  revalidatePath(`/cotizar/${token}`);
  return { error: null };
}

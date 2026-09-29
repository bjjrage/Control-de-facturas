import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeFileName } from "@/lib/storage";
import { buildQuoteCostObservations, quoteTotal } from "./quote-observations";

// ---------------------------------------------------------------------------
// Guardado de una versión de cotización multi-ítem. Lo usan el portal del
// proveedor (/cotizar/[token]) y la carga manual interna ("cargar precios del
// adjunto"). Siempre con el admin client, DESPUÉS de que el llamador validó
// el token o la empresa — mismo modelo que el resto del circuito de
// cotizaciones (sin políticas de escritura en quotes/quote_versions).
// ---------------------------------------------------------------------------

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function isAllowedQuoteAttachment(file: File): boolean {
  return file.type === "application/pdf" || file.type.startsWith("image/");
}

export async function uploadQuoteAttachment(
  admin: SupabaseClient,
  args: { empresaId: string; rfqId: string; rfqProviderId: string; file: File }
): Promise<{ attachmentId: string | null; error: string | null }> {
  const { file } = args;
  if (!isAllowedQuoteAttachment(file)) return { attachmentId: null, error: "El adjunto debe ser un PDF o una foto." };
  if (file.size > MAX_ATTACHMENT_BYTES) return { attachmentId: null, error: "El adjunto no puede superar los 20MB." };

  const path = `${args.rfqId}/${args.rfqProviderId}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error: uploadError } = await admin.storage.from("quote-pdfs").upload(path, file, { contentType: file.type });
  if (uploadError) return { attachmentId: null, error: "No se pudo subir el archivo: " + uploadError.message };

  const { data: attachment, error: attachmentError } = await admin
    .from("attachments")
    .insert({
      empresa_id: args.empresaId,
      bucket: "quote-pdfs",
      path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      rfq_provider_id: args.rfqProviderId,
    })
    .select("id")
    .single();
  if (attachmentError || !attachment) return { attachmentId: null, error: "No se pudo registrar el adjunto." };
  return { attachmentId: attachment.id as string, error: null };
}

export interface MultiItemQuoteInput {
  empresaId: string;
  rfq: { id: string; project_id: string | null; status: string };
  rfqProvider: { id: string; provider_id: string };
  items: { id: string; producto_id: string | null; descripcion: string; cantidad: number; unidad: string }[];
  prices: Record<string, number | null>;
  budgetNumber: string;
  currency: string;
  deliveryTime: string | null;
  offerValidity: string | null;
  invoiceAvailable: boolean;
  vatIncluded: boolean;
  observations: string | null;
  attachmentId: string | null;
  cargadoPor: "PROVEEDOR" | "INTERNO";
}

export async function saveMultiItemQuoteVersion(
  admin: SupabaseClient,
  input: MultiItemQuoteInput
): Promise<{ error: string | null; versionNumber?: number; totalPrice?: number }> {
  const lines = input.items.map((it) => ({
    itemId: it.id,
    productoId: it.producto_id,
    descripcion: it.descripcion,
    cantidad: Number(it.cantidad),
    unidad: it.unidad,
    precioUnitario: input.prices[it.id] ?? null,
  }));
  for (const l of lines) {
    if (l.precioUnitario != null && (!Number.isFinite(l.precioUnitario) || l.precioUnitario < 0)) {
      return { error: `Precio inválido en "${l.descripcion}".` };
    }
  }
  const totalPrice = quoteTotal(lines);
  if (!(totalPrice > 0)) return { error: "Cotizá al menos un ítem con precio mayor a cero." };

  let { data: quote } = await admin.from("quotes").select("id").eq("rfq_provider_id", input.rfqProvider.id).maybeSingle();
  if (!quote) {
    const { data: newQuote, error: quoteError } = await admin
      .from("quotes")
      .insert({ rfq_provider_id: input.rfqProvider.id, empresa_id: input.empresaId })
      .select("id")
      .single();
    if (quoteError || !newQuote) return { error: "No se pudo registrar la cotización." };
    quote = newQuote;
  }

  const { count } = await admin.from("quote_versions").select("id", { count: "exact", head: true }).eq("quote_id", quote.id);
  const versionNumber = (count ?? 0) + 1;

  // Una RFQ multi-ítem es "1 lote": unit_price = total (las columnas son NOT NULL).
  const { data: version, error: versionError } = await admin
    .from("quote_versions")
    .insert({
      quote_id: quote.id,
      empresa_id: input.empresaId,
      version_number: versionNumber,
      budget_number: input.budgetNumber,
      unit_price: totalPrice,
      total_price: totalPrice,
      currency: input.currency,
      invoice_available: input.invoiceAvailable,
      vat_included: input.vatIncluded,
      delivery_time: input.deliveryTime,
      offer_validity: input.offerValidity,
      payment_terms: null,
      observations: input.observations,
      pdf_attachment_id: input.attachmentId,
    })
    .select("id")
    .single();
  if (versionError || !version) return { error: "No se pudo guardar la cotización: " + (versionError?.message ?? "") };

  const { error: itemsError } = await admin.from("quote_version_items").insert(
    lines.map((l) => ({
      empresa_id: input.empresaId,
      quote_version_id: version.id,
      rfq_item_id: l.itemId,
      precio_unitario: l.precioUnitario,
      cargado_por: input.cargadoPor,
    }))
  );
  if (itemsError) return { error: "No se pudieron guardar los precios por ítem: " + itemsError.message };

  const observations = buildQuoteCostObservations({
    empresaId: input.empresaId,
    projectId: input.rfq.project_id,
    providerId: input.rfqProvider.provider_id,
    quoteVersionId: version.id as string,
    currency: input.currency,
    fecha: new Date().toISOString().slice(0, 10),
    lines,
  });
  if (observations.length > 0) {
    const { error: obsError } = await admin.from("cost_observations").insert(observations);
    // La cotización ya quedó guardada: un fallo acá no la invalida, pero se loguea.
    if (obsError) console.error("[costeo] no se pudo registrar la base de precios:", obsError.message);
  }

  await admin
    .from("rfq_providers")
    .update({ status: "RESPONDIDO", responded_at: new Date().toISOString() })
    .eq("id", input.rfqProvider.id);
  if (["BORRADOR", "COTIZANDO"].includes(input.rfq.status)) {
    await admin.from("rfqs").update({ status: "OFERTAS_RECIBIDAS" }).eq("id", input.rfq.id);
  }

  return { error: null, versionNumber, totalPrice };
}

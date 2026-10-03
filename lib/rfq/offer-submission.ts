import type { SupabaseClient } from "@supabase/supabase-js";
import {
  magicLinkOpen,
  offerSchema,
  offerLineSchema,
  type OfferLine,
} from "./domain";
import { submitCanonicalOffer } from "./service";
import { uploadQuoteAttachment } from "@/lib/costing/quote-version-service";
import { buildQuoteCostObservations } from "@/lib/costing/quote-observations";
export async function resolveSupplierInvitation(
  db: SupabaseClient,
  token: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Link inválido");
  const { data: rp, error } = await db
    .from("rfq_providers")
    .select(
      "*, rfqs!rfq_providers_rfq_id_fkey(*), providers(name, active, empresa_id)",
    )
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (
    !rp ||
    !rp.rfqs ||
    !rp.providers?.active ||
    rp.providers.empresa_id !== rp.empresa_id ||
    rp.rfqs.empresa_id !== rp.empresa_id ||
    !magicLinkOpen(rp, rp.rfqs)
  )
    throw new Error("Link vencido, revocado o inválido");
  return rp;
}
export async function submitOfferForm(
  db: SupabaseClient,
  token: string,
  fd: FormData,
  actorId: string | null = null,
  expectedEmpresaId?: string,
) {
  const rp = await resolveSupplierInvitation(db, token);
  if (expectedEmpresaId && rp.empresa_id !== expectedEmpresaId)
    throw new Error("Proveedor de otra empresa");
  const { data: items, error } = await db
    .from("rfq_items")
    .select("*")
    .eq("rfq_id", rp.rfq_id)
    .eq("empresa_id", rp.empresa_id)
    .order("sort_order");
  if (error) throw new Error(error.message);
  if (!items?.length)
    throw new Error("RFQ histórica sin líneas: crear RFQ explícita con ítems");
  const numeric = (name: string) => {
    const v = fd.get(name);
    return typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  };
  const lines: OfferLine[] = items.map((i) => ({
    rfq_item_id: i.id,
    precio_unitario: fd.get(`price_${i.id}`)?.toString().trim()
      ? numeric(`price_${i.id}`)
      : null,
    available_quantity: numeric(`available_${i.id}`),
    tax_rate: numeric(`tax_${i.id}`),
    lead_time_days: numeric(`lead_${i.id}`),
    observaciones: null,
  }));
  const date = fd.get("valid_until")?.toString() ?? "";
  const parsedDate = new Date(date.length === 10 ? `${date}T23:59:59Z` : date);
  if (!Number.isFinite(parsedDate.getTime()))
    throw new Error("Validez inválida");
  const offer = {
    budget_number: fd.get("budget_number")?.toString() ?? "",
    currency: fd.get("currency")?.toString() ?? "",
    vat_included: fd.get("vat_included") === "on",
    invoice_available: fd.get("invoice_available") === "on",
    valid_until: parsedDate.toISOString(),
    freight: numeric("freight"),
    payment_terms: fd.get("payment_terms")?.toString() ?? "",
    observations: fd.get("observations")?.toString() ?? null,
  };
  offerSchema.parse(offer);
  offerLineSchema.array().min(1).parse(lines);
  const file = fd.get("attachment");
  let attachmentId = actorId
    ? (fd.get("attachment_id")?.toString() ?? null)
    : null;
  if (file instanceof File && file.size > 0) {
    const result = await uploadQuoteAttachment(db, {
      empresaId: rp.empresa_id,
      rfqId: rp.rfq_id,
      rfqProviderId: rp.id,
      file,
    });
    if (result.error) throw new Error(result.error);
    attachmentId = result.attachmentId;
  }
  if (!attachmentId)
    throw new Error("Adjuntá el documento original del proveedor");
  const result = await submitCanonicalOffer(
    db,
    token,
    offer,
    lines,
    attachmentId,
    actorId,
  );
  const observations = buildQuoteCostObservations({
    empresaId: rp.empresa_id,
    projectId: rp.rfqs.project_id,
    providerId: rp.provider_id,
    quoteVersionId: result.versionId,
    currency: offer.currency,
    fecha: new Date().toISOString().slice(0, 10),
    lines: items.map((i) => ({
      itemId: i.id,
      productoId: i.producto_id,
      descripcion: i.descripcion,
      cantidad: Number(i.cantidad),
      unidad: i.unidad,
      precioUnitario:
        lines.find((l) => l.rfq_item_id === i.id)?.precio_unitario ?? null,
    })),
  });
  if (observations.length) {
    const saved = await db.from("cost_observations").insert(observations);
    if (saved.error)
      console.error("RFQ market observations:", saved.error.message);
  }
  return result;
}

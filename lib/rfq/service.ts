import type { SupabaseClient } from "@supabase/supabase-js";
import {
  allocationSchema,
  offerSchema,
  offerLineSchema,
  purposeSchema,
  rfqItemSchema,
  type ComparativeLine,
  type RfqItem,
  type RfqAllocation,
} from "./domain";

export async function rpc<T>(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function createCanonicalRfq(
  db: SupabaseClient,
  header: Record<string, unknown>,
  items: unknown,
  providerIds: string[] = [],
) {
  purposeSchema.parse(header.purpose);
  const lines = rfqItemSchema.array().min(1).max(500).parse(items);
  return rpc<{ id: string; code: string }>(db, "rfq_create", {
    p_header: header,
    p_items: lines,
    p_provider_ids: [...new Set(providerIds)],
  });
}
export async function submitCanonicalOffer(
  db: SupabaseClient,
  token: string,
  offer: unknown,
  lines: unknown,
  attachmentId: string,
  actorId: string | null = null,
) {
  const header = offerSchema.parse(offer);
  const items = offerLineSchema.array().min(1).max(500).parse(lines);
  if (Date.parse(header.valid_until) <= Date.now())
    throw new Error("Oferta vencida");
  if (!attachmentId) throw new Error("Documento original obligatorio");
  if (new Set(items.map((i) => i.rfq_item_id)).size !== items.length)
    throw new Error("Ítem duplicado");
  return rpc<{ versionId: string; versionNumber: number; totalPrice: number }>(
    db,
    "rfq_submit_version",
    {
      p_token: token,
      p_offer: header,
      p_items: items,
      p_attachment_id: attachmentId,
      p_actor_id: actorId,
    },
  );
}
export async function saveHumanAllocation(
  db: SupabaseClient,
  rfqId: string,
  lines: unknown,
  justification: string,
  revision: number,
) {
  return rpc<{ id: string; revision: number }>(db, "rfq_save_allocation", {
    p_rfq_id: rfqId,
    p_lines: allocationSchema.parse(lines),
    p_justification: justification,
    p_expected_revision: revision,
  });
}

function assertResult(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}
// Every query is scoped, including when called with the service-role client.
export async function loadRfqWorkspace(
  db: SupabaseClient,
  empresaId: string,
  rfqId: string,
) {
  const header = await db
    .from("rfqs")
    .select("*")
    .eq("id", rfqId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  assertResult(header);
  if (!header.data) throw new Error("RFQ no encontrada");
  const [items, invitations, allocations] = await Promise.all([
    db
      .from("rfq_items")
      .select("*")
      .eq("rfq_id", rfqId)
      .eq("empresa_id", empresaId)
      .order("sort_order"),
    db
      .from("rfq_providers")
      .select("*, providers(name, active)")
      .eq("rfq_id", rfqId)
      .eq("empresa_id", empresaId),
    db
      .from("rfq_allocations")
      .select("*")
      .eq("rfq_id", rfqId)
      .eq("empresa_id", empresaId)
      .order("revision", { ascending: false }),
  ]);
  [items, invitations, allocations].forEach(assertResult);
  const providers = invitations.data ?? [];
  const offers: ComparativeLine[] = [];
  const history: Array<Record<string, unknown>> = [];
  if (providers.length) {
    const quotes = await db
      .from("quotes")
      .select("id,rfq_provider_id")
      .eq("empresa_id", empresaId)
      .in(
        "rfq_provider_id",
        providers.map((p) => p.id),
      );
    assertResult(quotes);
    if (quotes.data?.length) {
      const versions = await db
        .from("quote_versions")
        .select("*")
        .eq("empresa_id", empresaId)
        .in(
          "quote_id",
          quotes.data.map((q) => q.id),
        )
        .order("version_number", { ascending: false });
      assertResult(versions);
      const current = new Map<string, Record<string, any>>();
      for (const v of versions.data ?? []) {
        history.push(v);
        if (!current.has(v.quote_id)) current.set(v.quote_id, v);
      }
      if (current.size) {
        const ids = [...current.values()].map((v) => v.id);
        const [lines, reviews] = await Promise.all([
          db
            .from("quote_version_items")
            .select("*")
            .eq("empresa_id", empresaId)
            .in("quote_version_id", ids),
          db
            .from("rfq_quote_reviews")
            .select("*")
            .eq("empresa_id", empresaId)
            .in("quote_version_id", ids)
            .order("reviewed_at", { ascending: false }),
        ]);
        [lines, reviews].forEach(assertResult);
        for (const l of lines.data ?? []) {
          const v = [...current.values()].find(
            (v) => v.id === l.quote_version_id,
          )!;
          const q = quotes.data.find((q) => q.id === v.quote_id)!;
          const rp = providers.find((p) => p.id === q.rfq_provider_id)!;
          const review = reviews.data?.find((r) => r.quote_version_id === v.id);
          offers.push({
            ...l,
            precio_unitario:
              l.precio_unitario == null ? null : Number(l.precio_unitario),
            available_quantity: Number(l.available_quantity ?? 0),
            tax_rate: l.tax_rate == null ? null : Number(l.tax_rate),
            lead_time_days: l.lead_time_days,
            provider_id: rp.provider_id,
            provider_name: rp.providers?.name ?? "Proveedor",
            version_number: v.version_number,
            currency: v.currency,
            freight: v.freight == null ? null : Number(v.freight),
            vat_included: v.vat_included,
            payment_terms: v.payment_terms,
            valid_until: v.valid_until,
            observations: v.observations,
            attachment_id: v.pdf_attachment_id,
            review_id: review?.id ?? null,
            review_resolution: review?.resolution ?? null,
            review_discrepancies: [
              ...(Array.isArray(review?.comparison?.automatic)
                ? review.comparison.automatic
                : []),
              ...(Array.isArray(review?.comparison?.human)
                ? review.comparison.human
                : []),
            ].filter((d) => d.itemId === l.rfq_item_id),
            revoked: !!rp.token_revoked_at || !rp.providers?.active,
          });
        }
        return {
          rfq: header.data,
          items: (items.data ?? []).map((i) => ({
            ...i,
            cantidad: Number(i.cantidad),
          })) as RfqItem[],
          providers,
          offers,
          history,
          allocations: (allocations.data ?? []) as RfqAllocation[],
          reviews: reviews.data ?? [],
        };
      }
    }
  }
  return {
    rfq: header.data,
    items: (items.data ?? []).map((i) => ({
      ...i,
      cantidad: Number(i.cantidad),
    })) as RfqItem[],
    providers,
    offers,
    history,
    allocations: (allocations.data ?? []) as RfqAllocation[],
    reviews: [],
  };
}

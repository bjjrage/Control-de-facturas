import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerColumn, type WorkspaceContext } from "@/lib/workspace/context";
import { calculateCostEstimate } from "@/lib/cost-engine/weighting";
import type { CostObservation } from "@/lib/cost-engine/types";
import { offerExpiryDate, suggestMaterialPrice, type CostPriceSource, type QuoteCandidate, type ResolvedPrice } from "./cost-budget";

// ---------------------------------------------------------------------------
// Precio de cada insumo para una obra (ver suggestMaterialPrice): adopción
// humana → última compra efectiva → estimación basada en compras → CPP.
// Las cotizaciones se devuelven como señal de mercado, fuera del selector.
// Server-only.
//
// Las lecturas de cotizaciones van con el admin client filtrando SIEMPRE por
// empresa_id: quote_versions solo es legible por comercial/admin vía RLS, y
// el costeo lo hace administración.
// ---------------------------------------------------------------------------

export interface QuoteOption extends QuoteCandidate {
  providerName: string;
  rfqCode: string;
  currency: string;
}

export interface ProjectPriceSemantics {
  price: ResolvedPrice | null;
  adoptedPrice: ResolvedPrice | null;
  lastPurchasePrice: ResolvedPrice | null;
  currentQuote: QuoteOption | null;
  estimatedPrice: number | null;
}

export interface MaterialPriceDetail {
  productoId: string;
  price: ResolvedPrice | null;
  adoptedPrice: ResolvedPrice | null;
  lastPurchasePrice: ResolvedPrice | null;
  currentQuote: QuoteOption | null;
  estimatedPrice: number | null;
  chosen: ResolvedPrice | null;
  quotes: QuoteOption[];
  quotesOtraMoneda: number;
  estimate: number | null;
  costoPromedio: number | null;
}

const EFFECTIVE_PURCHASE_SOURCES = new Set(["FACTURA", "RECEPCION"]);

/** Pure price-layer selection shared by Costeo and Plan Semanal. */
export function resolveProjectPriceSemantics(args: {
  adoptedPrice?: ResolvedPrice | null;
  purchaseObservations: CostObservation[];
  quotes?: QuoteOption[];
  inventoryCpp?: number | null;
  today: string;
}): ProjectPriceSemantics {
  const purchases = args.purchaseObservations
    .filter((o) =>
      EFFECTIVE_PURCHASE_SOURCES.has(o.fuente) &&
      o.estadoEvidencia === "VALIDA" &&
      Number.isFinite(o.precioUnitario) &&
      (o.precioUnitario ?? 0) > 0 &&
      Number.isFinite(o.cantidad) &&
      o.cantidad > 0 &&
      !!o.unidad.trim()
    )
    .sort((a, b) => (a.fechaObservacion < b.fechaObservacion ? 1 : a.fechaObservacion > b.fechaObservacion ? -1 : 0));
  const latest = purchases[0];
  const lastPurchasePrice: ResolvedPrice | null = latest
    ? {
        precio: latest.precioUnitario as number,
        fuente: latest.fuente as CostPriceSource,
        fecha: latest.fechaObservacion,
        documentoId: latest.documentoId ?? null,
        proveedorId: latest.proveedorId ?? null,
      }
    : null;
  const estimate = purchases.length > 0 ? calculateCostEstimate(purchases, args.today).recommendedUnitPrice : null;
  const validQuotes = (args.quotes ?? []).filter(
    (q) => Number.isFinite(q.precio) && q.precio > 0 && (!q.venceEl || q.venceEl >= args.today)
  );
  const currentQuote = validQuotes.reduce<QuoteOption | null>(
    (best, quote) => (!best || quote.precio < best.precio ? quote : best),
    null
  );
  const adoptedPrice = args.adoptedPrice && Number.isFinite(args.adoptedPrice.precio) && args.adoptedPrice.precio > 0
    ? { ...args.adoptedPrice, adopted: true }
    : null;
  const price = suggestMaterialPrice({
    chosen: adoptedPrice,
    lastPurchase: lastPurchasePrice,
    estimate,
    costoPromedio: args.inventoryCpp,
    today: args.today,
  });

  return {
    price,
    adoptedPrice,
    lastPurchasePrice,
    currentQuote,
    estimatedPrice: estimate != null && estimate > 0 ? estimate : null,
  };
}

export async function resolveProjectMaterialPrices(args: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  empresaId: string;
  projectId: string;
  productIds: string[];
  today?: string;
}): Promise<Map<string, MaterialPriceDetail>> {
  return resolveContextMaterialPrices({ ...args, context: { kind: "PROJECT", id: args.projectId } });
}

/** The factual price selector is identical for PREBID and execution. */
export async function resolveContextMaterialPrices(args: {
  supabase: SupabaseClient; admin: SupabaseClient; empresaId: string;
  context: WorkspaceContext; productIds: string[]; today?: string;
}): Promise<Map<string, MaterialPriceDetail>> {
  const { supabase, admin, empresaId, context } = args;
  const column = ownerColumn(context);
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const productIds = [...new Set(args.productIds)];
  const out = new Map<string, MaterialPriceDetail>();
  if (productIds.length === 0) return out;

  const [productsRes, chosenRes, obsRes, rfqsRes] = await Promise.all([
    supabase.from("productos").select("id, costo_promedio").eq("empresa_id", empresaId).in("id", productIds),
    supabase
      .from("project_cost_prices")
      .select("producto_id, precio_unitario, fuente, quote_version_item_id, updated_at, updated_by")
      .eq("empresa_id", empresaId)
      .eq(column, context.id),
    supabase
      .from("cost_observations")
      .select("id, producto_id, proveedor_id, documento_id, fuente, descripcion_item, categoria_insumo, cantidad, unidad, precio_unitario, fecha_observacion, es_volatil, estado_evidencia")
      .eq("empresa_id", empresaId)
      .eq("estado_evidencia", "VALIDA")
      .in("fuente", ["FACTURA", "RECEPCION"])
      .not("precio_unitario", "is", null)
      .lte("fecha_observacion", today)
      .in("producto_id", productIds)
      .order("fecha_observacion", { ascending: false })
      .limit(3000),
    admin.from("rfqs").select("id, code").eq("empresa_id", empresaId).eq(column, context.id),
  ]);
  for (const result of [productsRes, chosenRes, obsRes, rfqsRes]) {
    if (result.error) throw new Error(result.error.message);
  }

  const costoPromedio = new Map<string, number>();
  for (const p of (productsRes.data ?? []) as any[]) {
    const cp = Number(p.costo_promedio);
    if (cp > 0) costoPromedio.set(p.id, cp);
  }
  const chosen = new Map<string, ResolvedPrice>();
  for (const c of (chosenRes.data ?? []) as any[]) {
    chosen.set(c.producto_id, {
      precio: Number(c.precio_unitario),
      fuente: c.fuente as CostPriceSource,
      quoteVersionItemId: c.quote_version_item_id ?? null,
      adopted: true,
      adoptedAt: c.updated_at ?? null,
      adoptedBy: c.updated_by ?? null,
    });
  }
  const obsByProduct = new Map<string, CostObservation[]>();
  for (const o of (obsRes.data ?? []) as any[]) {
    const list = obsByProduct.get(o.producto_id) ?? [];
    if (list.length >= 100) continue;
    list.push({
      id: o.id,
      empresaId,
      productoId: o.producto_id,
      proveedorId: o.proveedor_id ?? undefined,
      documentoId: o.documento_id ?? undefined,
      fuente: o.fuente,
      descripcionItem: o.descripcion_item,
      categoriaInsumo: o.categoria_insumo,
      cantidad: Number(o.cantidad),
      unidad: o.unidad,
      precioUnitario: o.precio_unitario == null ? null : Number(o.precio_unitario),
      moneda: "PYG",
      fechaObservacion: o.fecha_observacion,
      esVolatil: o.es_volatil ?? false,
      estadoEvidencia: o.estado_evidencia,
    });
    obsByProduct.set(o.producto_id, list);
  }

  // Cotizaciones de las RFQ de esta obra: última versión de cada proveedor.
  const quotesByProduct = new Map<string, QuoteOption[]>();
  const otraMonedaByProduct = new Map<string, number>();
  const rfqs = (rfqsRes.data ?? []) as { id: string; code: string }[];
  if (rfqs.length > 0) {
    const rfqCode = new Map(rfqs.map((r) => [r.id, r.code]));
    const [itemsRes, rpRes] = await Promise.all([
      admin.from("rfq_items").select("id, rfq_id, producto_id").eq("empresa_id", empresaId).in("rfq_id", rfqs.map((r) => r.id)).in("producto_id", productIds),
      admin.from("rfq_providers").select("id, rfq_id, providers(name)").eq("empresa_id", empresaId).in("rfq_id", rfqs.map((r) => r.id)),
    ]);
    const items = (itemsRes.data ?? []) as { id: string; rfq_id: string; producto_id: string }[];
    const rps = (rpRes.data ?? []) as any[];
    if (items.length > 0 && rps.length > 0) {
      const itemById = new Map(items.map((i) => [i.id, i]));
      const rpById = new Map(rps.map((rp) => [rp.id as string, rp]));
      const { data: quotes } = await admin.from("quotes").select("id, rfq_provider_id").eq("empresa_id", empresaId).in("rfq_provider_id", rps.map((rp) => rp.id));
      const quoteToRp = new Map(((quotes ?? []) as any[]).map((q) => [q.id as string, q.rfq_provider_id as string]));
      if (quoteToRp.size > 0) {
        const { data: versions } = await admin
          .from("quote_versions")
          .select("id, quote_id, version_number, currency, offer_validity, submitted_at")
          .eq("empresa_id", empresaId)
          .in("quote_id", [...quoteToRp.keys()])
          .order("version_number", { ascending: false });
        const latest = new Map<string, any>();
        for (const v of (versions ?? []) as any[]) if (!latest.has(v.quote_id)) latest.set(v.quote_id, v);
        const versionById = new Map([...latest.values()].map((v) => [v.id as string, v]));
        if (versionById.size > 0) {
          const { data: vItems } = await admin
            .from("quote_version_items")
            .select("id, quote_version_id, rfq_item_id, precio_unitario")
            .eq("empresa_id", empresaId)
            .in("quote_version_id", [...versionById.keys()]);
          for (const vi of (vItems ?? []) as any[]) {
            if (vi.precio_unitario == null) continue;
            const item = itemById.get(vi.rfq_item_id);
            const version = versionById.get(vi.quote_version_id);
            if (!item || !version) continue;
            if (version.currency !== "PYG") {
              otraMonedaByProduct.set(item.producto_id, (otraMonedaByProduct.get(item.producto_id) ?? 0) + 1);
              continue;
            }
            const rp = rpById.get(quoteToRp.get(version.quote_id) ?? "");
            const provider = Array.isArray(rp?.providers) ? rp.providers[0] : rp?.providers;
            const list = quotesByProduct.get(item.producto_id) ?? [];
            list.push({
              quoteVersionItemId: vi.id,
              precio: Number(vi.precio_unitario),
              venceEl: offerExpiryDate(version.submitted_at, version.offer_validity),
              providerName: provider?.name ?? "Proveedor",
              rfqCode: rfqCode.get(item.rfq_id) ?? "",
              currency: version.currency,
            });
            quotesByProduct.set(item.producto_id, list);
          }
        }
      }
    }
  }

  for (const productoId of productIds) {
    const obs = obsByProduct.get(productoId) ?? [];
    const quotes = (quotesByProduct.get(productoId) ?? []).sort((a, b) => a.precio - b.precio);
    const semantics = resolveProjectPriceSemantics({
      adoptedPrice: chosen.get(productoId) ?? null,
      purchaseObservations: obs,
      quotes,
      inventoryCpp: costoPromedio.get(productoId) ?? null,
      today,
    });
    const detail: MaterialPriceDetail = {
      productoId,
      chosen: semantics.adoptedPrice,
      adoptedPrice: semantics.adoptedPrice,
      lastPurchasePrice: semantics.lastPurchasePrice,
      currentQuote: semantics.currentQuote,
      estimatedPrice: semantics.estimatedPrice,
      quotes,
      quotesOtraMoneda: otraMonedaByProduct.get(productoId) ?? 0,
      estimate: semantics.estimatedPrice,
      costoPromedio: costoPromedio.get(productoId) ?? null,
      price: semantics.price,
    };
    out.set(productoId, detail);
  }
  return out;
}

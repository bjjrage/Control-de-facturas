import { z } from "zod";

export const purposeSchema = z.enum(["COST_DISCOVERY", "PROCUREMENT"]);
export type RfqPurpose = z.infer<typeof purposeSchema>;
export const currencies = ["PYG", "USD", "EUR", "BRL", "ARS"] as const;
const positive = z.number().finite().positive().max(9_999_999_999);
export const rfqItemSchema = z.object({
  descripcion: z.string().trim().min(1).max(1000),
  cantidad: positive,
  unidad: z.string().trim().min(1).max(50),
  producto_id: z.string().uuid().nullable().optional(),
});
export const offerSchema = z.object({
  budget_number: z.string().trim().min(1).max(200),
  currency: z.enum(currencies),
  vat_included: z.boolean(),
  invoice_available: z.boolean(),
  valid_until: z.string().datetime({ offset: true }),
  freight: z.number().finite().min(0).max(9_999_999_999),
  payment_terms: z.string().trim().min(1).max(2000),
  observations: z.string().max(5000).nullable(),
});
export const offerLineSchema = z
  .object({
    rfq_item_id: z.string().uuid(),
    precio_unitario: positive.nullable(),
    available_quantity: z.number().finite().min(0).max(9_999_999_999),
    tax_rate: z.number().finite().min(0).max(100),
    lead_time_days: z.number().int().min(0).max(3650),
    observaciones: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (l) => l.available_quantity === 0 || l.precio_unitario !== null,
    "Disponibilidad exige precio",
  );
export const allocationLineSchema = z.object({
  quote_version_item_id: z.string().uuid(),
  quantity: positive,
});
export const allocationSchema = z
  .array(allocationLineSchema)
  .min(1)
  .max(500)
  .refine(
    (lines) =>
      new Set(lines.map((l) => l.quote_version_item_id)).size === lines.length,
    "Línea duplicada",
  )
  .refine(
    (lines) =>
      lines.every(
        (l) =>
          Math.abs(l.quantity * 10000 - Math.round(l.quantity * 10000)) <
          0.00001,
      ),
    "Máximo cuatro decimales",
  );
export type AllocationLine = z.infer<typeof allocationLineSchema>;
export type Offer = z.infer<typeof offerSchema>;
export type OfferLine = z.infer<typeof offerLineSchema>;
export interface RfqItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  producto_id: string | null;
}
export interface ComparativeLine extends OfferLine {
  id: string;
  quote_version_id: string;
  provider_id: string;
  provider_name: string;
  version_number: number;
  currency: string;
  vat_included: boolean;
  freight: number | null;
  payment_terms: string | null;
  valid_until: string | null;
  attachment_id: string | null;
  review_id: string | null;
  revoked: boolean;
  observations?: string | null;
  review_resolution?: string | null;
  review_discrepancies?: Array<{ field: string; reason: string }>;
}
export interface RfqAllocation {
  id: string;
  revision: number;
  justification: string;
  lines: Record<string, unknown>[];
  authorized_at: string | null;
  confirmed_at: string | null;
}
export interface OrderPreview {
  allocationId: string;
  hash: string;
  orders: Array<{
    provider_id: string;
    provider_name: string;
    currency: string;
    freight: number;
    payment_terms: string;
    total: number;
    tax_total: number;
    vat_included: boolean;
    quote_version_id: string;
    rfq_id: string;
    allocation_id: string;
    project_id: string | null;
    items: Array<{
      rfq_item_id: string;
      quote_version_item_id: string;
      quote_version_id: string;
      product: string;
      quantity: number;
      unit: string;
      unit_price: number;
      tax_rate: number;
      total: number;
      lead_time_days: number;
      expected_delivery_date: string;
    }>;
  }>;
}
export function magicLinkOpen(
  invitation: {
    token_revoked_at?: string | null;
    token_expires_at?: string | null;
  },
  rfq: { expires_at: string; status: string },
  now = Date.now(),
) {
  return (
    !invitation.token_revoked_at &&
    ["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"].includes(rfq.status) &&
    Date.parse(rfq.expires_at) > now &&
    Date.parse(invitation.token_expires_at ?? rfq.expires_at) > now
  );
}
export function eligibleLine(
  line: ComparativeLine,
  now = Date.now(),
  requireReview = true,
) {
  return (
    !line.revoked &&
    line.precio_unitario != null &&
    Number.isFinite(line.precio_unitario) &&
    line.precio_unitario > 0 &&
    line.available_quantity > 0 &&
    line.tax_rate != null &&
    line.lead_time_days != null &&
    line.freight != null &&
    !!line.valid_until &&
    Date.parse(line.valid_until) > now &&
    !!line.attachment_id &&
    !!line.payment_terms &&
    (!requireReview || !!line.review_id)
  );
}
export function validateAllocation(
  lines: AllocationLine[],
  items: RfqItem[],
  offers: ComparativeLine[],
  now = Date.now(),
) {
  allocationSchema.parse(lines);
  const totals = new Map<string, number>();
  for (const l of lines) {
    const offer = offers.find((o) => o.id === l.quote_version_item_id);
    if (!offer || !eligibleLine(offer, now))
      throw new Error("Oferta ajena, incompleta, vencida o sin revisión");
    if (l.quantity > offer.available_quantity)
      throw new Error("Disponibilidad insuficiente");
    const item = items.find((i) => i.id === offer.rfq_item_id);
    if (!item) throw new Error("Ítem ajeno");
    const total = (totals.get(item.id) ?? 0) + l.quantity;
    if (Math.round(total * 10000) > Math.round(item.cantidad * 10000))
      throw new Error("Sobreasignación");
    totals.set(item.id, total);
  }
  return items.map((i) => ({
    itemId: i.id,
    unallocated: Math.max(0, i.cantidad - (totals.get(i.id) ?? 0)),
  }));
}

export type ProposalKind =
  | "ONE_SUPPLIER"
  | "CHEAPEST"
  | "LOTS"
  | "FASTEST"
  | "TERMS"
  | "WEIGHTED"
  | "CUSTOM"
  | "PARTIAL";
export interface Proposal {
  kind: ProposalKind;
  label: string;
  currency: string | null;
  lines: AllocationLine[];
  warnings: string[];
  decision: false;
}
export interface ProposalWeights {
  price: number;
  lead: number;
  availability: number;
  terms: number;
}
// Pure proposals only: never writes decisions, authorizations or orders. No implied FX.
export function proposeAllocations(
  items: RfqItem[],
  offers: ComparativeLine[],
  opts: {
    now?: number;
    weights?: ProposalWeights;
    termScores?: Record<string, number>;
    custom?: AllocationLine[];
  } = {},
): Proposal[] {
  const valid = offers.filter((o) => eligibleLine(o, opts.now));
  const results: Proposal[] = [];
  const groups = [...new Set(valid.map((o) => o.currency))];
  const weights = opts.weights ?? {
    price: 0.4,
    lead: 0.3,
    availability: 0.3,
    terms: 0,
  };
  if (
    Object.values(weights).some((x) => !Number.isFinite(x) || x < 0) ||
    Object.values(weights).reduce((a, b) => a + b, 0) <= 0
  )
    throw new Error("Pesos inválidos");
  if (
    opts.termScores &&
    Object.values(opts.termScores).some(
      (x) => !Number.isFinite(x) || x < 0 || x > 1,
    )
  )
    throw new Error("Puntajes de condiciones inválidos");
  const push = (
    kind: ProposalKind,
    label: string,
    currency: string,
    candidates: ComparativeLine[],
    rank: (a: ComparativeLine, b: ComparativeLine) => number,
  ) => {
    const lines: AllocationLine[] = [];
    for (const item of items) {
      let left = item.cantidad;
      for (const offer of candidates
        .filter((o) => o.rfq_item_id === item.id)
        .sort(rank)) {
        const qty = Math.min(left, offer.available_quantity);
        if (qty > 0)
          lines.push({ quote_version_item_id: offer.id, quantity: qty });
        left = Math.max(0, left - qty);
        if (left === 0) break;
      }
    }
    if (!lines.length) return;
    const residual = validateAllocation(lines, items, valid, opts.now);
    results.push({
      kind,
      label,
      currency,
      lines,
      decision: false,
      warnings: [
        ...(groups.length > 1
          ? ["Comparación por moneda; sin FX inventado"]
          : []),
        ...residual
          .filter((x) => x.unallocated > 0)
          .map(
            (x) =>
              `Sin asignar ${x.unallocated}: ${items.find((i) => i.id === x.itemId)?.descripcion}`,
          ),
        "Flete fijo completo por proveedor; revisar totales en preview",
      ],
    });
  };
  const cost = (o: ComparativeLine) =>
    o.precio_unitario! * (o.vat_included ? 1 : 1 + o.tax_rate / 100);
  for (const currency of groups) {
    const pool = valid.filter((o) => o.currency === currency);
    for (const provider of [...new Set(pool.map((o) => o.provider_id))])
      push(
        "ONE_SUPPLIER",
        `Todo disponible a ${pool.find((o) => o.provider_id === provider)!.provider_name}`,
        currency,
        pool.filter((o) => o.provider_id === provider),
        (a, b) => cost(a) - cost(b),
      );
    push(
      "CHEAPEST",
      "Menor precio por ítem",
      currency,
      pool,
      (a, b) => cost(a) - cost(b),
    );
    push(
      "FASTEST",
      "Mejor entrega",
      currency,
      pool,
      (a, b) => a.lead_time_days - b.lead_time_days || cost(a) - cost(b),
    );
    // Human supplied score: payment prose cannot safely be ranked as factual terms.
    if (opts.termScores)
      push(
        "TERMS",
        "Condiciones puntuadas por humano",
        currency,
        pool.filter((o) => opts.termScores![o.quote_version_id] != null),
        (a, b) =>
          opts.termScores![b.quote_version_id] -
          opts.termScores![a.quote_version_id],
      );
    const maxCost = Math.max(...pool.map(cost), 1);
    const maxLead = Math.max(...pool.map((o) => o.lead_time_days), 1);
    const score = (o: ComparativeLine) =>
      weights.price * (1 - cost(o) / maxCost) +
      weights.lead * (1 - o.lead_time_days / maxLead) +
      weights.availability *
        Math.min(
          1,
          o.available_quantity /
            (items.find((i) => i.id === o.rfq_item_id)?.cantidad ?? Infinity),
        ) +
      weights.terms * (opts.termScores?.[o.quote_version_id] ?? 0);
    if (weights.terms === 0 || opts.termScores)
      push(
        "WEIGHTED",
        "Escenario ponderado",
        currency,
        weights.terms > 0
          ? pool.filter((o) => opts.termScores?.[o.quote_version_id] != null)
          : pool,
        (a, b) => score(b) - score(a),
      );
    const coverage = (provider: string) =>
      pool
        .filter((o) => o.provider_id === provider)
        .reduce(
          (sum, o) =>
            sum +
            Math.min(
              1,
              o.available_quantity /
                (items.find((i) => i.id === o.rfq_item_id)?.cantidad ??
                  Infinity),
            ),
          0,
        );
    push(
      "LOTS",
      "Lotes por proveedor: mayor cobertura disponible",
      currency,
      pool,
      (a, b) =>
        coverage(b.provider_id) - coverage(a.provider_id) || cost(a) - cost(b),
    );
    push(
      "PARTIAL",
      "Compra parcial disponible",
      currency,
      pool,
      (a, b) => cost(a) - cost(b),
    );
  }
  if (opts.custom?.length) {
    validateAllocation(opts.custom, items, valid, opts.now);
    results.push({
      kind: "CUSTOM",
      label: "Asignación personalizada",
      currency: null,
      lines: opts.custom,
      warnings: [],
      decision: false,
    });
  }
  return results;
}

export interface DocumentFact {
  rfq_item_id: string;
  precio_unitario?: number | null;
  currency?: string;
  tax_rate?: number;
  available_quantity?: number;
  lead_time_days?: number;
  freight?: number;
  payment_terms?: string;
  valid_until?: string;
}
export interface Discrepancy {
  itemId: string;
  field: string;
  structured: unknown;
  document: unknown;
  reason: string;
}
export function reconcileOffer(
  offers: ComparativeLine[],
  facts: DocumentFact[],
): Discrepancy[] {
  return offers.flatMap<Discrepancy>((o) => {
    const fact = facts.find((f) => f.rfq_item_id === o.rfq_item_id);
    if (!fact)
      return [
        {
          itemId: o.rfq_item_id,
          field: "document",
          structured: null,
          document: null,
          reason: "No identificado en documento",
        },
      ];
    return (
      [
        "precio_unitario",
        "currency",
        "tax_rate",
        "available_quantity",
        "lead_time_days",
        "freight",
        "payment_terms",
        "valid_until",
      ] as const
    ).flatMap((field) =>
      fact[field] === undefined
        ? [
            {
              itemId: o.rfq_item_id,
              field,
              structured: o[field],
              document: null,
              reason: "Sin evidencia extraída",
            },
          ]
        : (field === "valid_until" &&
              Number.isFinite(Date.parse(String(fact[field]))) &&
              Date.parse(String(fact[field])) ===
                Date.parse(String(o[field]))) ||
            fact[field] === o[field]
          ? []
          : [
              {
                itemId: o.rfq_item_id,
                field,
                structured: o[field],
                document: fact[field],
                reason: "Discrepancia",
              },
            ],
    );
  });
}

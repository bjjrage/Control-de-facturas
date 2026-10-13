import { z } from "zod";
import { reconcileOffer, type ComparativeLine, type Discrepancy, type DocumentFact } from "./domain";

export const REVIEW_POLICY = "field-review-v1";
export const reviewDecisionSchema = z.array(z.object({
  itemId: z.string().uuid(),
  field: z.string(),
  structured: z.unknown(),
  document: z.unknown(),
  decision: z.enum(["verified_original", "request_correction"]),
})).max(5000);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>[number];
export const reviewKey = (d: Pick<Discrepancy, "itemId" | "field">) => `${d.itemId}:${d.field}`;

/** Missing item evidence expands to the actual commercial fields, never a blanket waiver. */
export function reviewDifferences(offers: ComparativeLine[], facts: DocumentFact[]): Discrepancy[] {
  const expanded = offers.map(o => facts.find(f => f.rfq_item_id === o.rfq_item_id) ?? { rfq_item_id: o.rfq_item_id });
  return reconcileOffer(offers, expanded);
}

export function resolveQuoteReview(offers: ComparativeLine[], facts: DocumentFact[], input: unknown) {
  const decisions = reviewDecisionSchema.parse(input);
  const differences = reviewDifferences(offers, facts);
  if (new Set(decisions.map(reviewKey)).size !== decisions.length) throw new Error("Revisión duplicada.");
  if (decisions.length !== differences.length) throw new Error("Resolvé cada diferencia entre el portal y el presupuesto.");
  const verified = offers.map(o => ({ ...(facts.find(f => f.rfq_item_id === o.rfq_item_id) ?? { rfq_item_id: o.rfq_item_id }) }));
  for (const d of differences) {
    const choice = decisions.find(c => reviewKey(c) === reviewKey(d));
    if (!choice || JSON.stringify(choice.structured) !== JSON.stringify(d.structured) || JSON.stringify(choice.document) !== JSON.stringify(d.document)) {
      throw new Error("La comparación cambió. Volvé a revisar el presupuesto.");
    }
    if (choice.decision !== "verified_original") throw new Error("Solicitá al proveedor una versión corregida antes de adjudicar.");
    const fact = verified.find(f => f.rfq_item_id === d.itemId)!;
    // Explicit human correction of an unread/misread field. Original evidence
    // and the structured offer remain immutable and are persisted separately.
    Object.assign(fact, { [d.field]: d.structured });
  }
  if (reconcileOffer(offers, verified).length) throw new Error("El presupuesto tiene diferencias pendientes.");
  return { facts: verified, decisions, differences };
}

export function isResolvedReview(review: { extraction?: { reviewPolicy?: unknown }; comparison?: { automatic?: unknown; human?: unknown } } | undefined) {
  if (!review || !Array.isArray(review.comparison?.automatic) || !Array.isArray(review.comparison?.human)) return false;
  if (review.comparison.human.length) return false;
  return review.comparison.automatic.length === 0 || review.extraction?.reviewPolicy === REVIEW_POLICY;
}

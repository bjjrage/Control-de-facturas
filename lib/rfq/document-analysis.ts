import type { SupabaseClient } from "@supabase/supabase-js";
import { readDocumentContent } from "@/lib/documents/reader";
import { reconcileOffer, type ComparativeLine, type RfqItem } from "./domain";
import { extractDocumentFacts } from "./reconciliation";

// Callers authorize and load the current version through loadRfqWorkspace first.
// This is the existing extraction/reconciliation chain, with no decision writes.
export async function analyzeQuoteDocument(
  db: SupabaseClient,
  empresaId: string,
  items: RfqItem[],
  offers: ComparativeLine[],
) {
  const attachmentId = offers[0]?.attachment_id;
  if (!attachmentId || offers.some((o) =>
    o.attachment_id !== attachmentId ||
    o.quote_version_id !== offers[0].quote_version_id ||
    !items.some((item) => item.id === o.rfq_item_id)
  )) throw new Error("Versión/documento no disponible");
  const extraction = await readDocumentContent({
    db,
    empresaId,
    documentId: attachmentId,
    maxChars: 50000,
    maxRows: 1000,
    maxSheets: 5,
  });
  if (extraction.warnings.some((w) => w.startsWith("Error accediendo al storage:")))
    throw new Error(extraction.warnings.join(" · "));
  const facts = extractDocumentFacts(extraction, items);
  return { extraction, facts, comparison: reconcileOffer(offers, facts) };
}

export type QuoteDocumentAnalysis = Awaited<ReturnType<typeof analyzeQuoteDocument>>;
export type QuoteDocumentAnalysisResult =
  | { error: null; data: QuoteDocumentAnalysis }
  | { error: string; data: null };

// Recomputed from immutable originals: the current schema has human reviews,
// not an automatic-analysis record. Never impersonate a reviewer to cache data.
export async function analyzeRfqDocuments(
  db: SupabaseClient,
  empresaId: string,
  items: RfqItem[],
  offers: ComparativeLine[],
) {
  const results: Record<string, QuoteDocumentAnalysisResult> = {};
  // Bound memory usage while reading supplier attachments (up to 20 MB each).
  for (const versionId of new Set(offers.map((o) => o.quote_version_id))) {
    try {
      results[versionId] = { error: null, data: await analyzeQuoteDocument(
        db, empresaId, items, offers.filter((o) => o.quote_version_id === versionId),
      ) };
    } catch (e) {
      results[versionId] = { error: e instanceof Error ? e.message : "No se pudo analizar el documento", data: null };
    }
  }
  return results;
}

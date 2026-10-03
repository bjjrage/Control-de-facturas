import { z } from "zod";
import type { DocumentExtractionResult } from "@/lib/documents/reader";
import type { DocumentFact, RfqItem } from "./domain";
export const documentFactsSchema = z
  .array(
    z.object({
      rfq_item_id: z.string().uuid(),
      precio_unitario: z.number().finite().nonnegative().nullable().optional(),
      currency: z.string().max(10).optional(),
      tax_rate: z.number().finite().min(0).max(100).optional(),
      available_quantity: z.number().finite().nonnegative().optional(),
      lead_time_days: z.number().int().nonnegative().optional(),
      freight: z.number().finite().nonnegative().optional(),
      payment_terms: z.string().max(2000).optional(),
      valid_until: z.string().max(100).optional(),
    }),
  )
  .max(500);
const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
// Ambiguous localized numbers stay unknown.
function numeric(x: unknown): number | undefined {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && /^\d+(\.\d+)?$/.test(x.trim())) return Number(x);
  return undefined;
}
export function extractDocumentFacts(
  doc: DocumentExtractionResult,
  items: RfqItem[],
): DocumentFact[] {
  const facts: DocumentFact[] = [];
  for (const sheet of doc.structured?.sheets ?? [])
    for (const row of sheet.rows) {
      const fields = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [normal(k), v]),
      );
      const identifier = fields["rfq_item_id"] ?? fields["item id"];
      const description =
        fields["descripcion"] ?? fields["producto"] ?? fields["item"];
      const matches = items.filter(
        (i) =>
          i.id === identifier ||
          (typeof description === "string" &&
            normal(i.descripcion) === normal(description)),
      );
      if (
        matches.length !== 1 ||
        facts.some((f) => f.rfq_item_id === matches[0].id)
      )
        continue;
      facts.push({
        rfq_item_id: matches[0].id,
        precio_unitario: numeric(
          fields["precio unitario"] ?? fields["precio_unitario"],
        ),
        currency:
          typeof (fields["moneda"] ?? fields["currency"]) === "string"
            ? String(fields["moneda"] ?? fields["currency"])
                .trim()
                .toUpperCase()
            : undefined,
        tax_rate: numeric(fields["impuesto %"] ?? fields["tax_rate"]),
        available_quantity: numeric(
          fields["disponibilidad"] ?? fields["available_quantity"],
        ),
        lead_time_days: numeric(
          fields["plazo dias"] ?? fields["lead_time_days"],
        ),
        freight: numeric(fields["flete"] ?? fields["freight"]),
        payment_terms:
          typeof (fields["pago"] ?? fields["payment_terms"]) === "string"
            ? String(fields["pago"] ?? fields["payment_terms"])
            : undefined,
        valid_until:
          typeof (fields["validez"] ?? fields["valid_until"]) === "string"
            ? String(fields["validez"] ?? fields["valid_until"])
            : undefined,
      });
    }
  for (const line of (doc.text ?? "").split(/\r?\n/)) {
    const item = items.find((i) => line.includes(i.id));
    if (!item || facts.some((f) => f.rfq_item_id === item.id)) continue;
    const price = line.match(
      /(?:precio_unitario|unit_price)\s*[:=]\s*(\d+(?:\.\d+)?)/i,
    );
    if (price)
      facts.push({
        rfq_item_id: item.id,
        precio_unitario: Number(price[1]),
        currency: line
          .match(/(?:currency|moneda)\s*[:=]\s*([A-Z]{3})/i)?.[1]
          ?.toUpperCase(),
      });
  }
  return facts;
}

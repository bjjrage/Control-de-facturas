import type { ExtractedInvoiceFields } from "@/lib/invoice-extraction";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Match only unique descriptions and compatible units; never guess the OC line. */
export function proposeReceiptQuantities(document: ExtractedInvoiceFields, lines: { id: string; product: string; unit: string }[], orderCode: string) {
  const quantities: Record<string, string> = {};
  const warnings: string[] = [];
  if (document.order_reference && normalize(document.order_reference) !== normalize(orderCode)) {
    return { quantities, warnings: [`El remito menciona ${document.order_reference}, no ${orderCode}. No se completaron cantidades.`] };
  }
  const seen = new Set<string>();
  for (const item of document.items ?? []) {
    const matches = lines.filter(line => normalize(line.product) === normalize(item.description) && (!item.unit || normalize(line.unit) === normalize(item.unit)));
    const quantity = String(item.quantity ?? "");
    if (matches.length !== 1 || !/^\d+(?:\.\d{1,4})?$/.test(quantity) || !Number.isFinite(Number(quantity)) || !(Number(quantity) > 0)) {
      warnings.push(`${item.description}: revisá la cantidad, la unidad o su correspondencia con la OC.`);
      continue;
    }
    const id = matches[0].id;
    if (seen.has(id)) {
      delete quantities[id];
      warnings.push(`${item.description}: aparece en varias líneas del remito; revisá la cantidad total.`);
    } else {
      quantities[id] = quantity;
      if (!item.unit) warnings.push(`${item.description}: el documento no indica unidad; verificá que coincida con la OC.`);
    }
    seen.add(id);
  }
  if (!document.items?.length) warnings.push("No se encontraron cantidades entregadas legibles en el documento.");
  return { quantities, warnings };
}

/**
 * Conciliación determinística de líneas de factura contra líneas de OC.
 *
 * Rellena el modelo existente (`invoice_item_matches` + trigger
 * `trg_recompute_order_item_qty`) sin inventar cantidades:
 * - quantity_matched siempre proviene de la cantidad propia de la línea de factura.
 * - NUNCA se deduce dividiendo totales por precios (prohibido por negocio).
 * - Solo se crea automáticamente en el caso inequívoco (1:1 único, unidad
 *   compatible, cantidad dentro del remanente). Todo lo demás queda
 *   SIN CONCILIAR para revisión humana explícita.
 */

export type ReconcilableInvoiceLine = {
  id: string;
  invoice_id: string;
  empresa_id: string;
  product_description: string;
  quantity: number | null;
  unit: string | null;
};

export type ReconcilableOrderLine = {
  id: string;
  order_id: string;
  empresa_id: string;
  product: string;
  quantity: number;
  unit: string;
  quantity_invoiced: number;
};

export type ItemMatchProposal = {
  invoiceItemId: string;
  orderItemId: string;
  quantityMatched: number;
  overRemaining: boolean;
};

const UNIT_ALIASES: Record<string, string> = {
  unidad: "un",
  unidades: "un",
  unid: "un",
  unids: "un",
  u: "un",
  bolsa: "bolsa",
  bolsas: "bolsa",
  saco: "bolsa",
  sacos: "bolsa",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  g: "g",
  gramo: "g",
  gramos: "g",
  tonelada: "tonelada",
  toneladas: "tonelada",
  t: "tonelada",
  l: "l",
  lt: "l",
  litro: "l",
  litros: "l",
  ml: "ml",
  m: "m",
  metro: "m",
  metros: "m",
  m2: "m2",
  "m²": "m2",
  metrocuadrado: "m2",
  m3: "m3",
  "m³": "m3",
  metrocubico: "m3",
  barra: "barra",
  barras: "barra",
  balde: "balde",
  baldes: "balde",
  caja: "caja",
  cajas: "caja",
  paquete: "paquete",
  paquetes: "paquete",
  rollo: "rollo",
  rollos: "rollo",
  pallet: "pallet",
  pallets: "pallet",
  tambor: "tambor",
  tambores: "tambor",
  bidon: "bidon",
  bidones: "bidon",
  "bidón": "bidon",
  gl: "gl",
  par: "par",
  pares: "par",
};

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (typeof unit !== "string") return null;
  const cleaned = unit.trim().toLowerCase().replace(/\./g, "");
  if (!cleaned) return null;
  return UNIT_ALIASES[cleaned] ?? cleaned;
}

export function unitsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeUnit(a);
  const nb = normalizeUnit(b);
  return na !== null && nb !== null && na === nb;
}

export function normalizeDescription(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function descriptionWords(value: string): string[] {
  return normalizeDescription(value).split(" ").filter((w) => w.length > 2);
}

/** true si las descripciones coinciden exacto (normalizado) o el overlap léxico es total en un sentido. */
export function descriptionsMatch(invoiceDesc: string, orderDesc: string): boolean {
  const a = normalizeDescription(invoiceDesc);
  const b = normalizeDescription(orderDesc);
  if (!a || !b) return false;
  if (a === b) return true;
  const wa = descriptionWords(invoiceDesc);
  const wb = descriptionWords(orderDesc);
  if (!wa.length || !wb.length) return false;
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return shorter.every((w) => longer.includes(w));
}

export function orderLineRemaining(orderLine: { quantity: number; quantity_invoiced: number | null | undefined }): number {
  return Number(orderLine.quantity) - Number(orderLine.quantity_invoiced ?? 0);
}

export type SuggestOptions = {
  /** Si la factura y la OC tienen una sola línea cada una, se acepta unidad compatible sin exigir descripción. */
  allowSingleToSingleFallback?: boolean;
};

/**
 * Propone imputaciones 1:1 determinísticas. Nunca inventa cantidades:
 * quantityMatched es siempre la cantidad propia de la línea de factura.
 */
export function suggestInvoiceItemMatches(
  invoiceLines: ReconcilableInvoiceLine[],
  orderLines: ReconcilableOrderLine[],
  options: SuggestOptions = {}
): ItemMatchProposal[] {
  const allowFallback = options.allowSingleToSingleFallback ?? true;
  const proposals: ItemMatchProposal[] = [];
  const usedOrderLines = new Set<string>();

  for (const line of invoiceLines) {
    const qty = Number(line.quantity);
    if (!line.product_description?.trim() || !Number.isFinite(qty) || qty <= 0) continue;
    if (!line.unit) continue;

    const candidates = orderLines.filter(
      (o) => !usedOrderLines.has(o.id) && unitsCompatible(line.unit, o.unit) && (
        descriptionsMatch(line.product_description, o.product) ||
        (allowFallback && invoiceLines.length === 1 && orderLines.length === 1)
      )
    );
    if (candidates.length !== 1) continue;
    const target = candidates[0];
    usedOrderLines.add(target.id);
    proposals.push({
      invoiceItemId: line.id,
      orderItemId: target.id,
      quantityMatched: qty,
      overRemaining: qty > orderLineRemaining(target),
    });
  }
  return proposals;
}

export type ManualMatchCheck =
  | { ok: true; overRemaining: false }
  | { ok: false; error: string };

/**
 * Validación para creación manual explícita por un humano (nunca silenciosa).
 *
 * Reglas R3-02 (integridad de cantidades):
 * - La imputación nunca supera la cantidad DOCUMENTADA de la línea: se suma
 *   TODOS los matches existentes de la línea (existingLineMatched).
 * - La imputación nunca supera el REMANENTE de la OC. No hay warning que
 *   autorice excesos: no existe mecanismo que autorice exceder cantidades
 *   (invoice_exceptions solo cubre sobrefacturación financiera, no cantidades).
 * - Línea sin cantidad documentada (null) no admite imputación: sin conciliar.
 * - Fracciones finitas se aceptan tal cual (el esquema es numeric, sin regla
 *   de enteros por unidad); no finitas se rechazan.
 */
export function validateManualItemMatch(args: {
  invoiceEmpresaId: string;
  orderEmpresaId: string;
  invoiceStatus: string;
  invoiceLine: { id: string; invoice_id: string; description: string; quantity: number | null; unit: string | null };
  orderLine: { id: string; product: string; quantity: number; unit: string; quantity_invoiced: number };
  invoiceLineCount: number;
  orderLineCount: number;
  quantity: number;
  existingLineMatched: number;
  duplicateExists: boolean;
}): ManualMatchCheck {
  if (args.invoiceEmpresaId !== args.orderEmpresaId) {
    return { ok: false, error: "La línea de OC no pertenece a la empresa de la factura." };
  }
  if (["APTO_PARA_PAGO", "PAGADO"].includes(args.invoiceStatus)) {
    return { ok: false, error: "La factura ya está aprobada o pagada; la conciliación por ítem queda congelada." };
  }
  if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
    return { ok: false, error: "La cantidad imputada debe ser mayor a cero." };
  }
  if (!unitsCompatible(args.invoiceLine.unit, args.orderLine.unit)) {
    return { ok: false, error: "La unidad de la línea de factura no coincide con la de la OC." };
  }
  const singleToSingle = args.invoiceLineCount === 1 && args.orderLineCount === 1;
  if (!singleToSingle && !descriptionsMatch(args.invoiceLine.description, args.orderLine.product)) {
    return { ok: false, error: "El producto de la línea no corresponde al ítem de OC." };
  }
  if (args.duplicateExists) {
    return { ok: false, error: "Esa línea ya está imputada a ese ítem de OC." };
  }
  const lineQty = args.invoiceLine.quantity;
  if (lineQty === null || !Number.isFinite(lineQty)) {
    return { ok: false, error: "La línea no tiene cantidad documentada; no se puede imputar." };
  }
  if (args.existingLineMatched + args.quantity > lineQty + 1e-9) {
    return { ok: false, error: `La imputación supera la cantidad documentada de la línea (${lineQty}): ya hay ${args.existingLineMatched} imputados.` };
  }
  if (args.quantity > orderLineRemaining(args.orderLine) + 1e-9) {
    return { ok: false, error: `La cantidad supera el remanente de la OC (${orderLineRemaining(args.orderLine)} pendientes). Queda sin conciliar.` };
  }
  return { ok: true, overRemaining: false };
}

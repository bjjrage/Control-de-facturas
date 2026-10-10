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

export type PhysicalQuantity = number | string;

export type ReconcilableInvoiceLine = {
  id: string;
  invoice_id: string;
  empresa_id: string;
  product_description: string;
  quantity: PhysicalQuantity | null;
  unit: string | null;
};

export type ReconcilableOrderLine = {
  id: string;
  order_id: string;
  empresa_id: string;
  product: string;
  quantity: PhysicalQuantity;
  unit: string;
  quantity_invoiced: PhysicalQuantity;
};

export type ItemMatchProposal = {
  invoiceItemId: string;
  orderItemId: string;
  quantityMatched: PhysicalQuantity;
  overRemaining: boolean;
};

export const INVOICE_QUANTITY_ERROR = "La cantidad debe ser positiva, menor a 1.000.000.000.000 y exacta hasta cuatro decimales.";

const QUANTITY_SCALE = BigInt(10_000);
const MAX_INVOICE_QUANTITY_UNITS = BigInt("10000000000000000");
const MAX_ORDER_QUANTITY_UNITS = BigInt("1000000000000000000");
// Above this bound, an IEEE-754 number cannot be trusted to preserve a fifth
// decimal at the source boundary. Large physical quantities must be strings.
const MAX_NUMBER_QUANTITY = 1_000_000_000;

function decimalTextUnits(value: string): bigint | null {
  if (value.length === 0 || value.length > 100) return null;
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const integer = match[1] || "0";
  const fraction = match[2] ?? "";
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > 4) return null;
  return BigInt(integer) * QUANTITY_SCALE + BigInt(significantFraction.padEnd(4, "0") || "0");
}

function quantityUnits(value: unknown): bigint | null {
  let units: bigint | null;
  if (typeof value === "string") {
    units = decimalTextUnits(value);
  } else if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < MAX_NUMBER_QUANTITY) {
    // Compatibility for existing callers with numbers. Every untrusted textual
    // quantity must stay a string until it reaches this validator.
    const exact = value.toFixed(4);
    if (Number(exact) !== value) return null;
    units = decimalTextUnits(exact);
  } else {
    return null;
  }
  return units !== null && units < MAX_ORDER_QUANTITY_UNITS ? units : null;
}

/** Matches the invoice/order-line PostgreSQL contract without rounding input. */
export function isValidInvoiceQuantity(value: unknown): value is PhysicalQuantity {
  const units = quantityUnits(value);
  return units !== null && units > BigInt(0) && units < MAX_INVOICE_QUANTITY_UNITS;
}

/** Untrusted form/OCR input must retain its original decimal text. */
export function isValidInvoiceQuantityInput(value: unknown): value is string {
  return typeof value === "string" && isValidInvoiceQuantity(value);
}

/** Compare a sum of quantities to a documented/ordered ceiling without binary-float addition. */
export function compareInvoiceQuantitySum(values: unknown[], ceiling: unknown): -1 | 0 | 1 | null {
  const units = values.map(quantityUnits);
  const ceilingUnits = quantityUnits(ceiling);
  if (ceilingUnits === null || units.some((value) => value === null)) return null;
  const total = (units as bigint[]).reduce<bigint>((sum, value) => sum + value, BigInt(0));
  return total < ceilingUnits ? -1 : total > ceilingUnits ? 1 : 0;
}

/** Add validated 4-decimal physical quantities with integer arithmetic. */
export function sumInvoiceQuantities(values: unknown[]): number {
  const units = values.map(quantityUnits);
  if (units.some((value) => value === null)) return Number.NaN;
  return Number((units as bigint[]).reduce<bigint>((sum, value) => sum + value, BigInt(0))) / Number(QUANTITY_SCALE);
}

/** Subtract validated physical quantities with integer arithmetic. */
export function subtractInvoiceQuantities(total: unknown, used: unknown): number {
  const totalUnits = quantityUnits(total);
  const usedUnits = quantityUnits(used);
  if (totalUnits === null || usedUnits === null) return Number.NaN;
  return Number(totalUnits - usedUnits) / Number(QUANTITY_SCALE);
}

/** Subtract a set of matches directly, without converting the running sum to Number. */
export function subtractInvoiceQuantitySum(total: unknown, used: unknown[]): number {
  const totalUnits = quantityUnits(total);
  const units = used.map(quantityUnits);
  if (totalUnits === null || units.some((value) => value === null)) return Number.NaN;
  return Number(totalUnits - (units as bigint[]).reduce<bigint>((sum, value) => sum + value, BigInt(0))) / Number(QUANTITY_SCALE);
}

/** Exact decimal text for a remaining quantity, suitable for display and inputs. */
export function subtractInvoiceQuantitySumExact(total: unknown, used: unknown[]): string | null {
  const totalUnits = quantityUnits(total);
  const units = used.map(quantityUnits);
  if (totalUnits === null || units.some((value) => value === null)) return null;
  const remainder = totalUnits - (units as bigint[]).reduce<bigint>((sum, value) => sum + value, BigInt(0));
  const sign = remainder < BigInt(0) ? "-" : "";
  const absolute = remainder < BigInt(0) ? -remainder : remainder;
  return `${sign}${absolute / QUANTITY_SCALE}.${(absolute % QUANTITY_SCALE).toString().padStart(4, "0")}`;
}

/** Format an exact physical quantity using es-PY grouping without a Number cast. */
export function formatInvoiceQuantity(value: unknown, decimals = 4): string {
  const units = quantityUnits(value);
  if (units === null || decimals < 0 || decimals > 4) return "-";
  const integer = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Number(units / QUANTITY_SCALE));
  const fraction = (units % QUANTITY_SCALE).toString().padStart(4, "0").slice(0, decimals).replace(/0+$/, "");
  if (!fraction) return integer;
  const decimalSeparator = new Intl.NumberFormat("es-PY").formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ",";
  return `${integer}${decimalSeparator}${fraction}`;
}

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

export function orderLineRemaining(orderLine: { quantity: PhysicalQuantity; quantity_invoiced: PhysicalQuantity | null | undefined }): number {
  return subtractInvoiceQuantities(orderLine.quantity, orderLine.quantity_invoiced ?? 0);
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
    const qty = line.quantity;
    if (!line.product_description?.trim() || !isValidInvoiceQuantity(qty)) continue;
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
    const orderComparison = compareInvoiceQuantitySum([target.quantity_invoiced ?? 0, qty], target.quantity);
    proposals.push({
      invoiceItemId: line.id,
      orderItemId: target.id,
      quantityMatched: qty,
      overRemaining: orderComparison !== -1 && orderComparison !== 0,
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
 * - Cantidades físicas se aceptan hasta cuatro decimales, sin redondear.
 */
export function validateManualItemMatch(args: {
  invoiceEmpresaId: string;
  orderEmpresaId: string;
  invoiceStatus: string;
  invoiceLine: { id: string; invoice_id: string; description: string; quantity: PhysicalQuantity | null; unit: string | null };
  orderLine: { id: string; product: string; quantity: PhysicalQuantity; unit: string; quantity_invoiced: PhysicalQuantity };
  invoiceLineCount: number;
  orderLineCount: number;
  quantity: PhysicalQuantity;
  existingLineMatched: PhysicalQuantity;
  duplicateExists: boolean;
}): ManualMatchCheck {
  if (args.invoiceEmpresaId !== args.orderEmpresaId) {
    return { ok: false, error: "La línea de OC no pertenece a la empresa de la factura." };
  }
  if (["APTO_PARA_PAGO", "PAGADO"].includes(args.invoiceStatus)) {
    return { ok: false, error: "La factura ya está aprobada o pagada; la conciliación por ítem queda congelada." };
  }
  if (!isValidInvoiceQuantity(args.quantity)) {
    return { ok: false, error: INVOICE_QUANTITY_ERROR };
  }
  if (args.invoiceLine.quantity !== null && !isValidInvoiceQuantity(args.invoiceLine.quantity)) {
    return { ok: false, error: "La cantidad documentada de la línea no cumple la precisión admitida." };
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
  if (lineQty === null || !isValidInvoiceQuantity(lineQty)) {
    return { ok: false, error: "La línea no tiene cantidad documentada; no se puede imputar." };
  }
  const lineComparison = compareInvoiceQuantitySum([args.existingLineMatched, args.quantity], lineQty);
  if (lineComparison === null) {
    return { ok: false, error: "La cantidad imputada existente no cumple la precisión admitida." };
  }
  if (lineComparison === 1) {
    return { ok: false, error: `La imputación supera la cantidad documentada de la línea (${lineQty}): ya hay ${args.existingLineMatched} imputados.` };
  }
  const orderComparison = compareInvoiceQuantitySum([args.orderLine.quantity_invoiced, args.quantity], args.orderLine.quantity);
  if (orderComparison === null) {
    return { ok: false, error: "La cantidad imputada a la OC no cumple la precisión admitida." };
  }
  if (orderComparison === 1) {
    return { ok: false, error: `La cantidad supera el remanente de la OC (${orderLineRemaining(args.orderLine)} pendientes). Queda sin conciliar.` };
  }
  return { ok: true, overRemaining: false };
}

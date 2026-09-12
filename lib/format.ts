import { CurrencyCode } from "./types";

export function formatMoney(value: number | null | undefined, currency: CurrencyCode = "PYG") {
  if (value === null || value === undefined) return "-";
  const decimals = currency === "PYG" ? 0 : 2;
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value) + " " + currency;
}

export function formatNumber(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function pctDiff(value: number, base: number) {
  if (base === 0) return 0;
  return ((value - base) / base) * 100;
}

// ---------------------------------------------------------------------------
// Política monetaria canónica del ERP — NO es una autoridad nueva, replica
// exactamente lo que ya define public.budget_items en
// supabase/migrations/0028_construccion_pro.sql:
//
//   quantity    numeric(18,4)
//   unit_price  numeric(18,2)
//   subtotal    numeric(18,2) GENERATED ALWAYS AS
//               (ROUND(COALESCE(quantity, 0) * COALESCE(unit_price, 0), 2)) STORED
//
// Es decir: la cantidad se trunca/redondea a 4 decimales, el precio a 2, y el
// producto se redondea a 2 decimales con la semántica de ROUND() de Postgres
// para `numeric` — redondeo half-away-from-zero (0.5 siempre sube), NO el
// "round half to even" que usan algunos lenguajes ni el redondeo binario
// implícito de hacer `Math.round(a * b * 100) / 100` en JS (que puede fallar
// cerca de los .5 por el ruido de punto flotante de IEEE754 — ej. sumar
// varias numeric(18,4) reales puede dejar 65.7234999999999 en vez de
// 65.7235). Por eso estas funciones escalan a enteros con BigInt antes de
// redondear: el redondeo final es exacto, no depende de la representación
// binaria del float intermedio.
//
// Cualquier cálculo de "cantidad × precio unitario" en el ERP —incluido el
// módulo BIM— debe pasar por acá en vez de reimplementar `a * b` a mano.

function roundToScaledInt(value: number, decimals: number): bigint {
  return BigInt(Math.round(value * 10 ** decimals));
}

// Redondea a la precisión de budget_items.quantity (numeric(18,4)).
export function roundQuantity4(value: number): number {
  return Number(roundToScaledInt(value, 4)) / 10000;
}

// Redondea a la precisión de budget_items.unit_price / subtotal (numeric(18,2)).
export function roundMoney2(value: number): number {
  return Number(roundToScaledInt(value, 2)) / 100;
}

// Replica exactamente ROUND(quantity * unit_price, 2) — la fórmula del
// GENERATED column de budget_items.subtotal. `quantity` se asume en la
// precisión de numeric(18,4) y `unit_price` en la de numeric(18,2); ambos se
// re-escalan a enteros vía BigInt antes de multiplicar, así que el redondeo
// final a 2 decimales es exacto sin importar el ruido flotante que hayan
// acumulado quantity/unit_price como JS number.
export function calcLineSubtotal(quantity: number, unitPrice: number): number {
  // BigInt(N) en vez del sufijo literal `Nn`: el target de compilación
  // (ES2017) no admite la sintaxis de literal BigInt, aunque el tipo/runtime
  // sí están disponibles (lib esnext) — la llamada a función es equivalente.
  const qScaled = roundToScaledInt(quantity, 4); // ×10^4
  const pScaled = roundToScaledInt(unitPrice, 2); // ×10^2
  const productScaled = qScaled * pScaled; // ×10^6 — producto exacto, sin floats
  const zero = BigInt(0);
  const divisor = BigInt(10000); // 10^6 / 10^2, para llevar el producto a ×10^2
  const sign = productScaled < zero ? BigInt(-1) : BigInt(1);
  const abs = productScaled < zero ? -productScaled : productScaled;
  const roundedCents = sign * ((abs + divisor / BigInt(2)) / divisor); // half-away-from-zero
  return Number(roundedCents) / 100;
}

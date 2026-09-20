import type { CurrencyCode } from "@/lib/types";
import { formatMoney } from "@/lib/format";

/**
 * Agrupa y suma montos por moneda, asegurando que NUNCA se sumen monedas distintas.
 * Soporta tanto la propiedad `currency` como `moneda`.
 */
export function sumByCurrency<T>(
  items: T[],
  amountExtractor: (item: T) => number,
  currencyExtractor?: (item: T) => string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const rawCurr = currencyExtractor
      ? currencyExtractor(item)
      : ((item as any).currency || (item as any).moneda || "PYG");
    const curr = (rawCurr || "PYG").toUpperCase();
    const amt = amountExtractor(item);
    if (!Number.isFinite(amt)) continue;
    map.set(curr, (map.get(curr) ?? 0) + amt);
  }
  return map;
}

/**
 * Formatea los balances multi-moneda para un KPI ejecutivo:
 * - El valor principal en la moneda dominante (por defecto PYG).
 * - Si existen saldos en otras monedas (ej: USD, EUR), los expone en extraFormatted ("+ USD 18.400 + EUR 5.000").
 * - NUNCA convierte monedas ni inventa tipos de cambio.
 */
export function formatMultiCurrencyBalances(
  totalsByCurrency: Map<string, number> | Record<string, number>,
  primaryCurrency: CurrencyCode = "PYG"
): { primaryFormatted: string; extraFormatted: string | null; primaryValue: number } {
  const map =
    totalsByCurrency instanceof Map
      ? totalsByCurrency
      : new Map(Object.entries(totalsByCurrency));

  const primaryValue = map.get(primaryCurrency) ?? 0;
  const primaryFormatted = formatMoney(primaryValue, primaryCurrency);

  const extras: string[] = [];
  for (const [curr, val] of map.entries()) {
    if (curr === primaryCurrency) continue;
    if (Math.abs(val) > 0.001) {
      extras.push(`+ ${curr} ${Math.round(val).toLocaleString("es-PY")}`);
    }
  }

  return {
    primaryFormatted,
    extraFormatted: extras.length > 0 ? extras.join(" ") : null,
    primaryValue,
  };
}

export type InvoiceAmounts = { subtotal: number; vat: number; total: number };

/** One explicit tax rate; document totals with mixed rates are preserved separately. */
export function calculateInvoiceVat(
  amount: number,
  rate: number,
  included: boolean,
  currency: string,
): InvoiceAmounts | null {
  if (!Number.isFinite(amount) || amount <= 0 || ![0, 5, 10].includes(rate)) return null;
  const scale = currency === "PYG" ? 1 : 100;
  const round = (n: number) => Math.round((n + Number.EPSILON) * scale) / scale;
  const total = included ? round(amount) : round(amount * (1 + rate / 100));
  const subtotal = included ? round(total / (1 + rate / 100)) : round(amount);
  return { subtotal, vat: round(total - subtotal), total };
}

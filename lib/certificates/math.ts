export type CertificateQuantityLine = {
  qty_anterior: number;
  qty_presente: number;
  precio_unitario: number;
};

/**
 * Mirrors the GENERATED columns in project_certificate_items. Amounts are
 * rounded per line and per period; the accumulated amount is their sum.
 */
export function certificateLineAmount(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice);
}

export function certificateTotals(lines: CertificateQuantityLine[]) {
  return lines.reduce(
    (totals, line) => {
      totals.montoAnterior += certificateLineAmount(line.qty_anterior, line.precio_unitario);
      totals.montoPresente += certificateLineAmount(line.qty_presente, line.precio_unitario);
      return totals;
    },
    { montoAnterior: 0, montoPresente: 0 }
  );
}

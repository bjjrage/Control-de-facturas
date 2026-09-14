import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import type { CurrencyCode } from "@/lib/types";

export type RecepcionRow = {
  id: string;
  producto: string;
  unidad: string;
  quantity: number;
  location_name: string;
  confirmed_at: string;
  cost_currency: string | null;
  cost_total: number | null;
  order_code: string | null;
  order_id: string | null;
  provider_name: string | null;
};

// Recepciones confirmadas de ESTA obra — movement_type = 'RECEIPT' del
// dominio canónico, siempre OC/proveedor → ubicación de la obra. Son las
// que ya pasaron por confirmCanonicalReceipt (RPC inventory_confirm_receipt);
// no hay una segunda lógica de recepción acá, solo lectura.
export function RecepcionesObraSection({ rows }: { rows: RecepcionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
        Todavía no hay recepciones confirmadas para esta obra en el inventario canónico.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <table>
        <thead>
          <tr>
            <th>OC / Proveedor</th>
            <th>Producto</th>
            <th className="num">Cantidad</th>
            <th>Ubicación</th>
            <th className="num">Costo</th>
            <th>Confirmada</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.order_id ? (
                  <Link href={`/orders/${r.order_id}`} className="text-action font-medium">
                    {r.order_code ?? "OC"}
                  </Link>
                ) : (
                  <Badge tone="neutral">Sin OC</Badge>
                )}
                {r.provider_name ? <div className="text-[11px] text-[var(--muted)]">{r.provider_name}</div> : null}
              </td>
              <td>
                {r.producto} <span className="text-[var(--muted)] text-[11px]">{r.unidad}</span>
              </td>
              <td className="num">{formatNumber(r.quantity, 2)}</td>
              <td className="text-[var(--muted)]">{r.location_name}</td>
              <td className="num">
                {r.cost_total != null ? formatMoney(r.cost_total, (r.cost_currency ?? "PYG") as CurrencyCode) : "—"}
              </td>
              <td className="text-[var(--muted)]">{formatDateTime(r.confirmed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

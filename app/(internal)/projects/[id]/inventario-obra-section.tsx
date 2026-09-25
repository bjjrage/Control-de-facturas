import { Badge } from "@/components/ui/badge";
import { formatMoney, formatNumber } from "@/lib/format";
import type { CurrencyCode } from "@/lib/types";

export type StockObraRow = {
  producto_id: string;
  producto: string;
  unidad: string;
  cost_currency: string | null;
  cost_status: "COMPUTABLE" | "REVISION_REQUERIDA";
  quantity: number;
  total_cost: number | null;
};

export type ConsumoCanonicoRow = {
  budget_item_id: string | null;
  producto_id: string;
  producto: string;
  unidad: string;
  quantity_consumed: number;
  cost_currency: string | null;
  cost_consumed: number | null;
  cost_consumed_company: number | null;
};

// Stock y consumo canónicos de ESTA obra — dominio certificado
// (inventory_stock_by_project / inventory_consumption_by_budget). No se
// mezcla con "Stock / Materiales (legacy)": acá "disponible" es el saldo
// real por ubicación, y "consumido" es solo CONSUMPTION confirmado contra
// una partida, nunca recepción ni transferencia.
export function InventarioObraSection({
  stock,
  consumo,
  budgetItemLabelById,
}: {
  stock: StockObraRow[];
  consumo: ConsumoCanonicoRow[];
  budgetItemLabelById: Map<string, string>;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[13px] font-semibold mb-2">Inventario disponible en la obra</h3>
        {stock.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
            Todavía no hay saldo canónico registrado para esta obra.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Disponible</th>
                  <th className="num">Costo</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((r) => (
                  <tr key={r.producto_id}>
                    <td className="font-medium">
                      {r.producto} <span className="text-[var(--muted)] text-[11px] font-normal">{r.unidad}</span>
                    </td>
                    <td className={`num ${r.quantity < 0 ? "text-[var(--error)]" : ""}`}>{formatNumber(r.quantity, 2)}</td>
                    <td className="num">
                      {r.cost_status === "COMPUTABLE" ? (
                        formatMoney(r.total_cost ?? 0, (r.cost_currency ?? "PYG") as CurrencyCode)
                      ) : (
                        <Badge tone="warn">Revisión de costo</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-[13px] font-semibold mb-2">Consumo confirmado por partida (canónico)</h3>
        {consumo.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
            Todavía no hay consumos confirmados en el inventario canónico para esta obra.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Partida</th>
                  <th>Producto</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Costo real</th>
                </tr>
              </thead>
              <tbody>
                {consumo.map((r, i) => (
                  <tr key={`${r.budget_item_id ?? "sin-partida"}-${r.producto_id}-${i}`}>
                    <td>{r.budget_item_id ? budgetItemLabelById.get(r.budget_item_id) ?? "—" : "Sin partida"}</td>
                    <td>
                      {r.producto} <span className="text-[var(--muted)] text-[11px]">{r.unidad}</span>
                    </td>
                    <td className="num">{formatNumber(r.quantity_consumed, 2)}</td>
                    <td className="num">
                      {r.cost_consumed_company != null
                        ? formatMoney(r.cost_consumed_company, "PYG")
                        : r.cost_consumed != null
                          ? formatMoney(r.cost_consumed, (r.cost_currency ?? "PYG") as CurrencyCode)
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Costo real en la moneda de la empresa cuando el consumo se registró con tipo de cambio; si no, en la
        moneda original del costo. No se recalculan promedios ni conversiones acá.
      </p>
    </div>
  );
}

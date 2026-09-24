import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatNumber } from "@/lib/format";
import type {
  ManualMovementBalanceOption,
  ManualMovementLocationOption,
  ManualMovementProductOption,
} from "@/lib/inventory/manual";
import type { CurrencyCode } from "@/lib/types";
import { NuevoMovimientoDialog } from "./nuevo-movimiento-dialog";

export type GlobalRow = { producto_id: string; producto: string; unidad: string; quantity: number };
export type LocationRow = {
  location_id: string;
  location_name: string;
  location_type: "CENTRAL" | "PROJECT" | "AUXILIARY";
  project_id: string | null;
  producto_id: string;
  producto: string;
  unidad: string;
  cost_currency: string | null;
  quantity: number;
  total_cost: number | null;
  cost_status: "COMPUTABLE" | "REVISION_REQUERIDA";
};

const LOCATION_TYPE_LABEL: Record<LocationRow["location_type"], string> = {
  CENTRAL: "Depósito central",
  PROJECT: "Obra",
  AUXILIARY: "Auxiliar",
};

// Resumen de inventario global — dominio canónico certificado
// (inventory_balances / 0080_inventory_panol.sql). El "disponible" acá viene
// de la suma real de saldos por ubicación, nunca de un contador aparte.
export function InventarioGlobalSection({
  movementAttemptStorageKey,
  globalRows,
  locationRows,
  projectNameById,
  movementLocations,
  movementProducts,
  movementBalances,
  movementOptionsError,
}: {
  movementAttemptStorageKey: string;
  globalRows: GlobalRow[];
  locationRows: LocationRow[];
  projectNameById: Map<string, string>;
  movementLocations: ManualMovementLocationOption[];
  movementProducts: ManualMovementProductOption[];
  movementBalances: ManualMovementBalanceOption[];
  movementOptionsError: string | null;
}) {
  const ubicacionesActivas = new Set(locationRows.map((r) => r.location_id)).size;
  const valorTotalPyg = locationRows
    .filter((r) => r.cost_status === "COMPUTABLE" && r.cost_currency === "PYG")
    .reduce((s, r) => s + (r.total_cost ?? 0), 0);
  const enRevision = locationRows.filter((r) => r.cost_status === "REVISION_REQUERIDA").length;

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold">Inventario global</h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            Stock real por producto y ubicación — dominio canónico de inventario.
          </p>
        </div>
        <NuevoMovimientoDialog
          attemptStorageKey={movementAttemptStorageKey}
          locations={movementLocations}
          products={movementProducts}
          balances={movementBalances}
          optionsError={movementOptionsError}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Productos con stock</div>
          <div className="text-[22px] font-bold mt-1">{globalRows.length}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Ubicaciones activas</div>
          <div className="text-[22px] font-bold mt-1">{ubicacionesActivas}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Valor total (PYG)</div>
          <div className="text-[16px] font-bold mt-1">{formatMoney(valorTotalPyg, "PYG")}</div>
          {enRevision > 0 ? (
            <div className="text-[11px] text-[var(--warn)] mt-0.5">{enRevision} en revisión de costo</div>
          ) : null}
        </div>
      </div>

      <div>
        <h2 className="text-[13px] font-semibold mb-2">Disponibilidad global por producto</h2>
        {globalRows.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
            Todavía no hay saldo registrado en el inventario canónico.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Unidad</th>
                  <th className="num">Disponible</th>
                </tr>
              </thead>
              <tbody>
                {globalRows.map((r) => (
                  <tr key={r.producto_id}>
                    <td className="font-medium">{r.producto}</td>
                    <td className="text-[var(--muted)]">{r.unidad}</td>
                    <td className={`num font-semibold ${r.quantity < 0 ? "text-[var(--error)]" : ""}`}>
                      {formatNumber(r.quantity, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[13px] font-semibold mb-2">Detalle por ubicación</h2>
        {locationRows.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
            No hay saldo con cantidad positiva en ninguna ubicación.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Ubicación</th>
                  <th>Producto</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Costo</th>
                </tr>
              </thead>
              <tbody>
                {locationRows.map((r) => (
                  <tr key={`${r.location_id}-${r.producto_id}-${r.cost_currency ?? r.cost_status}`}>
                    <td>
                      <div className="font-medium">
                        {r.project_id ? (
                          <Link href={`/projects/${r.project_id}?tab=inventario`} className="text-action">
                            {r.location_name}
                          </Link>
                        ) : (
                          r.location_name
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {LOCATION_TYPE_LABEL[r.location_type]}
                        {r.project_id ? ` · ${projectNameById.get(r.project_id) ?? ""}` : ""}
                      </div>
                    </td>
                    <td>{r.producto} <span className="text-[var(--muted)] text-[11px]">{r.unidad}</span></td>
                    <td className="num">{formatNumber(r.quantity, 2)}</td>
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
    </div>
  );
}

"use client";

import type {
  WeeklyPlanCalculationSummary,
} from "@/lib/types";
import type { MrpPreviewResult } from "../weekly-plan-actions";

interface RecipeSnapshot {
  recipeId: string;
  code: string;
  name: string;
  unit: string;
  targetQty: number;
  front: string;
}

interface Props {
  preview: WeeklyPlanCalculationSummary;
  previewRecipe: RecipeSnapshot;
  previewMrp: MrpPreviewResult;
}

/**
 * Resultado MRP de producción (V3): objetivo → partidas físicas →
 * cobertura (necesito/obra/central/inbound/comprar) → caja.
 * La necesidad bruta viene del engine; aquí solo se presenta la asignación.
 */
export function MrpResultPanel({ preview, previewRecipe, previewMrp }: Props) {
  return (
    <div data-testid="resultado-receta" className="glass glass-accent-green p-4 space-y-3">
      <div>
        <div className="break-words text-sm font-bold text-[var(--foreground)]">
          {previewRecipe.code} · {previewRecipe.name} — +{previewRecipe.targetQty}{" "}
          {previewRecipe.unit}
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--muted)]">
          Objetivo: +{previewRecipe.targetQty} {previewRecipe.unit} · Frente {previewRecipe.front} ·
          Fecha objetivo: {previewMrp.neededBy}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Partidas físicas
        </div>
        <div className="mt-1.5 space-y-1">
          {preview.items.map((ci) => (
            <div key={`${ci.budget_item_id}-${ci.front_label || ""}`} className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="min-w-0 break-words text-[var(--foreground)]">
                <span className="font-mono text-[var(--muted)] mr-2">{ci.item_code}</span>
                {ci.item_description}
                {ci.front_label ? ` · ${ci.front_label}` : ""}
                {ci.was_capped && (
                  <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-300">(limitado)</span>
                )}
              </span>
              <span className="font-semibold whitespace-nowrap">
                {ci.target_quantity.toLocaleString("es-PY")} {ci.unit}
              </span>
            </div>
          ))}
        </div>
      </div>

      {previewMrp.centralError && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-300">
          No se pudo leer el stock central ({previewMrp.centralError}): se muestra 0 sin asumir falta de stock.
        </div>
      )}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          Materiales / recursos
        </div>
        {previewMrp.lines.length === 0 ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Sin materiales vinculados a estas partidas (ver detalle por partida).
          </p>
        ) : (
          <div data-testid="tabla-mrp" className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
                  <th className="py-1.5 px-2">Material</th>
                  <th className="py-1.5 px-2 text-right">Necesito</th>
                  <th className="py-1.5 px-2 text-right">Obra</th>
                  <th className="py-1.5 px-2 text-right">Central</th>
                  <th className="py-1.5 px-2 text-right">Inbound</th>
                  <th className="py-1.5 px-2 text-right">Comprar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {previewMrp.lines.map((l) => (
                  <tr key={l.producto_id}>
                    <td className="py-1.5 px-2 font-medium text-[var(--foreground)]">
                      {l.producto_nombre}
                      {l.costo_no_disponible && (
                        <span className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-300 font-normal">
                          (Costo no disponible)
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right">{l.requerido.toLocaleString("es-PY")} {l.unidad_medida}</td>
                    <td className="py-1.5 px-2 text-right text-emerald-700 dark:text-emerald-300">{l.cubierto_obra.toLocaleString("es-PY")}</td>
                    <td className="py-1.5 px-2 text-right text-blue-700 dark:text-blue-300">{l.cubierto_central.toLocaleString("es-PY")}</td>
                    <td className="py-1.5 px-2 text-right text-blue-700 dark:text-blue-300">{l.cubierto_inbound.toLocaleString("es-PY")}</td>
                    <td className="py-1.5 px-2 text-right font-bold text-amber-700 dark:text-amber-300">{l.comprar.toLocaleString("es-PY")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {previewMrp.lines.some((l) => l.cubierto_central > 0) && (
        <div data-testid="movimiento-sugerido" className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-2.5 text-[11px]">
          <div className="font-semibold text-[var(--foreground)]">
            Movimiento sugerido — desde depósito central
            {previewMrp.centralLocation ? ` (${previewMrp.centralLocation.name})` : ""}:
          </div>
          <ul className="mt-1 list-disc pl-4 text-[var(--muted)]">
            {previewMrp.lines
              .filter((l) => l.cubierto_central > 0)
              .map((l) => (
                <li key={l.producto_id}>
                  {l.cubierto_central.toLocaleString("es-PY")} {l.unidad_medida} {l.producto_nombre}
                </li>
              ))}
          </ul>
          <p className="mt-1 text-[var(--muted)]">Al comprometer el plan se reserva (no se transfiere solo).</p>
        </div>
      )}

      {previewMrp.lines.some((l) => l.comprar > 0) && (
        <div data-testid="compras-necesarias" className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-2.5 text-[11px]">
          <div className="font-semibold text-[var(--foreground)]">Compras necesarias:</div>
          <ul className="mt-1 list-disc pl-4 text-[var(--muted)]">
            {previewMrp.lines
              .filter((l) => l.comprar > 0)
              .map((l) => (
                <li key={l.producto_id}>
                  {l.comprar.toLocaleString("es-PY")} {l.unidad_medida} {l.producto_nombre}
                </li>
              ))}
          </ul>
        </div>
      )}

      {previewMrp.unconfirmedInbound.length > 0 && (
        <div className="text-[11px] text-[var(--muted)]">
          En compra, fecha no confirmada (no descuenta el faltante):{" "}
          {previewMrp.unconfirmedInbound
            .map((u) => `${u.cantidad.toLocaleString("es-PY")} ${u.producto_nombre}`)
            .join(" · ")}
        </div>
      )}

      <div className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide font-bold">
          Caja adicional necesaria
        </div>
        <div data-testid="caja-mrp" className="text-2xl font-extrabold text-[var(--foreground)]">
          Gs. {previewMrp.total_caja_adicional.toLocaleString("es-PY")}
        </div>
        {previewMrp.costos_pendientes > 0 && (
          <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Costo no disponible en {previewMrp.costos_pendientes}{" "}
            {previewMrp.costos_pendientes === 1 ? "material" : "materiales"}: esa parte no
            suma a la caja (no se muestra 0 como si no hiciera falta comprar).
          </div>
        )}
      </div>
    </div>
  );
}

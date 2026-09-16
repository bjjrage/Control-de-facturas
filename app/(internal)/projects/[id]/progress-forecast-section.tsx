"use client";

import { useState, useTransition } from "react";
import {
  Sparkles,
  Calendar,
  CloudRain,
  AlertTriangle,
  TrendingUp,
  Boxes,
  DollarSign,
  ChevronDown,
  ChevronUp,
  MapPin,
  RefreshCw,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  Project,
  ProgressForecastRunSummary,
  ForecastItemResult,
  MaterialRequirementDetail,
} from "@/lib/types";
import { runProgressForecastAction } from "../progress-forecast-actions";

export function ProgressForecastSection({ project }: { project: Project }) {
  const [horizon, setHorizon] = useState<number>(7);
  const [customDays, setCustomDays] = useState<string>("7");
  const [isCustom, setIsCustom] = useState<boolean>(false);
  const [latitude, setLatitude] = useState<string>(
    project.latitude ? String(project.latitude) : "-25.2867"
  );
  const [longitude, setLongitude] = useState<string>(
    project.longitude ? String(project.longitude) : "-57.6470"
  );
  const [showLocationModal, setShowLocationModal] = useState<boolean>(false);
  const [forecastResult, setForecastResult] =
    useState<ProgressForecastRunSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeDays = isCustom ? Math.max(7, Number(customDays) || 7) : horizon;

  const handleRunForecast = () => {
    setErrorMsg(null);
    startTransition(async () => {
      const latNum = Number(latitude);
      const lonNum = Number(longitude);
      const res = await runProgressForecastAction({
        projectId: project.id,
        horizonDays: activeDays,
        customLatitude: isNaN(latNum) ? undefined : latNum,
        customLongitude: isNaN(lonNum) ? undefined : lonNum,
      });

      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setForecastResult(res.data);
      }
    });
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xs space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              Proyección Semanal Inteligente de Obra + Materiales + Impacto en Caja
            </h3>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Estimación de avance físico y demanda de compras a horizonte mínimo semanal (7d, 14d, 30d) asistida por operabilidad climática.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Location button */}
          <Button
            variant="secondary"
            onClick={() => setShowLocationModal(!showLocationModal)}
            className="text-xs h-8"
            title="Configurar coordenadas meteorológicas"
          >
            <MapPin className="h-3.5 w-3.5 mr-1 text-emerald-600" />
            {project.latitude ? "Ubicación fijada" : "Asunción (predeterminada)"}
          </Button>

          {/* Horizon Selector */}
          <div className="flex rounded-lg bg-[var(--panel-2)] p-0.5 border border-[var(--border)] text-xs font-medium">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setIsCustom(false);
                  setHorizon(d);
                }}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  !isCustom && horizon === d
                    ? "bg-[var(--panel)] text-[var(--foreground)] shadow-xs"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {d} días
              </button>
            ))}
            <button
              type="button"
              onClick={() => setIsCustom(true)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                isCustom
                  ? "bg-[var(--panel)] text-[var(--foreground)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Otro
            </button>
          </div>

          {isCustom && (
            <div className="w-20">
              <Input
                type="number"
                min={7}
                max={90}
                value={customDays}
                onChange={(e) => {
                  const val = e.target.value;
                  setCustomDays(val);
                }}
                placeholder="≥ 7 días"
                className="h-8 text-xs text-center"
              />
            </div>
          )}

          <Button
            onClick={handleRunForecast}
            disabled={isPending}
            className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Analizando...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Proyectar ({activeDays}d)
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Optional Location Settings Drawer */}
      {showLocationModal && (
        <div className="p-4 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[var(--foreground)]">
              Coordenadas de la obra para Open-Meteo
            </span>
            <button
              type="button"
              onClick={() => setShowLocationModal(false)}
              className="text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Cerrar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[var(--muted)] block mb-1">Latitud:</label>
              <Input
                type="text"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="-25.2867"
                className="h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[var(--muted)] block mb-1">Longitud:</label>
              <Input
                type="text"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="-57.6470"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Estas coordenadas se persistirán en el proyecto para que los pronósticos futuros se consulten automáticamente.
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Forecast Output */}
      {forecastResult ? (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: Avance Contractual Físico */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Avance Físico Esperado</span>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-lg font-bold text-[var(--foreground)]">
                Gs. {forecastResult.total_projected_physical_value.toLocaleString("es-PY")}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">
                Valor contractual esperado ({forecastResult.items.length} partidas activas)
              </div>
            </div>

            {/* KPI 2: Clima y Días Laborables */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Operabilidad en {forecastResult.days_in_horizon} días</span>
                <CloudRain className="h-4 w-4 text-blue-500" />
              </div>
              <div className="mt-2 text-lg font-bold text-[var(--foreground)]">
                {forecastResult.workable_days_count} días practicables
              </div>
              <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                {forecastResult.partially_blocked_days_count + forecastResult.fully_blocked_days_count > 0
                  ? `${forecastResult.partially_blocked_days_count} parciales, ${forecastResult.fully_blocked_days_count} bloqueados por lluvia/viento`
                  : "Sin lluvias severas proyectadas"}
              </div>
            </div>

            {/* KPI 3: Consumo de Materiales y Cobertura */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Material a Consumir</span>
                <Boxes className="h-4 w-4 text-indigo-500" />
              </div>
              <div className="mt-2 text-lg font-bold text-[var(--foreground)]">
                Gs. {forecastResult.total_material_consumption_value.toLocaleString("es-PY")}
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)] space-y-0.5">
                <div>Cubierto por stock: Gs. {forecastResult.total_covered_by_stock_value.toLocaleString("es-PY")}</div>
                <div>Cubierto por OCs: Gs. {forecastResult.total_covered_by_inbound_value.toLocaleString("es-PY")}</div>
              </div>
            </div>

            {/* KPI 4: Salida de Caja Adicional Requerida */}
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-300 font-medium">
                <span>Caja Adicional Requerida</span>
                <DollarSign className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-2 text-lg font-bold text-amber-800 dark:text-amber-200">
                Gs. {forecastResult.total_additional_cash_required.toLocaleString("es-PY")}
              </div>
              <div className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/80">
                Déficit neto a comprar (impacto real en flujo de caja)
              </div>
            </div>
          </div>

          {forecastResult.climate_metrics ? (
            <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 p-4 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-[var(--foreground)]">Impacto climático acumulado</h4>
                <span className="text-[var(--muted)]">Incluido en este snapshot</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><div className="text-[var(--muted)]">Días de lluvia</div><div className="mt-1 font-semibold">{forecastResult.climate_metrics.rain_lost_days}</div></div>
                <div><div className="text-[var(--muted)]">Efectos de lluvia</div><div className="mt-1 font-semibold">{forecastResult.climate_metrics.rain_effect_lost_days}</div></div>
                <div><div className="text-[var(--muted)]">Días disponibles</div><div className="mt-1 font-semibold">{forecastResult.climate_metrics.effective_available_days}</div></div>
                <div><div className="text-[var(--muted)]">Varianza ajustada</div><div className="mt-1 font-semibold">{forecastResult.climate_metrics.weather_adjusted_variance}</div></div>
              </div>
            </div>
          ) : null}

          {/* AI Operational Assessment Notice */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 flex items-start gap-3 text-xs">
            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[var(--foreground)] flex items-center gap-2">
                <span>Diagnóstico Operacional</span>
                {forecastResult.llm_analysis_used ? (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300 font-medium">
                    Ajustado con Inteligencia Operativa
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300 font-medium">
                    Proyección Base (Degradada sin IA)
                  </span>
                )}
              </div>
              <p className="mt-1 text-[var(--muted)]">
                {forecastResult.llm_summary}
              </p>
            </div>
          </div>

          {/* Detailed Items Table */}
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <div className="bg-[var(--panel-2)] px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
              <h4 className="text-xs font-semibold text-[var(--foreground)] uppercase tracking-wider">
                Desglose por Partida Presupuestaria ({forecastResult.items.length})
              </h4>
              <span className="text-[11px] text-[var(--muted)]">
                Clic en una partida para ver demanda de materiales, stock y compras
              </span>
            </div>

            <div className="divide-y divide-[var(--border)] overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[var(--panel-2)]/50 text-[var(--muted)] font-medium">
                    <th className="py-2 px-3">Código</th>
                    <th className="py-2 px-3">Partida</th>
                    <th className="py-2 px-3 text-right">Pendiente</th>
                    <th className="py-2 px-3 text-right">Ritmo Base</th>
                    <th className="py-2 px-3 text-center">Operabilidad</th>
                    <th className="py-2 px-3 text-right">Avance Proyectado</th>
                    <th className="py-2 px-3 text-right">Nuevo %</th>
                    <th className="py-2 px-3 text-right">Valor Contractual</th>
                    <th className="py-2 px-2 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {forecastResult.items.map((it) => {
                    const isExpanded = expandedItemId === it.budget_item_id;
                    return (
                      <ItemRow
                        key={it.budget_item_id}
                        item={it}
                        isExpanded={isExpanded}
                        onToggle={() =>
                          setExpandedItemId(
                            isExpanded ? null : it.budget_item_id
                          )
                        }
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center rounded-lg border border-dashed border-[var(--border)]">
          <Clock className="mx-auto h-8 w-8 text-[var(--muted)] opacity-50" />
          <h4 className="mt-3 text-sm font-medium text-[var(--foreground)]">
            Ninguna proyección ejecutada para este horizonte
          </h4>
          <p className="mt-1 text-xs text-[var(--muted)] max-w-md mx-auto">
            Hacé clic en &quot;Proyectar&quot; para estimar el avance de las próximas {activeDays} jornadas cruzando el pronóstico del clima con la velocidad de obra y el inventario disponible.
          </p>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: ForecastItemResult;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusBadge = () => {
    switch (item.operational_status) {
      case "BLOCKED":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">
            Bloqueado ({(item.workability_factor * 100).toFixed(0)}%)
          </span>
        );
      case "PARTIAL":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            Parcial ({(item.workability_factor * 100).toFixed(0)}%)
          </span>
        );
      case "DEGRADED":
      case "UNAVAILABLE":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--panel-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)] border border-[var(--border)]">
            Base sin clima
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
            Normal (100%)
          </span>
        );
    }
  };

  const confidenceBadge = () => {
    switch (item.velocity_confidence) {
      case "HIGH":
        return <span className="text-[10px] text-emerald-600 font-medium" title={`${item.velocity_observations_count} días observados en los últimos ${item.velocity_window_days}d`}>• Alta conf. ({item.velocity_observations_count}d)</span>;
      case "MEDIUM":
        return <span className="text-[10px] text-blue-600 font-medium" title={`${item.velocity_observations_count} días observados`}>• Media conf. ({item.velocity_observations_count}d)</span>;
      case "LOW":
        return <span className="text-[10px] text-amber-600 font-medium" title="1 día observado">• Baja conf. (1d)</span>;
      default:
        return <span className="text-[10px] text-[var(--muted)]" title="Sin registros recientes; usando ritmo planificado">• Teórica/Plan</span>;
    }
  };

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-[var(--hover)] transition-colors"
      >
        <td className="py-2.5 px-3 font-mono text-[var(--muted)]">{item.item_code}</td>
        <td className="py-2.5 px-3 font-medium text-[var(--foreground)]">
          <div>{item.item_description}</div>
          <div className="text-[11px] text-[var(--muted)] font-normal line-clamp-1">
            {item.operational_reasoning}
          </div>
        </td>
        <td className="py-2.5 px-3 text-right">
          {item.remaining_quantity.toLocaleString("es-PY")} {item.unit}
        </td>
        <td className="py-2.5 px-3 text-right font-mono">
          <div className="text-[var(--foreground)] font-medium">{item.base_daily_velocity.toFixed(2)}/día</div>
          <div>{confidenceBadge()}</div>
        </td>
        <td className="py-2.5 px-3 text-center">{statusBadge()}</td>
        <td className="py-2.5 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
          +{item.projected_quantity.toLocaleString("es-PY")} {item.unit}
        </td>
        <td className="py-2.5 px-3 text-right font-semibold">
          {item.new_projected_progress_pct.toFixed(1)}%
        </td>
        <td className="py-2.5 px-3 text-right font-medium">
          Gs. {item.valor_fisico_proyectado.toLocaleString("es-PY")}
        </td>
        <td className="py-2.5 px-2 text-center text-[var(--muted)]">
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={9} className="bg-[var(--panel-2)]/60 p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--foreground)] flex items-center gap-1.5">
                  <Boxes className="h-3.5 w-3.5 text-indigo-500" />
                  Desglose de Materiales e Insumos (BOM)
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {item.materials.length === 0
                    ? "Esta partida no tiene materiales vinculados aún"
                    : `${item.materials.length} insumos requeridos`}
                </span>
              </div>

              {item.materials.length > 0 ? (
                <div className="rounded border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
                        <th className="py-1.5 px-2">Insumo</th>
                        <th className="py-1.5 px-2 text-right">Demanda Bruta</th>
                        <th className="py-1.5 px-2 text-right">Stock en Obra</th>
                        <th className="py-1.5 px-2 text-right">OCs en Tránsito</th>
                        <th className="py-1.5 px-2 text-right font-bold text-amber-600">
                          Déficit / Compra
                        </th>
                        <th className="py-1.5 px-2 text-right">Costo Unitario</th>
                        <th className="py-1.5 px-2 text-right">Valor Consumo</th>
                        <th className="py-1.5 px-2 text-right font-bold text-amber-600">
                          Caja Requerida
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {item.materials.map((m) => (
                        <tr key={m.producto_id}>
                          <td className="py-1.5 px-2 font-medium">
                            {m.producto_nombre}
                            {m.requiere_atencion_costo && (
                              <span className="ml-1.5 text-[10px] text-amber-600 font-normal">
                                (Sin costo promedio)
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            {m.demanda_bruta.toLocaleString("es-PY")} {m.unidad_medida}
                          </td>
                          <td className="py-1.5 px-2 text-right text-emerald-600">
                            {m.stock_disponible.toLocaleString("es-PY")} {m.unidad_medida}
                          </td>
                          <td className="py-1.5 px-2 text-right text-blue-600">
                            {m.oc_inbound.toLocaleString("es-PY")} {m.unidad_medida}
                          </td>
                          <td className="py-1.5 px-2 text-right font-bold text-amber-700 dark:text-amber-400">
                            {m.deficit_compra_neta.toLocaleString("es-PY")} {m.unidad_medida}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-[var(--muted)]">
                            {m.costo_unitario
                              ? `Gs. ${m.costo_unitario.toLocaleString("es-PY")}`
                              : "—"}
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            Gs. {m.valor_consumo_proyectado.toLocaleString("es-PY")}
                          </td>
                          <td className="py-1.5 px-2 text-right font-bold text-amber-700 dark:text-amber-300">
                            Gs. {m.caja_adicional_requerida.toLocaleString("es-PY")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[11px] text-[var(--muted)] italic p-2 rounded bg-[var(--panel)] border border-dashed border-[var(--border)]">
                  Para proyectar compras automáticas, vinculá los insumos de esta partida en la tabla de materiales (BOM).
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

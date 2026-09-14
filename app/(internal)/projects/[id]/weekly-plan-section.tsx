"use client";

import { useState, useTransition, useEffect } from "react";
import {
  Calendar,
  Layers,
  TrendingUp,
  Boxes,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Save,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CloudRain,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  Project,
  BudgetItem,
  WeeklyPlanCalculationSummary,
  WeeklyPlanItemCalculation,
  WeeklyPlanInputMode,
  WeeklyPlanStatus,
} from "@/lib/types";
import {
  getWeeklyPlanDetailsAction,
  saveWeeklyPlanAction,
} from "../weekly-plan-actions";

interface Props {
  project: Project;
}

interface EditableFrontTarget {
  id: string; // unique client key for this row
  budget_item_id: string;
  front_label: string;
  input_mode: WeeklyPlanInputMode;
  input_value: number;
}

export function WeeklyPlanSection({ project }: Props) {
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();

  // Plan metadata
  const [planId, setPlanId] = useState<string | undefined>(undefined);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [status, setStatus] = useState<WeeklyPlanStatus>("DRAFT");
  const [notes, setNotes] = useState<string>("");

  // Weather overlay toggle
  const [weatherOverlay, setWeatherOverlay] = useState<boolean>(false);

  // Raw budget items & live engine calculation
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [calculation, setCalculation] =
    useState<WeeklyPlanCalculationSummary | null>(null);

  // Multi-front editable targets list
  const [frontTargets, setFrontTargets] = useState<EditableFrontTarget[]>([]);

  // Expanded item breakdown in UI
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

  // Load initial weekly plan details
  const loadPlan = async (withWeather: boolean = weatherOverlay) => {
    setLoading(true);
    setErrorMsg(null);
    const res = await getWeeklyPlanDetailsAction({
      projectId: project.id,
      weatherOverlay: withWeather,
    });
    if (res.error) {
      setErrorMsg(res.error);
    } else if (res.data) {
      const { plan, calculation: calc, budgetItems: bItems } = res.data;
      setBudgetItems(bItems);
      setCalculation(calc);
      if (plan) {
        setPlanId(plan.id);
        setStartDate(plan.start_date);
        setEndDate(plan.end_date);
        setStatus(plan.status);
        setNotes(plan.notes || "");
      } else {
        setStartDate(calc.start_date);
        setEndDate(calc.end_date);
      }

      // Convert calculated items into editable front targets
      const editableList: EditableFrontTarget[] = [];
      calc.items.forEach((it, idx) => {
        editableList.push({
          id: `${it.budget_item_id}-${it.front_label || "default"}-${idx}`,
          budget_item_id: it.budget_item_id,
          front_label: it.front_label || "",
          input_mode: it.input_mode,
          input_value: it.input_value,
        });
      });
      setFrontTargets(editableList);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPlan(weatherOverlay);
  }, [project.id, weatherOverlay]);

  // Add front row for a budget item
  const handleAddFront = (budgetItemId: string) => {
    const newFront: EditableFrontTarget = {
      id: `${budgetItemId}-front-${Date.now()}`,
      budget_item_id: budgetItemId,
      front_label: "Nuevo Frente",
      input_mode: "QUANTITY",
      input_value: 0,
    };
    setFrontTargets([...frontTargets, newFront]);
  };

  // Remove front row
  const handleRemoveFront = (targetId: string) => {
    setFrontTargets(frontTargets.filter((t) => t.id !== targetId));
  };

  // Update target value or label
  const handleUpdateFront = (
    targetId: string,
    field: "input_value" | "front_label" | "input_mode",
    val: any
  ) => {
    setFrontTargets(
      frontTargets.map((t) => {
        if (t.id !== targetId) return t;
        return {
          ...t,
          [field]: field === "input_value" ? Math.max(0, parseFloat(val) || 0) : val,
        };
      })
    );
  };

  // Save current plan atomically
  const handleSavePlan = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    startSaveTransition(async () => {
      const itemsToSave = frontTargets
        .filter((t) => t.input_value > 0)
        .map((t) => {
          const bItem = budgetItems.find((b) => b.id === t.budget_item_id);
          return {
            budgetItemId: t.budget_item_id,
            frontLabel: t.front_label ? t.front_label.trim() : null,
            inputMode: t.input_mode,
            inputValue: t.input_value,
            unit: bItem?.unit || "unid",
          };
        });

      const res = await saveWeeklyPlanAction({
        planId,
        projectId: project.id,
        startDate,
        endDate,
        status,
        notes,
        weatherSnapshotBatchId: calculation?.weather_snapshot_id || null,
        items: itemsToSave,
      });

      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setSuccessMsg("Plan semanal guardado de forma atómica.");
        await loadPlan(weatherOverlay);
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[var(--muted)]">
        <RefreshCw className="h-5 w-5 animate-spin mr-2 text-emerald-600" />
        Cargando plan semanal y cálculo de abastecimiento...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xs space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--border)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--foreground)]">
                Plan Semanal de Obra / Lookahead Operacional
              </h3>
              <p className="text-xs text-[var(--muted)]">
                Fijación de metas físicas semanales, explosión determinística de materiales y cálculo de caja requerida.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Weather Overlay Toggle Button */}
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setWeatherOverlay(false)}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                !weatherOverlay
                  ? "bg-emerald-600 text-white font-semibold"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              Clima OFF
            </button>
            <button
              type="button"
              onClick={() => setWeatherOverlay(true)}
              className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors ${
                weatherOverlay
                  ? "bg-blue-600 text-white font-semibold"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              <CloudRain className="h-3 w-3" />
              Clima ON
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs bg-[var(--panel-2)] p-1 rounded-lg border border-[var(--border)]">
            <span className="text-[var(--muted)] px-1">Período:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent border-0 text-xs text-[var(--foreground)] focus:outline-hidden"
            />
            <span className="text-[var(--muted)]">al</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent border-0 text-xs text-[var(--foreground)] focus:outline-hidden"
            />
          </div>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as WeeklyPlanStatus)}
            className="h-8 text-xs rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[var(--foreground)] focus:outline-hidden"
          >
            <option value="DRAFT">Borrador (DRAFT)</option>
            <option value="COMMITTED">Comprometido (COMMITTED)</option>
            <option value="CLOSED">Cerrado (CLOSED)</option>
          </select>

          <Button
            onClick={handleSavePlan}
            disabled={isSaving}
            className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isSaving ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Guardar Plan
          </Button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-700 dark:text-red-300 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Weather Overlay Notice Banner */}
      {calculation?.weather_overlay_enabled && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3.5 flex items-start justify-between gap-3 text-xs text-blue-800 dark:text-blue-300">
          <div className="flex items-start gap-2.5">
            <CloudRain className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-2">
                <span>Escenario con Pronóstico Meteorológico LIVE ({calculation.weather_provider})</span>
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium">
                  {calculation.weather_days_affected_count} días afectados
                </span>
              </div>
              <p className="mt-1 text-blue-800/90 dark:text-blue-300/90">
                {calculation.weather_summary}. Las metas del plan base y la recomendación de compra se preservan al 100% sin recortes automáticos por lluvia.
              </p>
            </div>
          </div>
          {typeof calculation.weather_adjusted_material_consumption_value === "number" && (
            <div className="text-right shrink-0">
              <div className="text-[11px] text-[var(--muted)]">Consumo Esperado con Clima:</div>
              <div className="text-sm font-bold text-blue-900 dark:text-blue-200">
                Gs. {calculation.weather_adjusted_material_consumption_value.toLocaleString("es-PY")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary KPI Cards */}
      {calculation && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Avance Global */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Avance Global Ponderado</span>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-xl font-bold text-[var(--foreground)]">
              {calculation.global_current_progress_pct}% →{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {calculation.global_target_progress_pct}%
              </span>
            </div>
            <div className="mt-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              +{calculation.global_increment_pp} pp previstos en la semana
            </div>
          </div>

          {/* Card 2: Valor Contractual de la Meta */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Producción Contractual Meta</span>
              <Calendar className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 text-xl font-bold text-[var(--foreground)]">
              Gs. {calculation.total_plan_contractual_value.toLocaleString("es-PY")}
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              {calculation.items.length} frentes planificados
            </div>
          </div>

          {/* Card 3: Materiales para Cumplir el Plan */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Materiales para Cumplir el Plan</span>
              <Boxes className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="mt-2 text-xl font-bold text-[var(--foreground)]">
              Gs. {calculation.total_material_consumption_value.toLocaleString("es-PY")}
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)] space-y-0.5">
              <div>En stock: Gs. {calculation.total_covered_by_stock_value.toLocaleString("es-PY")}</div>
              <div>En tránsito (OC): Gs. {calculation.total_covered_by_inbound_value.toLocaleString("es-PY")}</div>
            </div>
          </div>

          {/* Card 4: Salida de Caja Requerida */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-300 font-medium">
              <span>Caja Adicional Requerida</span>
              <DollarSign className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-2 text-xl font-bold text-amber-800 dark:text-amber-200">
              Gs. {calculation.total_additional_cash_required.toLocaleString("es-PY")}
            </div>
            <div className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/80">
              Déficit neto a comprar para cumplir la meta
            </div>
          </div>
        </div>
      )}

      {/* Warning banner for unconfigured BOM */}
      {calculation && calculation.unconfigured_materials_count > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>Atención:</strong> {calculation.unconfigured_materials_count} partidas planificadas no tienen receta de materiales configurada o requieren definición explícita.
          </span>
        </div>
      )}

      {/* Multi-front Items Table */}
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--panel-2)] px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--foreground)] uppercase tracking-wider">
            Partidas y Frentes del Plan ({frontTargets.length})
          </h4>
          <span className="text-[11px] text-[var(--muted)]">
            Podés asignar múltiples frentes (Sector A, Sector B) a la misma partida presupuestaria
          </span>
        </div>

        <div className="divide-y divide-[var(--border)] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[var(--panel-2)]/50 text-[var(--muted)] font-medium">
                <th className="py-2.5 px-3">Código</th>
                <th className="py-2.5 px-3">Partida</th>
                <th className="py-2.5 px-3">Frente / Sector</th>
                <th className="py-2.5 px-3 text-right">Presupuestado</th>
                <th className="py-2.5 px-3 text-right">Remanente</th>
                <th className="py-2.5 px-3 text-center">Modo</th>
                <th className="py-2.5 px-3 text-right">Meta Semanal</th>
                <th className="py-2.5 px-3 text-right">Cantidad Final</th>
                {weatherOverlay && (
                  <th className="py-2.5 px-3 text-right text-blue-600">Capacidad Clima</th>
                )}
                <th className="py-2.5 px-3 text-right">Valor Meta</th>
                <th className="py-2.5 px-2 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {budgetItems.map((bItem) => {
                const itemFronts = frontTargets.filter(
                  (t) => t.budget_item_id === bItem.id
                );
                const hasFronts = itemFronts.length > 0;

                return (
                  <BudgetItemGroup
                    key={bItem.id}
                    budgetItem={bItem}
                    fronts={itemFronts}
                    calcItems={calculation?.items.filter((ci) => ci.budget_item_id === bItem.id) || []}
                    weatherOverlay={weatherOverlay}
                    expandedRowKey={expandedRowKey}
                    onToggleExpand={(key) =>
                      setExpandedRowKey(expandedRowKey === key ? null : key)
                    }
                    onAddFront={() => handleAddFront(bItem.id)}
                    onRemoveFront={handleRemoveFront}
                    onUpdateFront={handleUpdateFront}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface BudgetItemGroupProps {
  budgetItem: BudgetItem;
  fronts: EditableFrontTarget[];
  calcItems: WeeklyPlanItemCalculation[];
  weatherOverlay: boolean;
  expandedRowKey: string | null;
  onToggleExpand: (key: string) => void;
  onAddFront: () => void;
  onRemoveFront: (id: string) => void;
  onUpdateFront: (id: string, field: any, val: any) => void;
}

function BudgetItemGroup({
  budgetItem,
  fronts,
  calcItems,
  weatherOverlay,
  expandedRowKey,
  onToggleExpand,
  onAddFront,
  onRemoveFront,
  onUpdateFront,
}: BudgetItemGroupProps) {
  const contractualQty = budgetItem.quantity ?? 0;

  return (
    <>
      {fronts.length === 0 ? (
        <tr className="hover:bg-[var(--panel-2)]/30 text-[var(--muted)]">
          <td className="py-2 px-3 font-mono">{budgetItem.code}</td>
          <td className="py-2 px-3 font-medium text-[var(--foreground)]">{budgetItem.description}</td>
          <td className="py-2 px-3 italic">Sin frentes asignados</td>
          <td className="py-2 px-3 text-right">
            {contractualQty.toLocaleString("es-PY")} {budgetItem.unit}
          </td>
          <td className="py-2 px-3 text-right">—</td>
          <td className="py-2 px-3 text-center">—</td>
          <td className="py-2 px-3 text-right">—</td>
          <td className="py-2 px-3 text-right">—</td>
          {weatherOverlay && <td className="py-2 px-3 text-right">—</td>}
          <td className="py-2 px-3 text-right">—</td>
          <td className="py-2 px-2 text-center">
            <Button
              type="button"
              variant="ghost"
              onClick={onAddFront}
              className="h-7 text-xs gap-1 text-emerald-600 hover:text-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Asignar Meta
            </Button>
          </td>
        </tr>
      ) : (
        fronts.map((front, idx) => {
          const calcItem = calcItems.find(
            (ci) => (ci.front_label || "") === (front.front_label || "")
          );
          const rowKey = `${budgetItem.id}-${front.front_label || "default"}-${idx}`;
          const isExpanded = expandedRowKey === rowKey;

          return (
            <tr key={front.id} className="hover:bg-[var(--panel-2)]/40 transition-colors">
              <td className="py-2 px-3 font-mono font-medium text-[var(--foreground)]">
                {idx === 0 ? budgetItem.code : ""}
              </td>
              <td className="py-2 px-3">
                {idx === 0 && (
                  <div className="font-medium text-[var(--foreground)]">
                    {budgetItem.description}
                  </div>
                )}
                {calcItem?.materials_warning && (
                  <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
                    {calcItem.materials_warning}
                  </span>
                )}
              </td>
              <td className="py-2 px-3">
                <Input
                  type="text"
                  value={front.front_label}
                  onChange={(e) => onUpdateFront(front.id, "front_label", e.target.value)}
                  placeholder="Frente (ej. Sector A)"
                  className="h-7 w-32 text-xs"
                />
              </td>
              <td className="py-2 px-3 text-right">
                {contractualQty.toLocaleString("es-PY")} {budgetItem.unit}
              </td>
              <td className="py-2 px-3 text-right font-medium">
                {calcItem ? `${calcItem.remaining_quantity.toLocaleString("es-PY")} ${budgetItem.unit}` : "—"}
              </td>
              <td className="py-2 px-3 text-center">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateFront(
                      front.id,
                      "input_mode",
                      front.input_mode === "QUANTITY" ? "CONTRACT_PERCENTAGE_POINTS" : "QUANTITY"
                    )
                  }
                  className="px-2 py-0.5 rounded text-[10px] font-semibold border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-2)] text-[var(--foreground)]"
                >
                  {front.input_mode === "QUANTITY" ? "Cant." : "+pp"}
                </button>
              </td>
              <td className="py-2 px-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={front.input_value || ""}
                    onChange={(e) => onUpdateFront(front.id, "input_value", e.target.value)}
                    placeholder="0"
                    className="h-7 w-20 text-xs text-right font-medium"
                  />
                  <span className="text-[10px] text-[var(--muted)] w-6 text-left">
                    {front.input_mode === "QUANTITY" ? budgetItem.unit : "%"}
                  </span>
                </div>
              </td>
              <td className="py-2 px-3 text-right font-medium text-emerald-600 dark:text-emerald-400">
                {calcItem?.target_quantity
                  ? `${calcItem.target_quantity.toLocaleString("es-PY")} ${budgetItem.unit}`
                  : "—"}
                {calcItem?.was_capped && (
                  <span className="block text-[9px] text-amber-600" title="Ajustado al remanente disponible">
                    (limitado)
                  </span>
                )}
              </td>
              {weatherOverlay && (
                <td className="py-2 px-3 text-right text-blue-700 dark:text-blue-300 font-semibold">
                  {typeof calcItem?.weather_adjusted_capacity === "number" ? (
                    <div>
                      <span>{calcItem.weather_adjusted_capacity.toLocaleString("es-PY")} {budgetItem.unit}</span>
                      {typeof calcItem.weather_gap_quantity === "number" && calcItem.weather_gap_quantity < 0 && (
                        <span className="block text-[9px] text-amber-600">
                          {calcItem.weather_gap_quantity.toLocaleString("es-PY")} {budgetItem.unit}
                        </span>
                      )}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
              )}
              <td className="py-2 px-3 text-right font-semibold">
                {calcItem?.contractual_value_target
                  ? `Gs. ${calcItem.contractual_value_target.toLocaleString("es-PY")}`
                  : "—"}
              </td>
              <td className="py-2 px-2 text-center flex items-center justify-center gap-1">
                {idx === 0 && (
                  <button
                    type="button"
                    onClick={onAddFront}
                    className="p-1 rounded hover:bg-[var(--panel-2)] text-emerald-600"
                    title="Agregar otro frente para esta misma partida"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveFront(front.id)}
                  className="p-1 rounded hover:bg-[var(--panel-2)] text-red-500"
                  title="Eliminar este frente"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                {calcItem && calcItem.materials.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleExpand(rowKey)}
                    className="p-1 rounded hover:bg-[var(--panel-2)] text-[var(--muted)]"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </td>
            </tr>
          );
        })
      )}
    </>
  );
}

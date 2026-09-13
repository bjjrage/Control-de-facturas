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

export function WeeklyPlanSection({ project }: Props) {
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();

  const [planId, setPlanId] = useState<string | undefined>(undefined);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [status, setStatus] = useState<WeeklyPlanStatus>("DRAFT");
  const [notes, setNotes] = useState<string>("");

  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [calculation, setCalculation] =
    useState<WeeklyPlanCalculationSummary | null>(null);

  const [itemTargets, setItemTargets] = useState<
    Record<string, { input_mode: WeeklyPlanInputMode; input_value: number }>
  >({});

  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const loadPlan = async () => {
    setLoading(true);
    setErrorMsg(null);
    const res = await getWeeklyPlanDetailsAction({ projectId: project.id });
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

      const targetsMap: Record<
        string,
        { input_mode: WeeklyPlanInputMode; input_value: number }
      > = {};
      for (const it of calc.items) {
        targetsMap[it.budget_item_id] = {
          input_mode: it.input_mode,
          input_value: it.input_value,
        };
      }
      setItemTargets(targetsMap);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPlan();
  }, [project.id]);

  const handleItemValueChange = (itemId: string, valStr: string) => {
    const numVal = Math.max(0, parseFloat(valStr) || 0);
    const currentMode = itemTargets[itemId]?.input_mode || "QUANTITY";
    setItemTargets({
      ...itemTargets,
      [itemId]: {
        input_mode: currentMode,
        input_value: numVal,
      },
    });
  };

  const handleToggleMode = (itemId: string) => {
    const current = itemTargets[itemId] || {
      input_mode: "QUANTITY",
      input_value: 0,
    };
    const nextMode: WeeklyPlanInputMode =
      current.input_mode === "QUANTITY"
        ? "CONTRACT_PERCENTAGE_POINTS"
        : "QUANTITY";
    setItemTargets({
      ...itemTargets,
      [itemId]: {
        ...current,
        input_mode: nextMode,
      },
    });
  };

  const handleSavePlan = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    startSaveTransition(async () => {
      const itemsToSave = Object.entries(itemTargets)
        .filter(([_, t]) => t.input_value > 0)
        .map(([bId, t]) => {
          const bItem = budgetItems.find((b) => b.id === bId);
          return {
            budgetItemId: bId,
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
        items: itemsToSave,
      });

      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setSuccessMsg("Plan semanal guardado con éxito.");
        await loadPlan();
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

      {calculation && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Producción Contractual Meta</span>
              <Calendar className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 text-xl font-bold text-[var(--foreground)]">
              Gs. {calculation.total_plan_contractual_value.toLocaleString("es-PY")}
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              {calculation.items.length} partidas planificadas
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4">
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Consumo Teórico Materiales</span>
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

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-300 font-medium">
              <span>Caja Adicional Requerida</span>
              <DollarSign className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-2 text-xl font-bold text-amber-800 dark:text-amber-200">
              Gs. {calculation.total_additional_cash_required.toLocaleString("es-PY")}
            </div>
            <div className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/80">
              Déficit neto a comprar para abastecer la meta
            </div>
          </div>
        </div>
      )}

      {calculation && calculation.unconfigured_materials_count > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>Atención:</strong> {calculation.unconfigured_materials_count} partidas planificadas no tienen receta de materiales (BOM) asignada. Su consumo de materiales figura en Gs. 0.
          </span>
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        <div className="bg-[var(--panel-2)] px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
          <h4 className="text-xs font-semibold text-[var(--foreground)] uppercase tracking-wider">
            Partidas y Metas Semanales ({budgetItems.length})
          </h4>
          <span className="text-[11px] text-[var(--muted)]">
            Ingresá cantidad o puntos porcentuales (+pp) para cada partida
          </span>
        </div>

        <div className="divide-y divide-[var(--border)] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-[var(--panel-2)]/50 text-[var(--muted)] font-medium">
                <th className="py-2.5 px-3">Código</th>
                <th className="py-2.5 px-3">Partida</th>
                <th className="py-2.5 px-3 text-right">Presupuestado</th>
                <th className="py-2.5 px-3 text-right">Ejecutado</th>
                <th className="py-2.5 px-3 text-right">Remanente</th>
                <th className="py-2.5 px-3 text-center">Modo</th>
                <th className="py-2.5 px-3 text-right">Meta Semanal</th>
                <th className="py-2.5 px-3 text-right">Cantidad Final</th>
                <th className="py-2.5 px-3 text-right">Avance %</th>
                <th className="py-2.5 px-3 text-right">Valor Meta</th>
                <th className="py-2.5 px-2 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {budgetItems.map((item) => {
                const target = itemTargets[item.id] || {
                  input_mode: "QUANTITY",
                  input_value: 0,
                };
                const calcItem = calculation?.items.find(
                  (ci) => ci.budget_item_id === item.id
                );
                const isExpanded = expandedItemId === item.id;
                const contractualQty = item.quantity ?? 0;
                const prevExecQty = calcItem?.previously_executed_quantity ?? 0;
                const remainingQty = Math.max(0, contractualQty - prevExecQty);

                return (
                  <PlanItemRow
                    key={item.id}
                    item={item}
                    contractualQty={contractualQty}
                    prevExecQty={prevExecQty}
                    remainingQty={remainingQty}
                    target={target}
                    calcItem={calcItem}
                    isExpanded={isExpanded}
                    onToggleExpand={() =>
                      setExpandedItemId(isExpanded ? null : item.id)
                    }
                    onValueChange={(val) =>
                      handleItemValueChange(item.id, val)
                    }
                    onToggleMode={() => handleToggleMode(item.id)}
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

interface PlanItemRowProps {
  item: BudgetItem;
  contractualQty: number;
  prevExecQty: number;
  remainingQty: number;
  target: { input_mode: WeeklyPlanInputMode; input_value: number };
  calcItem?: WeeklyPlanItemCalculation;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onValueChange: (val: string) => void;
  onToggleMode: () => void;
}

function PlanItemRow({
  item,
  contractualQty,
  prevExecQty,
  remainingQty,
  target,
  calcItem,
  isExpanded,
  onToggleExpand,
  onValueChange,
  onToggleMode,
}: PlanItemRowProps) {
  const isFinished = remainingQty <= 0;

  return (
    <>
      <tr className="hover:bg-[var(--panel-2)]/40 transition-colors">
        <td className="py-2 px-3 font-mono font-medium text-[var(--foreground)]">
          {item.code}
        </td>
        <td className="py-2 px-3">
          <div className="font-medium text-[var(--foreground)] line-clamp-1">
            {item.description}
          </div>
          {calcItem?.materials_warning && (
            <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
              {calcItem.materials_warning}
            </span>
          )}
          {calcItem?.advisory_capacity_warning && (
            <span className="inline-block mt-0.5 ml-1 px-1.5 py-0.2 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px]">
              {calcItem.advisory_capacity_warning}
            </span>
          )}
        </td>
        <td className="py-2 px-3 text-right">
          {contractualQty.toLocaleString("es-PY")} {item.unit}
        </td>
        <td className="py-2 px-3 text-right text-[var(--muted)]">
          {prevExecQty.toLocaleString("es-PY")} {item.unit}
        </td>
        <td className="py-2 px-3 text-right font-medium">
          {remainingQty.toLocaleString("es-PY")} {item.unit}
        </td>
        <td className="py-2 px-3 text-center">
          <button
            type="button"
            onClick={onToggleMode}
            disabled={isFinished}
            className="px-2 py-0.5 rounded text-[10px] font-semibold border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-2)] text-[var(--foreground)] transition-colors"
            title="Cambiar entre Cantidad Física y Puntos Porcentuales (+pp)"
          >
            {target.input_mode === "QUANTITY" ? "Cant." : "+pp"}
          </button>
        </td>
        <td className="py-2 px-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <Input
              type="number"
              step="any"
              min="0"
              disabled={isFinished}
              value={target.input_value || ""}
              onChange={(e) => onValueChange(e.target.value)}
              placeholder="0"
              className="h-7 w-20 text-xs text-right font-medium"
            />
            <span className="text-[10px] text-[var(--muted)] w-6 text-left">
              {target.input_mode === "QUANTITY" ? item.unit : "%"}
            </span>
          </div>
        </td>
        <td className="py-2 px-3 text-right font-medium text-emerald-600 dark:text-emerald-400">
          {calcItem?.target_quantity
            ? `${calcItem.target_quantity.toLocaleString("es-PY")} ${item.unit}`
            : "—"}
          {calcItem?.was_capped && (
            <span
              className="block text-[9px] text-amber-600"
              title="Ajustado al remanente contractual"
            >
              (limitado al 100%)
            </span>
          )}
        </td>
        <td className="py-2 px-3 text-right">
          {calcItem ? (
            <div>
              <span>{calcItem.item_target_progress_pct}%</span>
              {calcItem.item_increment_pp > 0 && (
                <span className="block text-[10px] text-emerald-600">
                  +{calcItem.item_increment_pp} pp
                </span>
              )}
            </div>
          ) : (
            "—"
          )}
        </td>
        <td className="py-2 px-3 text-right font-semibold">
          {calcItem?.contractual_value_target
            ? `Gs. ${calcItem.contractual_value_target.toLocaleString("es-PY")}`
            : "—"}
        </td>
        <td className="py-2 px-2 text-center">
          {calcItem && calcItem.materials.length > 0 && (
            <button
              type="button"
              onClick={onToggleExpand}
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

      {isExpanded && calcItem && calcItem.materials.length > 0 && (
        <tr>
          <td colSpan={11} className="bg-[var(--panel-2)]/70 p-3 border-b border-[var(--border)]">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--foreground)]">
                <span>Materiales Requeridos para esta Meta ({calcItem.materials.length})</span>
                <span className="text-[var(--muted)] font-normal">
                  Deducción secuencial de stock y compras en tránsito
                </span>
              </div>
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="text-[var(--muted)] border-b border-[var(--border)]">
                    <th className="py-1 px-2">Material</th>
                    <th className="py-1 px-2 text-right">Demanda Bruta</th>
                    <th className="py-1 px-2 text-right">Stock Disponible</th>
                    <th className="py-1 px-2 text-right">En Tránsito (OC)</th>
                    <th className="py-1 px-2 text-right">Déficit a Comprar</th>
                    <th className="py-1 px-2 text-right">Caja Requerida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/50">
                  {calcItem.materials.map((m) => (
                    <tr key={m.producto_id}>
                      <td className="py-1 px-2 font-medium">{m.producto_nombre}</td>
                      <td className="py-1 px-2 text-right">
                        {m.demanda_bruta.toLocaleString("es-PY")} {m.unidad_medida}
                      </td>
                      <td className="py-1 px-2 text-right text-emerald-600 dark:text-emerald-400">
                        {m.cubierto_por_stock.toLocaleString("es-PY")} {m.unidad_medida}
                      </td>
                      <td className="py-1 px-2 text-right text-blue-600 dark:text-blue-400">
                        {m.cubierto_por_inbound.toLocaleString("es-PY")} {m.unidad_medida}
                      </td>
                      <td className="py-1 px-2 text-right font-semibold text-amber-600 dark:text-amber-400">
                        {m.deficit_compra_neta.toLocaleString("es-PY")} {m.unidad_medida}
                      </td>
                      <td className="py-1 px-2 text-right font-bold text-[var(--foreground)]">
                        Gs. {m.caja_adicional_requerida.toLocaleString("es-PY")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
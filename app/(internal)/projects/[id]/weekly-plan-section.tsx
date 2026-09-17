"use client";

import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import {
  Calendar,
  Layers,
  TrendingUp,
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
  Calculator,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  Project,
  BudgetItem,
  WeeklyPlanCalculationSummary,
  WeeklyPlanInputMode,
  WeeklyPlanStatus,
} from "@/lib/types";
import {
  getWeeklyPlanDetailsAction,
  previewWeeklyPlanAction,
  saveWeeklyPlanAction,
} from "../weekly-plan-actions";
import {
  translateTargetToQuantity,
  sumRequestedByItem,
  remainingForItem,
  isGroupingItem,
} from "@/lib/procurement/weekly-plan-shared";

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

function newFrontId(budgetItemId: string): string {
  return `${budgetItemId}-front-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Carrera con timeout para server actions: si la respuesta se pierde en la
 * red, libera al llamador con un error claro en vez de colgar el spinner.
 */
async function withActionTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} tardó demasiado (>${Math.round(ms / 1000)}s). Revisá tu conexión y reintentá.`)),
        ms
      );
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function WeeklyPlanSection({ project }: Props) {
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Estados manuales (sin hook de transiciones): si la respuesta de red se
  // pierde, el timeout los libera y muestra error en vez de colgar el botón
  // para siempre (visto en E2E: action ejecutada en servidor pero respuesta
  // no recibida).
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Período + clima (paso 1). El estado DRAFT/COMMITTED/CLOSED NO es protagonista:
  // solo aparece como insignia secundaria y como selector de compatibilidad
  // después del cálculo.
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [weatherOverlay, setWeatherOverlay] = useState<boolean>(false);

  // Plan persistido (si existe) — solo referencia secundaria.
  const [planId, setPlanId] = useState<string | undefined>(undefined);
  const [savedStatus, setSavedStatus] = useState<WeeklyPlanStatus | null>(null);
  const [compatStatus, setCompatStatus] = useState<WeeklyPlanStatus>("DRAFT");
  const [notes, setNotes] = useState<string>("");

  // Datos base reales para pintar Contrato/Ejecutado/Pendiente sin tabla ancha.
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [executedQuantities, setExecutedQuantities] = useState<Record<string, number>>({});

  // Metas LOCALES (aún no guardadas) — "¿qué quiero hacer?".
  const [frontTargets, setFrontTargets] = useState<EditableFrontTarget[]>([]);

  // Qué editor inline está expandido (una partida por vez).
  const [editorItemId, setEditorItemId] = useState<string | null>(null);

  // Resultado del preview SIN guardar — "¿qué necesito? / ¿es factible?".
  const [preview, setPreview] = useState<WeeklyPlanCalculationSummary | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  // Detalle expandido por meta calculada.
  const [expandedResultKey, setExpandedResultKey] = useState<string | null>(null);

  // Guarda anti-race: si dos cargas base se solapan (remount en dev,
  // respuesta lenta), la respuesta vieja NUNCA pisa las metas locales
  // que el usuario ya editó. Detectado por E2E real.
  const loadSeq = useRef(0);
  // Misma protección para cálculos solapados: gana el último CALCULAR.
  const calcSeq = useRef(0);

  // Carga inicial: datos base + último plan guardado (para hidratar metas).
  // Clima OFF a propósito: no se consulta el proveedor hasta que el usuario
  // presiona CALCULAR PLAN con Clima ON (cero llamadas en OFF).
  const loadBase = async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setErrorMsg(null);
    let res: Awaited<ReturnType<typeof getWeeklyPlanDetailsAction>>;
    try {
      res = await withActionTimeout(
        getWeeklyPlanDetailsAction({ projectId: project.id, weatherOverlay: false }),
        60000,
        "La carga del plan"
      );
    } catch (e: unknown) {
      if (loadSeq.current !== seq) return;
      setErrorMsg(e instanceof Error ? e.message : "Error al cargar el plan semanal.");
      setLoading(false);
      return;
    }
    // Respuesta stale (una carga más nueva ya empezó): ignorar por completo
    // para no borrar metas locales ni período editado por el usuario.
    if (loadSeq.current !== seq) return;
    if (res.error) {
      setErrorMsg(res.error);
    } else if (res.data) {
      const { plan, calculation: calc, budgetItems: bItems, executedQuantities: exec } = res.data;
      setBudgetItems(bItems);
      setExecutedQuantities(exec ?? {});
      if (plan) {
        setPlanId(plan.id);
        setStartDate(plan.start_date);
        setEndDate(plan.end_date);
        setSavedStatus(plan.status);
        setCompatStatus(plan.status);
        setNotes(plan.notes || "");
      } else {
        setStartDate(calc.start_date);
        setEndDate(calc.end_date);
      }
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
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const executedOf = (budgetItemId: string): number =>
    Number(executedQuantities[budgetItemId]) || 0;

  const frontsOf = (budgetItemId: string): EditableFrontTarget[] =>
    frontTargets.filter((t) => t.budget_item_id === budgetItemId);

  const metasCount = useMemo(
    () => frontTargets.filter((t) => Number(t.input_value) > 0).length,
    [frontTargets]
  );

  // Clave del estado actual para detectar preview desactualizado sin perder estado.
  const currentKey = useMemo(() => {
    const norm = frontTargets
      .filter((t) => Number(t.input_value) > 0)
      .map((t) => [t.budget_item_id, (t.front_label || "").trim(), t.input_mode, Number(t.input_value)].join("|"))
      .sort()
      .join(";");
    return `${startDate}|${endDate}|${weatherOverlay ? "on" : "off"}|${norm}`;
  }, [frontTargets, startDate, endDate, weatherOverlay]);

  const previewStale = preview !== null && previewKey !== null && previewKey !== currentKey;

  // ---- edición local (sin persistir) ----

  const handleDefinirMeta = (budgetItemId: string) => {
    const existing = frontsOf(budgetItemId);
    if (existing.length === 0) {
      const nf: EditableFrontTarget = {
        id: newFrontId(budgetItemId),
        budget_item_id: budgetItemId,
        front_label: "Sector A",
        input_mode: "QUANTITY",
        input_value: 0,
      };
      setFrontTargets([...frontTargets, nf]);
    }
    setEditorItemId((cur) => (cur === budgetItemId ? null : budgetItemId));
  };

  const handleAddFront = (budgetItemId: string) => {
    const nf: EditableFrontTarget = {
      id: newFrontId(budgetItemId),
      budget_item_id: budgetItemId,
      front_label: "",
      input_mode: "QUANTITY",
      input_value: 0,
    };
    setFrontTargets([...frontTargets, nf]);
    setEditorItemId(budgetItemId);
  };

  const handleRemoveFront = (targetId: string) => {
    setFrontTargets(frontTargets.filter((t) => t.id !== targetId));
  };

  const handleUpdateFront = (
    targetId: string,
    field: "input_value" | "front_label" | "input_mode",
    val: string
  ) => {
    setFrontTargets(
      frontTargets.map((t) => {
        if (t.id !== targetId) return t;
        if (field === "input_value") {
          return { ...t, [field]: Math.max(0, parseFloat(val) || 0) };
        }
        return { ...t, [field]: val } as EditableFrontTarget;
      })
    );
  };

  // ---- preview sin guardar (MISMO engine, vía server action) ----

  const handleCalcular = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!startDate || !endDate) {
      setErrorMsg("Elegí el período (inicio y fin) antes de calcular.");
      return;
    }
    if (endDate < startDate) {
      setErrorMsg(`Rango inválido: fin (${endDate}) anterior a inicio (${startDate}).`);
      return;
    }
    if (metasCount === 0) {
      setErrorMsg("Definí al menos una meta (cantidad mayor a 0) antes de calcular.");
      return;
    }
    const seq = ++calcSeq.current;
    setIsCalculating(true);
    (async () => {
      try {
        const res = await withActionTimeout(
          previewWeeklyPlanAction({
            projectId: project.id,
            startDate,
            endDate,
            weatherOverlay,
            items: frontTargets
              .filter((t) => Number(t.input_value) > 0)
              .map((t) => ({
                budgetItemId: t.budget_item_id,
                frontLabel: t.front_label ? t.front_label.trim() : null,
                inputMode: t.input_mode,
                inputValue: Number(t.input_value),
              })),
          }),
          90000,
          "El cálculo del plan"
        );
        // Cálculo stale (el usuario ya pidió otro): ignorar para no mostrar
        // resultados de metas viejas ni perder el estado local.
        if (calcSeq.current !== seq) return;
        if (res.error) {
          setErrorMsg(res.error);
        } else if (res.data) {
          // El preview NO toca frontTargets: el estado local se preserva.
          if (res.data.executedQuantities) {
            setExecutedQuantities(res.data.executedQuantities);
          }
          setPreview(res.data.calculation);
          setPreviewKey(currentKey);
          setExpandedResultKey(null);
          // N1: el mensaje deriva del resultado real, no del toggle (si el
          // provider falló, el badge "overlay no disponible" lo informa).
          setSuccessMsg(
            res.data.calculation.weather_overlay_enabled && !res.data.calculation.weather_failed_closed
              ? "Plan calculado (preview sin guardar) con factibilidad climática."
              : res.data.calculation.weather_overlay_enabled
                ? "Plan calculado (preview sin guardar). El pronóstico climático no estuvo disponible."
                : "Plan calculado (preview sin guardar)."
          );
        }
      } catch (e: unknown) {
        if (calcSeq.current !== seq) return;
        setErrorMsg(e instanceof Error ? e.message : "Error al calcular el plan.");
      } finally {
        if (calcSeq.current === seq) setIsCalculating(false);
      }
    })();
  };

  // ---- guardado atómico post-preview (mismo mecanismo existente) ----

  const handleSaveWithStatus = (statusToSave: WeeklyPlanStatus) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!startDate || !endDate) {
      setErrorMsg("Elegí el período antes de guardar.");
      return;
    }
    // P1-2: misma validación de rango que el preview (el server también valida).
    if (endDate < startDate) {
      setErrorMsg(`Rango inválido: fin (${endDate}) anterior a inicio (${startDate}).`);
      return;
    }
    if (metasCount === 0) {
      setErrorMsg("No hay metas para guardar.");
      return;
    }
    // P1-1: si el preview quedó stale (cambió período/metas/clima después de
    // calcular), NO enlazar su snapshot climático: es de otro período/metas.
    // Se guarda con snapshot null (trazabilidad preservada) en vez de corrupta.
    const snapshotToLink = previewStale ? null : preview?.weather_snapshot_id || null;
    setIsSaving(true);
    (async () => {
      try {
        const itemsToSave = frontTargets
          .filter((t) => Number(t.input_value) > 0)
          .map((t) => {
            const bItem = budgetItems.find((b) => b.id === t.budget_item_id);
            return {
              budgetItemId: t.budget_item_id,
              frontLabel: t.front_label ? t.front_label.trim() : null,
              inputMode: t.input_mode,
              inputValue: Number(t.input_value),
              unit: bItem?.unit || "unid",
            };
          });

        const res = await withActionTimeout(
          saveWeeklyPlanAction({
            planId,
            projectId: project.id,
            startDate,
            endDate,
            status: statusToSave,
            notes,
            weatherSnapshotBatchId: snapshotToLink,
            items: itemsToSave,
          }),
          60000,
          "El guardado del plan"
        );

        if (res.error) {
          setErrorMsg(res.error);
        } else if (res.data) {
          setPlanId(res.data.id);
          setSavedStatus(res.data.status);
          setCompatStatus(res.data.status);
          setSuccessMsg(
            statusToSave === "COMMITTED"
              ? "Plan comprometido de forma atómica."
              : statusToSave === "CLOSED"
                ? "Plan cerrado."
                : "Borrador guardado de forma atómica."
          );
        }
      } catch (e: unknown) {
        setErrorMsg(e instanceof Error ? e.message : "Error al guardar el plan.");
      } finally {
        setIsSaving(false);
      }
    })();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[var(--muted)]">
        <RefreshCw className="h-5 w-5 animate-spin mr-2 text-emerald-600" />
        Cargando plan semanal y cálculo de abastecimiento...
      </div>
    );
  }

  const cappedCount = preview?.items.filter((i) => i.was_capped).length ?? 0;
  const advisoryList =
    preview?.items.filter((i) => i.advisory_capacity_warning).slice(0, 5) ?? [];

  return (
    <div className="w-full max-w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xs space-y-6">
      {/* ============ 1. PERÍODO ============ */}
      <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              Plan Semanal de Obra
            </h3>
            <p className="text-xs text-[var(--muted)]">
              Vos definís qué querés ejecutar; el sistema calcula qué necesitás y si es factible.
              Pasos: 1) qué quiero hacer · 2) calcular plan · 3) qué necesito · 4) es factible · 5) guardar.
            </p>
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
              aria-label="Fecha inicio del plan"
            />
            <span className="text-[var(--muted)]">→</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent border-0 text-xs text-[var(--foreground)] focus:outline-hidden"
              aria-label="Fecha fin del plan"
            />
          </div>

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

          {savedStatus ? (
            <span className="text-[11px] text-[var(--muted)] rounded-full border border-[var(--border)] px-2 py-0.5">
              Plan guardado: {savedStatus}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--muted)]">
              Sin plan guardado todavía — primero definí metas y calculá (sin guardar).
            </span>
          )}
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

      {/* ============ 2. LISTA DE PARTIDAS (cards compactas, sin scroll horizontal) ============ */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          1. ¿Qué quiero hacer? — partidas ({budgetItems.length})
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Definí la meta de esta semana por partida y frente. El botón Definir meta está siempre
          visible en cada tarjeta, sin scroll horizontal.
        </p>

        {/* Sin overflow-x-auto a propósito: Definir meta nunca depende del scroll horizontal. */}
        <div data-testid="partidas-list" className="mt-3 space-y-3">
          {budgetItems.map((bItem) => {
            const grouping = isGroupingItem(bItem);
            const contractual = Number(bItem.quantity) || 0;
            const executed = executedOf(bItem.id);
            const remaining = remainingForItem(contractual, executed);
            const fronts = frontsOf(bItem.id);
            const editorOpen = editorItemId === bItem.id;
            // P2-2: mismo helper compartido que los tests (sin duplicar la suma).
            const requestedSum =
              grouping
                ? 0
                : (sumRequestedByItem(
                    fronts.map((f) => ({
                      budgetItemId: f.budget_item_id,
                      frontLabel: f.front_label,
                      inputMode: f.input_mode,
                      inputValue: Number(f.input_value),
                    })),
                    { [bItem.id]: contractual }
                  )[bItem.id] || 0);
            const exceeds = !grouping && requestedSum > remaining + 1e-9;

            return (
              <div
                key={bItem.id}
                data-testid={`partida-${bItem.code}`}
                className="w-full max-w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/40 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-[var(--muted)]">{bItem.code}</span>
                      <span className="min-w-0 break-words text-xs font-semibold text-[var(--foreground)]">
                        {bItem.description}
                      </span>
                      {grouping && (
                        <span className="rounded-full bg-[var(--panel-2)] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
                          Rubro agrupador · sin cantidad contractual
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--muted)]">
                      <span>
                        Contrato:{" "}
                        <strong className="text-[var(--foreground)]">
                          {contractual.toLocaleString("es-PY")} {bItem.unit}
                        </strong>
                      </span>
                      <span>
                        Ejecutado:{" "}
                        <strong className="text-[var(--foreground)]">
                          {executed.toLocaleString("es-PY")} {bItem.unit}
                        </strong>
                      </span>
                      <span>
                        Pendiente:{" "}
                        <strong className="text-[var(--foreground)]">
                          {remaining.toLocaleString("es-PY")} {bItem.unit}
                        </strong>
                      </span>
                      {fronts.filter((f) => Number(f.input_value) > 0).length > 0 && (
                        <span className="text-emerald-700 dark:text-emerald-300 font-medium">
                          Meta local:{" "}
                          {fronts
                            .filter((f) => Number(f.input_value) > 0)
                            .map((f) =>
                              f.input_mode === "QUANTITY"
                                ? `${Number(f.input_value).toLocaleString("es-PY")} ${bItem.unit}`
                                : `+${Number(f.input_value).toLocaleString("es-PY")} pp`
                            )
                            .join(" + ")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {grouping ? (
                      <span
                        className="inline-block text-[11px] italic text-[var(--muted)]"
                        title="Los rubros agrupadores no son ejecutables: definí metas en sus partidas hijas."
                      >
                        No ejecutable
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant={fronts.length > 0 ? "secondary" : "primary"}
                        onClick={() => handleDefinirMeta(bItem.id)}
                        data-testid={`definir-meta-${bItem.code}`}
                        className={`h-8 text-xs gap-1.5 whitespace-nowrap ${
                          fronts.length === 0
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : ""
                        }`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {fronts.length === 0
                          ? "+ Definir meta"
                          : editorOpen
                            ? "Cerrar editor"
                            : `Editar meta (${fronts.length})`}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Editor inline de meta (debajo de ESA partida) */}
                {editorOpen && !grouping && (
                  <div
                    data-testid={`editor-${bItem.code}`}
                    className="mt-3 rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 space-y-3"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                      META DE ESTA SEMANA
                    </div>

                    {fronts.length === 0 && (
                      <p className="text-[11px] text-[var(--muted)]">Sin frentes todavía.</p>
                    )}

                    {fronts.map((front) => {
                      const translated =
                        front.input_mode === "CONTRACT_PERCENTAGE_POINTS"
                          ? translateTargetToQuantity(contractual, front.input_mode, Number(front.input_value) || 0)
                          : null;
                      return (
                        <div
                          key={front.id}
                          className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded border border-dashed border-[var(--border)] p-2"
                        >
                          <div className="min-w-0">
                            <label className="block text-[11px] text-[var(--muted)]">
                              Frente / sector
                            </label>
                            <Input
                              type="text"
                              value={front.front_label}
                              onChange={(e) => handleUpdateFront(front.id, "front_label", e.target.value)}
                              placeholder="Sector A"
                              className="h-8 w-36 max-w-full text-xs"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] text-[var(--muted)]">
                              Quiero ejecutar
                            </label>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="any"
                                min="0"
                                value={front.input_value || ""}
                                onChange={(e) => handleUpdateFront(front.id, "input_value", e.target.value)}
                                placeholder="0"
                                className="h-8 w-24 text-xs text-right font-medium"
                              />
                              <span className="text-[11px] text-[var(--muted)]">
                                {front.input_mode === "QUANTITY" ? bItem.unit : "pp contrato"}
                              </span>
                            </div>
                          </div>

                          <div>
                            <span className="block text-[11px] text-[var(--muted)]">Modo</span>
                            <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-[11px]">
                              <button
                                type="button"
                                onClick={() => handleUpdateFront(front.id, "input_mode", "QUANTITY")}
                                className={`px-2 py-1 rounded-md ${
                                  front.input_mode === "QUANTITY"
                                    ? "bg-emerald-600 text-white font-semibold"
                                    : "text-[var(--muted)]"
                                }`}
                              >
                                Cantidad
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateFront(front.id, "input_mode", "CONTRACT_PERCENTAGE_POINTS")}
                                className={`px-2 py-1 rounded-md ${
                                  front.input_mode === "CONTRACT_PERCENTAGE_POINTS"
                                    ? "bg-emerald-600 text-white font-semibold"
                                    : "text-[var(--muted)]"
                                }`}
                              >
                                + pp contrato
                              </button>
                            </div>
                          </div>

                          {translated !== null && Number(front.input_value) > 0 && (
                            <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                              +{Number(front.input_value).toLocaleString("es-PY")} pp →{" "}
                              {translated.toLocaleString("es-PY")} {bItem.unit}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRemoveFront(front.id)}
                            className="ml-auto flex items-center gap-1 text-[11px] text-red-500 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Quitar meta
                          </button>
                        </div>
                      );
                    })}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="text-[var(--muted)]">
                        Pendiente disponible:{" "}
                        <strong className="text-[var(--foreground)]">
                          {remaining.toLocaleString("es-PY")} {bItem.unit}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAddFront(bItem.id)}
                        className="flex items-center gap-1 rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300 hover:bg-[var(--panel-2)]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Agregar otro frente
                      </button>
                    </div>

                    {exceeds && (
                      <div className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          Lo solicitado ({requestedSum.toLocaleString("es-PY")} {bItem.unit})
                          excede el remanente ({remaining.toLocaleString("es-PY")} {bItem.unit}).
                          Al calcular se limitará al remanente compartido entre frentes.
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ============ 3. RESUMEN DE METAS + CALCULAR ============ */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
          2. Metas del plan
        </div>
        {metasCount === 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Todavía no hay metas cargadas. Usá “+ Definir meta” en la partida que quieras ejecutar.
          </p>
        ) : (
          <div data-testid="metas-resumen" className="mt-2 rounded-lg border border-[var(--border)] p-3 space-y-1.5">
            {frontTargets
              .filter((t) => Number(t.input_value) > 0)
              .map((t) => {
                const b = budgetItems.find((x) => x.id === t.budget_item_id);
                if (!b) return null;
                const contractual = Number(b.quantity) || 0;
                const physical =
                  t.input_mode === "QUANTITY"
                    ? Number(t.input_value)
                    : translateTargetToQuantity(contractual, t.input_mode, Number(t.input_value));
                return (
                  <div key={t.id} className="flex flex-wrap justify-between gap-2 text-xs">
                    <span className="min-w-0 break-words text-[var(--foreground)]">
                      {b.description}
                      {t.front_label?.trim() ? ` · ${t.front_label.trim()}` : ""}
                    </span>
                    <span className="font-semibold text-[var(--foreground)] whitespace-nowrap">
                      {physical.toLocaleString("es-PY")} {b.unit}
                      {t.input_mode === "CONTRACT_PERCENTAGE_POINTS" && (
                        <span className="ml-1 font-normal text-[var(--muted)]">
                          (+{Number(t.input_value).toLocaleString("es-PY")} pp)
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            <div className="pt-1 text-[11px] text-[var(--muted)]">
              {metasCount} {metasCount === 1 ? "meta definida" : "metas definidas"} (locales, sin guardar)
            </div>
            <Button
              type="button"
              onClick={handleCalcular}
              disabled={isCalculating}
              data-testid="calcular-plan"
              className="mt-1 h-10 w-full gap-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isCalculating ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="h-4 w-4" />
              )}
              {isCalculating ? "Calculando…" : "CALCULAR PLAN"}
            </Button>
            <p className="text-[11px] text-[var(--muted)] text-center">
              Calcula materiales, stock, OC en tránsito, faltante, caja y factibilidad SIN guardar.
            </p>
          </div>
        )}
      </div>

      {/* ============ 4. RESULTADO DEL CÁLCULO (preview) ============ */}
      {preview && (
        <div data-testid="resultado-plan" className="space-y-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            RESULTADO DEL PLAN — 3. ¿Qué necesito? · 4. ¿Es factible? (preview sin guardar)
          </div>

          {previewStale && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Cambiaste metas, período o clima después de calcular — presioná CALCULAR PLAN para actualizar. Si guardás ahora, se guarda sin enlazar el pronóstico climático del preview anterior.</span>
            </div>
          )}

          {preview.weather_overlay_enabled ? (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs text-blue-800 dark:text-blue-300">
              <div className="font-semibold text-blue-900 dark:text-blue-200 flex flex-wrap items-center gap-2">
                <CloudRain className="h-4 w-4" />
                <span>
                  Factibilidad climática — pronóstico futuro {preview.weather_provider ?? "open-meteo"} · período{" "}
                  {preview.start_date} al {preview.end_date}
                </span>
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium">
                  {preview.weather_days_affected_count ?? 0} días comprometidos
                </span>
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium">
                  {preview.weather_covered_days_count ?? preview.weather_forecasts_count ?? 0}/
                  {preview.weather_plan_days_count ?? 0} días cubiertos
                </span>
                {preview.weather_coverage_is_partial ? (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    cobertura parcial
                  </span>
                ) : null}
                {preview.weather_failed_closed ? (
                  <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-700">
                    overlay no disponible
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-blue-800/90 dark:text-blue-300/90">
                {preview.weather_summary}. La meta base y la compra recomendada no se recortan
                automáticamente.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-[11px] text-[var(--muted)]">
              Factibilidad climática OFF — plan base sin overlay de pronóstico futuro. Activá Clima ON y
              recalculá para ver días cubiertos / comprometidos y capacidad estimada (no modifica la meta).
            </div>
          )}

          {/* Caja primero */}
          <div className="rounded-xl border-2 border-amber-500/50 bg-amber-500/10 p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                Caja necesaria para cumplir el plan
              </span>
              <DollarSign className="h-5 w-5 text-amber-600" />
            </div>
            <div data-testid="caja-necesaria" className="mt-1 text-3xl font-extrabold text-amber-800 dark:text-amber-200">
              Gs. {preview.total_additional_cash_required.toLocaleString("es-PY")}
            </div>
            <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
              Para cumplir este plan necesito comprar el faltante neto y necesito Gs.{" "}
              {preview.total_additional_cash_required.toLocaleString("es-PY")}. = faltante neto a comprar ×
              costo válido. No incluye valor contractual ni stock ya existente.
            </p>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="rounded bg-[var(--panel)] border border-[var(--border)] p-2">
                <div className="text-[var(--muted)]">Materiales — requerido</div>
                <div className="font-bold">Gs. {preview.total_material_consumption_value.toLocaleString("es-PY")}</div>
              </div>
              <div className="rounded bg-[var(--panel)] border border-[var(--border)] p-2">
                <div className="text-[var(--muted)]">Stock — cubierto por stock</div>
                <div className="font-bold text-emerald-700">Gs. {preview.total_covered_by_stock_value.toLocaleString("es-PY")}</div>
              </div>
              <div className="rounded bg-[var(--panel)] border border-[var(--border)] p-2">
                <div className="text-[var(--muted)]">OC en tránsito — cubierto por inbound físico</div>
                <div className="font-bold text-blue-700">Gs. {preview.total_covered_by_inbound_value.toLocaleString("es-PY")}</div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-amber-700/90 dark:text-amber-300/90">
              Faltante valorizado (lo que todavía debo comprar):{" "}
              <strong>Gs. {preview.total_additional_cash_required.toLocaleString("es-PY")}</strong>
            </div>
          </div>

          {/* Factibilidad */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/40 p-4 space-y-2">
            <div className="text-xs font-semibold text-[var(--foreground)]">Factibilidad</div>
            <div className="text-[11px] text-[var(--muted)]">
              Capacidad observada:{" "}
              {advisoryList.length > 0 ? (
                <span className="text-amber-700 dark:text-amber-300">
                  {advisoryList.map((a) => a.advisory_capacity_warning).join(" · ")}
                  {preview.items.some((i) => i.advisory_capacity_warning) && advisoryList.length < preview.items.filter((i) => i.advisory_capacity_warning).length
                    ? ` (+${preview.items.filter((i) => i.advisory_capacity_warning).length - advisoryList.length} más en el detalle)`
                    : ""}
                </span>
              ) : (
                "historial insuficiente para estimar velocidad — se muestra la meta tal cual, sin inventar ritmo."
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--muted)]">
              <span>Avance Global Ponderado</span>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="text-xl font-bold text-[var(--foreground)]">
              {preview.global_current_progress_pct}% →{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {preview.global_target_progress_pct}%
              </span>
              <span className="ml-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                +{preview.global_increment_pp} pp previstos
              </span>
            </div>
            {cappedCount > 0 && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                Restricciones: {cappedCount} {cappedCount === 1 ? "meta limitada" : "metas limitadas"} al
                remanente contractual.
              </div>
            )}
            {preview.unconfigured_materials_count > 0 && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                Restricciones: {preview.unconfigured_materials_count}{" "}
                {preview.unconfigured_materials_count === 1 ? "partida sin" : "partidas sin"} receta de
                materiales (fail-closed, ver detalle).
              </div>
            )}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 opacity-90">
              <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                <span>Valor contractual de la meta (referencial, no es caja)</span>
                <Calendar className="h-4 w-4 text-blue-500" />
              </div>
              <div className="mt-1 text-base font-bold text-[var(--foreground)]">
                Gs. {preview.total_plan_contractual_value.toLocaleString("es-PY")}
              </div>
            </div>
          </div>

          {preview.unconfigured_materials_count > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>Atención:</strong> {preview.unconfigured_materials_count} partidas planificadas no tienen receta de materiales configurada o requieren definición explícita.
              </span>
            </div>
          )}

          {/* Detalle por partida */}
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <div className="bg-[var(--panel-2)] px-4 py-2.5 border-b border-[var(--border)]">
              <h4 className="text-xs font-semibold text-[var(--foreground)] uppercase tracking-wider">
                Detalle por partida — qué necesito (expandir) ({preview.items.length})
              </h4>
              <p className="text-[11px] text-[var(--muted)]">
                requerido − stock − OC = faltante · expandí cada meta para ver materiales y caja
              </p>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {preview.items.map((ci, idx) => {
                const rowKey = `${ci.budget_item_id}-${ci.front_label || "default"}-${idx}`;
                const isExpanded = expandedResultKey === rowKey;
                return (
                  <div key={rowKey} className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setExpandedResultKey(isExpanded ? null : rowKey)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                    >
                      <span className="min-w-0 break-words text-xs font-medium text-[var(--foreground)]">
                        <span className="font-mono text-[var(--muted)] mr-2">{ci.item_code}</span>
                        {ci.item_description}
                        {ci.front_label ? ` · ${ci.front_label}` : ""}
                        {ci.materials_warning && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-medium">
                            {ci.materials_warning}
                          </span>
                        )}
                        {ci.was_capped && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 text-[10px]">
                            limitado al remanente
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2 text-xs shrink-0">
                        <span className="font-bold text-emerald-700 dark:text-emerald-300">
                          {ci.target_quantity.toLocaleString("es-PY")} {ci.unit}
                        </span>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 space-y-2 text-xs">
                        <div className="font-semibold text-[var(--foreground)]">
                          Qué necesito para cumplir el plan — {ci.item_code}
                          {ci.front_label ? ` · ${ci.front_label}` : ""}:{" "}
                          {ci.target_quantity.toLocaleString("es-PY")} {ci.unit}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          Meta física: {ci.target_quantity.toLocaleString("es-PY")} {ci.unit}
                          {ci.input_mode === "CONTRACT_PERCENTAGE_POINTS" && (
                            <span> (+{Number(ci.input_value).toLocaleString("es-PY")} pp contrato)</span>
                          )}
                          {" · "}Contrato {ci.contractual_quantity.toLocaleString("es-PY")} · Ejecutado{" "}
                          {ci.previously_executed_quantity.toLocaleString("es-PY")} · Remanente{" "}
                          {/* P2-3: el engine puede devolver remaining negativo con sobre-ejecución;
                              en pantalla se muestra clampeado igual que el header (solo display). */}
                          {Math.max(0, ci.remaining_quantity).toLocaleString("es-PY")} {ci.unit}
                        </div>
                        {ci.advisory_capacity_warning ? (
                          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300 text-[11px]">
                            Capacidad observada: {ci.advisory_capacity_warning}
                          </div>
                        ) : (
                          <div className="text-[11px] text-[var(--muted)]">
                            Capacidad observada: historial insuficiente para estimar velocidad — se muestra la meta tal cual, sin inventar ritmo.
                          </div>
                        )}
                        {preview.weather_overlay_enabled && typeof ci.weather_adjusted_capacity === "number" ? (
                          <div className="rounded border border-blue-500/30 bg-blue-500/10 p-2 text-blue-800 dark:text-blue-300 text-[11px]">
                            Factibilidad climática: con clima parece viable ejecutar{" "}
                            {ci.weather_adjusted_capacity.toLocaleString("es-PY")} {ci.unit}
                            {typeof ci.weather_gap_quantity === "number" && ci.weather_gap_quantity < 0 ? (
                              <span> (brecha {ci.weather_gap_quantity.toLocaleString("es-PY")} {ci.unit})</span>
                            ) : null}
                            . No modifica la meta base.
                          </div>
                        ) : null}
                        {ci.materials.length > 0 ? (
                          <div className="rounded border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
                            <table className="w-full text-left text-[11px]">
                              <thead>
                                <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
                                  <th className="py-1.5 px-2">Material</th>
                                  <th className="py-1.5 px-2 text-right">Requerido</th>
                                  <th className="py-1.5 px-2 text-right">− Stock</th>
                                  <th className="py-1.5 px-2 text-right">− OC en tránsito</th>
                                  <th className="py-1.5 px-2 text-right">= Faltante neto</th>
                                  <th className="py-1.5 px-2 text-right">Costo</th>
                                  <th className="py-1.5 px-2 text-right">Caja necesaria</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--border)]">
                                {ci.materials.map((m) => (
                                  <tr key={m.producto_id}>
                                    <td className="py-1.5 px-2 font-medium">
                                      {m.producto_nombre}
                                      {m.requiere_atencion_costo && (
                                        <span className="ml-1.5 text-[10px] text-amber-600 font-normal">
                                          (Sin costo promedio — caja subdeclarada)
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-2 text-right">{m.demanda_bruta.toLocaleString("es-PY")} {m.unidad_medida}</td>
                                    <td className="py-1.5 px-2 text-right text-emerald-600">{m.cubierto_por_stock.toLocaleString("es-PY")} {m.unidad_medida}</td>
                                    <td className="py-1.5 px-2 text-right text-blue-600">{m.cubierto_por_inbound.toLocaleString("es-PY")} {m.unidad_medida}</td>
                                    <td className="py-1.5 px-2 text-right font-bold text-amber-700">{m.deficit_compra_neta.toLocaleString("es-PY")} {m.unidad_medida}</td>
                                    <td className="py-1.5 px-2 text-right">{m.costo_unitario ? `Gs. ${m.costo_unitario.toLocaleString("es-PY")}` : "—"}</td>
                                    <td className="py-1.5 px-2 text-right font-bold">Gs. {m.caja_adicional_requerida.toLocaleString("es-PY")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                            {ci.materials_warning ?? "Sin materiales vinculados."}
                            {ci.materials_warning && !ci.is_labor_or_service && (
                              <span className="block font-normal">
                                Contrato fail-closed (MATERIALES NO CONFIGURADOS / REVISIÓN REQUERIDA): la caja de esta partida no puede calcularse sin receta — no se muestra 0 como si estuviera todo bien.
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ============ 5. GUARDAR / COMPROMETER (después de calcular) ============ */}
          <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              5. Guardar / Comprometer — el preview no guardó nada todavía
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => handleSaveWithStatus("DRAFT")}
                disabled={isSaving}
                data-testid="guardar-borrador"
                className="h-9 gap-1.5 text-xs bg-[var(--panel-2)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--hover)]"
              >
                {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Guardar borrador
              </Button>
              <Button
                type="button"
                onClick={() => handleSaveWithStatus("COMMITTED")}
                disabled={isSaving}
                data-testid="comprometer-plan"
                className="h-9 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Comprometer plan
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
              <span>Estado (compatibilidad):</span>
              <select
                value={compatStatus}
                onChange={(e) => setCompatStatus(e.target.value as WeeklyPlanStatus)}
                data-testid="compat-status"
                className="h-7 text-[11px] rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[var(--foreground)]"
              >
                <option value="DRAFT">Borrador (DRAFT)</option>
                <option value="COMMITTED">Comprometido (COMMITTED)</option>
                <option value="CLOSED">Cerrado (CLOSED)</option>
              </select>
              <button
                type="button"
                onClick={() => handleSaveWithStatus(compatStatus)}
                disabled={isSaving}
                className="h-7 px-2 rounded-md border border-[var(--border)] text-[11px] hover:bg-[var(--panel-2)]"
              >
                Guardar con estado seleccionado
              </button>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas (opcional)"
                className="h-7 flex-1 min-w-40 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-[11px]"
              />
            </div>
            {planId && (
              <p className="text-[11px] text-[var(--muted)]">
                Plan existente: {planId.slice(0, 8)}… · estado guardado: {savedStatus ?? "—"}.
                Guardar es atómico (si un ítem falla, no queda plan a medias).
              </p>
            )}
          </div>
        </div>
      )}

      {/* Sin preview: insinuar el siguiente paso */}
      {!preview && metasCount > 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-[11px] text-[var(--muted)]">
          Tenés {metasCount} {metasCount === 1 ? "meta local" : "metas locales"} sin calcular.
          Presioná <strong>CALCULAR PLAN</strong> en “2. Metas del plan” para ver materiales, stock, faltante, caja y factibilidad — sin guardar.
        </div>
      )}
    </div>
  );
}

export default WeeklyPlanSection;

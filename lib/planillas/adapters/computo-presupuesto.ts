import type { SupabaseClient } from "@supabase/supabase-js";
import type { BudgetItem } from "@/lib/types";
import type { PlanillaAdapter, PlanillaChanges, PlanillaColumn, PlanillaRowMeta, ApplyResult } from "../types";
import { PlanillaConcurrencyError } from "../types";

export type ComputoRow = PlanillaRowMeta & {
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  /** Calculada (quantity × unit_price) — nunca se escribe, budget_items.subtotal
   * es GENERATED ALWAYS AS ... STORED en Postgres (ver 0028_construccion_pro.sql).
   * Se manda a Handsontable/HyperFormula solo para mostrarla y recalcularla
   * en vivo; el motor jamás la persiste como si fuera un campo propio. */
  subtotal: number | null;
};

export type ComputoContexto = { projectId: string };

export const COMPUTO_PRESUPUESTO_COLUMNS: PlanillaColumn[] = [
  { key: "code", label: "Código", type: "text", width: 90 },
  { key: "description", label: "Descripción", type: "text", width: 320 },
  { key: "unit", label: "Unidad", type: "text", width: 80 },
  { key: "quantity", label: "Cantidad", type: "numeric", width: 100 },
  { key: "unit_price", label: "Precio unitario", type: "numeric", width: 130 },
  {
    key: "subtotal",
    label: "Subtotal",
    type: "readonly-numeric",
    width: 140,
    readOnly: true,
    // D=quantity, E=unit_price en el orden de columnas de arriba (0-indexed: code=A,
    // description=B, unit=C, quantity=D, unit_price=E, subtotal=F).
    formulaTemplate: "=D{row}*E{row}",
  },
];

export const computoPresupuestoAdapter: PlanillaAdapter<ComputoRow, ComputoContexto> = {
  id: "computo_presupuesto",
  columns: COMPUTO_PRESUPUESTO_COLUMNS,

  async resolverContexto(supabase: SupabaseClient, empresaId: string, contextoRaw: unknown): Promise<ComputoContexto> {
    const projectId = (contextoRaw as { projectId?: unknown } | null)?.projectId;
    if (typeof projectId !== "string" || !projectId) {
      throw new Error("contexto.projectId es requerido.");
    }
    // Única puerta de autorización sobre un contexto arbitrario: el proyecto
    // tiene que pertenecer a la empresa del usuario autenticado — nunca se
    // confía en un projectId de otro tenant aunque el request lo incluya.
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!project) throw new Error("Proyecto no encontrado o no pertenece a tu empresa.");
    return { projectId };
  },

  async obtenerFilasIniciales(supabase: SupabaseClient, contexto: ComputoContexto): Promise<ComputoRow[]> {
    const { data, error } = await supabase
      .from("budget_items")
      .select("id, code, description, unit, quantity, unit_price, subtotal, updated_at")
      .eq("project_id", contexto.projectId)
      .order("sort_order")
      .returns<(BudgetItem & { updated_at: string })[]>();
    if (error) throw new Error(error.message);
    return (data ?? []).map((b) => ({
      _rowId: b.id,
      _version: b.updated_at,
      code: b.code,
      description: b.description,
      unit: b.unit,
      quantity: b.quantity,
      unit_price: b.unit_price,
      subtotal: b.subtotal,
    }));
  },

  /* eslint-disable @typescript-eslint/no-unused-vars -- firma fija por PlanillaAdapter<Row, Context> */
  async aplicarCambios(
    supabase: SupabaseClient,
    planillaId: string,
    cambios: PlanillaChanges<ComputoRow>,
    contexto: ComputoContexto
  ): Promise<ApplyResult> {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    // La confirmación real vive en la función Postgres planilla_confirmar_computo
    // (0088_planillas.sql) — es la única forma de garantizar atomicidad real
    // (insert+update+delete de N filas en una sola transacción) sin exponer
    // un camino de escritura parcial vía requests HTTP independientes.
    const { data, error } = await supabase.rpc("planilla_confirmar_computo", { p_planilla_id: planillaId });
    if (error) {
      if (error.code === "P0409") throw new PlanillaConcurrencyError(error.message);
      throw new Error(error.message);
    }
    const result = (data?.result ?? { inserted: 0, updated: 0, deleted: 0 }) as Omit<ApplyResult, "alreadyConfirmed">;
    return { ...result, alreadyConfirmed: Boolean(data?.already_confirmed) };
  },
};
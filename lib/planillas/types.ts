import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Toda fila que pasa por el motor de planillas lleva esta identidad interna,
 * oculta al usuario (no se renderiza como columna en Handsontable). Una fila
 * NUNCA se identifica por posición — ver REGLA #8 del batch.
 *
 * `_rowId` de una fila existente es el uuid real del registro fuente
 * (ej. budget_items.id). Una fila nueva agregada en la grilla usa el prefijo
 * `new:` + un id temporal generado en el cliente (`new:<uuid>`), para poder
 * distinguirla de una fila real sin ambigüedad — nunca se confía en el orden.
 *
 * `_version` es lo que el adaptador usa para detectar concurrencia (en el
 * adaptador de cómputo, el `updated_at` de budget_items al momento de crear
 * la planilla). `_deleted` marca una fila existente para borrado sin quitarla
 * del array — así el snapshot conserva su `_rowId`/`_version` hasta confirmar.
 */
export type PlanillaRowMeta = {
  _rowId: string;
  _version?: string | null;
  _deleted?: boolean;
};

export type PlanillaRow = PlanillaRowMeta & Record<string, unknown>;

export type PlanillaColumnType = "text" | "numeric" | "readonly-numeric";

/** Definición de columna — única fuente de verdad, la usan tanto la grilla
 * (Handsontable) como cualquier validación server-side del adaptador. */
export type PlanillaColumn = {
  key: string;
  label: string;
  type: PlanillaColumnType;
  /** Plantilla de fórmula HyperFormula para columnas calculadas, con `{row}`
   * como placeholder del número de fila 1-based (ej. "=D{row}*E{row}").
   * String, no función: las columnas viajan de un Server Component a
   * PlanillaGrid (client) y React Server Components no puede serializar
   * funciones a través de ese límite. */
  formulaTemplate?: string;
  width?: number;
  readOnly?: boolean;
};

export type PlanillaChanges<Row> = {
  /** Snapshot completo y final de filas al momento de confirmar — el motor
   * y el adaptador derivan inserts/updates/deletes comparando contra la
   * identidad (_rowId), nunca contra la posición. */
  rows: (Row & PlanillaRowMeta)[];
};

export type ApplyResult = {
  inserted: number;
  updated: number;
  deleted: number;
  /** true si la planilla ya estaba confirmada y no se reaplicó nada — ver
   * REGLA #13 (idempotencia). El motor genérico lo usa para responder igual
   * ante un doble-click o un retry HTTP sin que el adaptador tenga que
   * inventar su propio contrato de "ya hecho". */
  alreadyConfirmed?: boolean;
};

/** Error tipado para que la capa HTTP pueda mapear a 409 sin adivinar por
 * el texto del mensaje. */
export class PlanillaConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanillaConcurrencyError";
  }
}

/**
 * Interfaz que debe implementar cada módulo de negocio. El motor genérico
 * (persistencia de sesión, autosave, confirmación, endpoints) SOLO conoce
 * esta interfaz — nunca reglas de cómputo, licitación, jornales, etc.
 */
export interface PlanillaAdapter<Row extends PlanillaRowMeta, Context> {
  id: string;
  columns: PlanillaColumn[];

  /** Valida que `contexto` (tal cual llega del cliente) sea del tenant y
   * proyecto del usuario autenticado, y devuelve el Context tipado que
   * usan el resto de los métodos. Lanza si el usuario no tiene acceso —
   * esta es la única puerta de autorización sobre `contexto` arbitrario. */
  resolverContexto(supabase: SupabaseClient, empresaId: string, contextoRaw: unknown): Promise<Context>;

  obtenerFilasIniciales(supabase: SupabaseClient, contexto: Context): Promise<Row[]>;

  /** Ejecuta la confirmación real contra las tablas de dominio. Debe ser
   * atómica (transacción/RPC) e idempotente. Lanza PlanillaConcurrencyError
   * si alguna fila fuente cambió desde que se abrió la planilla. */
  aplicarCambios(
    supabase: SupabaseClient,
    planillaId: string,
    cambios: PlanillaChanges<Row>,
    contexto: Context
  ): Promise<ApplyResult>;
}

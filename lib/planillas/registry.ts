import { computoPresupuestoAdapter } from "./adapters/computo-presupuesto";
import type { PlanillaAdapter, PlanillaRowMeta } from "./types";

/**
 * Registro tipado en código — única fuente de verdad de qué adaptadores
 * existen. A propósito NO hay una tabla `plantilla_adaptadores` en Supabase:
 * el set de módulos soportados es un hecho del código (deploy), no un dato
 * de negocio que alguien necesite editar en runtime, y una tabla paralela
 * solo agregaría una segunda fuente de verdad para `columns` sin necesidad.
 */
export const planillaAdapters = {
  computo_presupuesto: computoPresupuestoAdapter,
} satisfies Record<string, PlanillaAdapter<PlanillaRowMeta, unknown>>;

export type PlanillaModulo = keyof typeof planillaAdapters;

export function isPlanillaModulo(value: unknown): value is PlanillaModulo {
  return typeof value === "string" && value in planillaAdapters;
}

export function getPlanillaAdapter(modulo: string): PlanillaAdapter<PlanillaRowMeta, unknown> {
  if (!isPlanillaModulo(modulo)) {
    throw new Error(`Módulo de planilla desconocido: ${modulo}`);
  }
  return planillaAdapters[modulo];
}

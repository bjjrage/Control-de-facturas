import type { SupabaseClient } from "@supabase/supabase-js";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPlanillaAdapter, isPlanillaModulo } from "./registry";
import type { PlanillaChanges, PlanillaRowMeta } from "./types";

export type PlanillaSessionRow = {
  id: string;
  empresa_id: string;
  usuario_id: string | null;
  modulo: string;
  contexto: Record<string, unknown>;
  snapshot: { rows: PlanillaRowMeta[] };
  estado: "draft" | "confirmed" | "cancelled";
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

export class PlanillaNotFoundError extends Error {
  constructor() {
    super("Planilla no encontrada.");
    this.name = "PlanillaNotFoundError";
  }
}

/**
 * Todo lo que sigue asume `supabase` = cliente ligado a la sesión del
 * usuario (createClient() de lib/supabase/server) — RLS es la defensa
 * real, estas funciones son la segunda capa (fail closed: nunca se
 * confía en un id que llega del cliente sin volver a filtrar por
 * empresa_id acá también, aunque RLS ya lo haría).
 */

const SELECT_COLS = "id, empresa_id, usuario_id, modulo, contexto, snapshot, estado, created_at, updated_at, confirmed_at";

export async function crearPlanilla(modulo: string, contextoRaw: unknown): Promise<PlanillaSessionRow> {
  if (!isPlanillaModulo(modulo)) throw new Error(`Módulo de planilla desconocido: ${modulo}`);
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const adapter = getPlanillaAdapter(modulo);

  // resolverContexto es la única puerta de autorización sobre `contexto`
  // arbitrario que manda el cliente — valida pertenencia a la empresa antes
  // de leer una sola fila.
  const contexto = await adapter.resolverContexto(supabase, profile.empresa_id, contextoRaw);
  const filas = await adapter.obtenerFilasIniciales(supabase, contexto);

  const baseVersions: Record<string, string> = {};
  for (const f of filas) {
    if (f._version) baseVersions[f._rowId] = f._version;
  }

  const { data, error } = await supabase
    .from("planillas")
    .insert({
      empresa_id: profile.empresa_id,
      usuario_id: profile.id,
      modulo,
      contexto: contexto as Record<string, unknown>,
      snapshot: { rows: filas },
      base_versions: baseVersions,
      estado: "draft",
    })
    .select(SELECT_COLS)
    .single();

  if (error || !data) throw new Error(error?.message ?? "No se pudo crear la planilla.");
  return data as PlanillaSessionRow;
}

export async function obtenerPlanilla(id: string): Promise<PlanillaSessionRow>;
export async function obtenerPlanilla(
  supabase: SupabaseClient,
  empresaId: string,
  id: string
): Promise<PlanillaSessionRow>;
export async function obtenerPlanilla(
  idOrSupabase: string | SupabaseClient,
  empresaId?: string,
  idMaybe?: string
): Promise<PlanillaSessionRow> {
  if (typeof idOrSupabase === "string") {
    const profile = await requireProfile(["administracion", "admin"]);
    const supabase = await createClient();
    return obtenerPlanillaWithClient(supabase, profile.empresa_id, idOrSupabase);
  }
  return obtenerPlanillaWithClient(idOrSupabase, empresaId as string, idMaybe as string);
}

async function obtenerPlanillaWithClient(
  supabase: SupabaseClient,
  empresaId: string,
  id: string
): Promise<PlanillaSessionRow> {
  const { data, error } = await supabase
    .from("planillas")
    .select(SELECT_COLS)
    .eq("id", id)
    .eq("empresa_id", empresaId) // defensa en profundidad — RLS ya lo filtra
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new PlanillaNotFoundError();
  return data as PlanillaSessionRow;
}

/** PATCH: solo actualiza el borrador (snapshot). Nunca toca las tablas del
 * módulo — ver REGLA #10. Rechaza si la planilla ya no está en draft. */
export async function actualizarSnapshot(id: string, rows: PlanillaRowMeta[]): Promise<{ updated_at: string }>;
export async function actualizarSnapshot(
  supabase: SupabaseClient,
  empresaId: string,
  id: string,
  rows: PlanillaRowMeta[]
): Promise<{ updated_at: string }>;
export async function actualizarSnapshot(
  idOrSupabase: string | SupabaseClient,
  rowsOrEmpresaId: PlanillaRowMeta[] | string,
  idMaybe?: string,
  rowsMaybe?: PlanillaRowMeta[]
): Promise<{ updated_at: string }> {
  if (typeof idOrSupabase === "string") {
    const profile = await requireProfile(["administracion", "admin"]);
    const supabase = await createClient();
    return actualizarSnapshotWithClient(supabase, profile.empresa_id, idOrSupabase, rowsOrEmpresaId as PlanillaRowMeta[]);
  }
  return actualizarSnapshotWithClient(
    idOrSupabase,
    rowsOrEmpresaId as string,
    idMaybe as string,
    rowsMaybe as PlanillaRowMeta[]
  );
}

async function actualizarSnapshotWithClient(
  supabase: SupabaseClient,
  empresaId: string,
  id: string,
  rows: PlanillaRowMeta[]
): Promise<{ updated_at: string }> {
  const { data: current } = await supabase
    .from("planillas")
    .select("estado")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!current) throw new PlanillaNotFoundError();
  if (current.estado !== "draft") {
    throw new Error(`No se puede editar una planilla en estado "${current.estado}".`);
  }

  const { data, error } = await supabase
    .from("planillas")
    .update({ snapshot: { rows } })
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .select("updated_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "No se pudo guardar el borrador.");
  return data as { updated_at: string };
}

export type ConfirmarResultado = { alreadyConfirmed: boolean; result: { inserted: number; updated: number; deleted: number } };

export async function confirmarPlanilla(id: string): Promise<ConfirmarResultado>;
export async function confirmarPlanilla(
  supabase: SupabaseClient,
  empresaId: string,
  id: string
): Promise<ConfirmarResultado>;
export async function confirmarPlanilla(
  idOrSupabase: string | SupabaseClient,
  empresaIdMaybe?: string,
  idMaybe?: string
): Promise<ConfirmarResultado> {
  if (typeof idOrSupabase === "string") {
    const profile = await requireProfile(["administracion", "admin"]);
    const supabase: SupabaseClient = await createClient();
    return confirmarPlanillaWithClient(supabase, profile.empresa_id, idOrSupabase);
  }
  return confirmarPlanillaWithClient(idOrSupabase, empresaIdMaybe as string, idMaybe as string);
}

async function confirmarPlanillaWithClient(
  supabase: SupabaseClient,
  empresaId: string,
  id: string
): Promise<ConfirmarResultado> {
  const { data: planilla, error: fetchError } = await supabase
    .from("planillas")
    .select(SELECT_COLS)
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!planilla) throw new PlanillaNotFoundError();

  const adapter = getPlanillaAdapter(planilla.modulo);
  const contexto = await adapter.resolverContexto(supabase, empresaId, planilla.contexto);
  const cambios: PlanillaChanges<PlanillaRowMeta> = { rows: (planilla.snapshot as { rows: PlanillaRowMeta[] }).rows };

  const { alreadyConfirmed, ...result } = await adapter.aplicarCambios(supabase, id, cambios, contexto);
  return { alreadyConfirmed: Boolean(alreadyConfirmed), result };
}

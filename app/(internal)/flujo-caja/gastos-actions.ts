"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode, GastoRecurrenteCategoria, GastoRecurrentePeriodicidad } from "@/lib/types";

async function ctx() {
  const supabase = await createClient();
  const profile = await requireProfile(["administracion", "admin"]);
  return { supabase, profile };
}

export type GastoRecurrenteInput = {
  descripcion: string;
  categoria: GastoRecurrenteCategoria;
  monto_estimado: number;
  moneda: CurrencyCode;
  periodicidad: GastoRecurrentePeriodicidad;
  dia_del_mes?: number | null;
  cuenta_id?: string | null;
  project_id?: string | null;
  proximo_vencimiento?: string | null;
  notas?: string;
};

export async function crearGastoRecurrente(data: GastoRecurrenteInput): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await ctx();
  if (!data.descripcion.trim()) return { error: "La descripción no puede estar vacía" };
  if (!data.monto_estimado || data.monto_estimado <= 0) return { error: "El monto debe ser mayor a cero" };

  const { data: row, error } = await supabase
    .from("gastos_recurrentes")
    .insert({
      empresa_id: profile.empresa_id,
      descripcion: data.descripcion.trim(),
      categoria: data.categoria,
      monto_estimado: data.monto_estimado,
      moneda: data.moneda,
      periodicidad: data.periodicidad,
      dia_del_mes: data.dia_del_mes ?? null,
      cuenta_id: data.cuenta_id || null,
      project_id: data.project_id || null,
      proximo_vencimiento: data.proximo_vencimiento || null,
      notas: data.notas?.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/flujo-caja");
  return { id: row.id };
}

export async function actualizarGastoRecurrente(
  id: string,
  data: Partial<GastoRecurrenteInput>
): Promise<{ error?: string }> {
  const { supabase } = await ctx();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.descripcion !== undefined) patch.descripcion = data.descripcion.trim();
  if (data.categoria !== undefined) patch.categoria = data.categoria;
  if (data.monto_estimado !== undefined) patch.monto_estimado = data.monto_estimado;
  if (data.moneda !== undefined) patch.moneda = data.moneda;
  if (data.periodicidad !== undefined) patch.periodicidad = data.periodicidad;
  if (data.dia_del_mes !== undefined) patch.dia_del_mes = data.dia_del_mes ?? null;
  if (data.cuenta_id !== undefined) patch.cuenta_id = data.cuenta_id || null;
  if (data.project_id !== undefined) patch.project_id = data.project_id || null;
  if (data.proximo_vencimiento !== undefined) patch.proximo_vencimiento = data.proximo_vencimiento || null;
  if (data.notas !== undefined) patch.notas = data.notas?.trim() || null;

  const { error } = await supabase.from("gastos_recurrentes").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/flujo-caja");
  return {};
}

export async function setGastoRecurrenteActivo(id: string, activo: boolean): Promise<{ error?: string }> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("gastos_recurrentes")
    .update({ activo, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/flujo-caja");
  return {};
}

export async function eliminarGastoRecurrente(id: string): Promise<{ error?: string }> {
  const { supabase } = await ctx();
  const { error } = await supabase.from("gastos_recurrentes").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/flujo-caja");
  return {};
}

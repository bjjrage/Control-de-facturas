"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import type { CuentaFinancieraTipo, CurrencyCode } from "@/lib/types";

async function ctx() {
  const supabase = await createClient();
  const profile = await requireProfile(["administracion", "admin"]);
  return { supabase, profile };
}

// ──────────────────────────────────────────────
// Cuentas financieras
// ──────────────────────────────────────────────

export async function crearCuenta(data: {
  nombre: string;
  tipo: CuentaFinancieraTipo;
  banco?: string;
  numero_cuenta?: string;
  moneda: CurrencyCode;
  saldo_inicial?: number;
}): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await ctx();
  const nombre = data.nombre.trim();
  if (!nombre) return { error: "El nombre no puede estar vacío" };

  const { data: cuenta, error } = await supabase
    .from("cuentas_financieras")
    .insert({
      empresa_id: profile.empresa_id,
      nombre,
      tipo: data.tipo,
      banco: data.banco?.trim() || null,
      numero_cuenta: data.numero_cuenta?.trim() || null,
      moneda: data.moneda,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Ya existe una cuenta con ese nombre" };
    return { error: error.message };
  }

  if (data.saldo_inicial && data.saldo_inicial !== 0) {
    const { error: movErr } = await supabase.rpc("registrar_movimiento_tesoreria", {
      p_empresa_id: profile.empresa_id,
      p_cuenta_id: cuenta.id,
      p_monto: data.saldo_inicial,
      p_tipo: "SALDO_INICIAL",
      p_motivo: "Saldo inicial de la cuenta",
      p_created_by: profile.id,
      p_permitir_negativo: true,
    });
    if (movErr) return { error: `Cuenta creada, error al cargar el saldo inicial: ${movErr.message}` };
  }

  await logAudit(supabase, { action: "cuenta_financiera_created", detail: { cuenta_id: cuenta.id } });
  revalidatePath("/tesoreria");
  return { id: cuenta.id };
}

export async function actualizarCuenta(
  id: string,
  data: { nombre?: string; tipo?: CuentaFinancieraTipo; banco?: string; numero_cuenta?: string }
): Promise<{ error?: string }> {
  const { supabase } = await ctx();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.nombre !== undefined) patch.nombre = data.nombre.trim();
  if (data.tipo !== undefined) patch.tipo = data.tipo;
  if (data.banco !== undefined) patch.banco = data.banco?.trim() || null;
  if (data.numero_cuenta !== undefined) patch.numero_cuenta = data.numero_cuenta?.trim() || null;

  const { error } = await supabase.from("cuentas_financieras").update(patch).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: "Ya existe una cuenta con ese nombre" };
    return { error: error.message };
  }
  revalidatePath("/tesoreria");
  return {};
}

export async function setCuentaActiva(id: string, activo: boolean): Promise<{ error?: string }> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("cuentas_financieras")
    .update({ activo, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tesoreria");
  return {};
}

// ──────────────────────────────────────────────
// Movimientos manuales (ingreso / egreso / ajuste)
// ──────────────────────────────────────────────

export async function registrarMovimientoManual(data: {
  cuenta_id: string;
  tipo: "INGRESO" | "EGRESO" | "AJUSTE";
  monto: number; // siempre positivo; el signo lo pone el tipo
  fecha?: string;
  motivo: string;
  project_id?: string | null;
}): Promise<{ saldo_nuevo?: number; error?: string }> {
  const { supabase, profile } = await ctx();
  const motivo = data.motivo.trim();
  if (!motivo) return { error: "El motivo es obligatorio" };
  if (!data.monto || data.monto <= 0) return { error: "El monto debe ser mayor a cero" };

  // AJUSTE puede ser + o -; el cliente manda el signo en ese caso vía monto.
  const monto = data.tipo === "EGRESO" ? -Math.abs(data.monto) : data.tipo === "INGRESO" ? Math.abs(data.monto) : data.monto;

  const { data: saldo, error } = await supabase.rpc("registrar_movimiento_tesoreria", {
    p_empresa_id: profile.empresa_id,
    p_cuenta_id: data.cuenta_id,
    p_monto: monto,
    p_tipo: data.tipo,
    p_fecha: data.fecha || null,
    p_motivo: motivo,
    p_project_id: data.project_id || null,
    p_created_by: profile.id,
    p_permitir_negativo: data.tipo === "AJUSTE",
  });

  if (error) return { error: error.message };

  await logAudit(supabase, {
    action: "movimiento_tesoreria_manual",
    detail: { cuenta_id: data.cuenta_id, tipo: data.tipo, monto },
  });
  revalidatePath("/tesoreria");
  return { saldo_nuevo: saldo as number };
}

// ──────────────────────────────────────────────
// Transferencias entre cuentas
// ──────────────────────────────────────────────

export async function registrarTransferencia(data: {
  cuenta_origen_id: string;
  cuenta_destino_id: string;
  monto_origen: number;
  monto_destino?: number; // requerido si las monedas difieren
  fecha?: string;
  motivo?: string;
}): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await ctx();
  if (data.cuenta_origen_id === data.cuenta_destino_id) {
    return { error: "Origen y destino no pueden ser la misma cuenta" };
  }
  if (!data.monto_origen || data.monto_origen <= 0) return { error: "El monto debe ser mayor a cero" };

  const { data: id, error } = await supabase.rpc("registrar_transferencia", {
    p_empresa_id: profile.empresa_id,
    p_cuenta_origen_id: data.cuenta_origen_id,
    p_cuenta_destino_id: data.cuenta_destino_id,
    p_monto_origen: data.monto_origen,
    p_monto_destino: data.monto_destino && data.monto_destino > 0 ? data.monto_destino : null,
    p_fecha: data.fecha || null,
    p_motivo: data.motivo?.trim() || null,
    p_created_by: profile.id,
  });

  if (error) return { error: error.message };

  await logAudit(supabase, {
    action: "transferencia_tesoreria",
    detail: { origen: data.cuenta_origen_id, destino: data.cuenta_destino_id, monto: data.monto_origen },
  });
  revalidatePath("/tesoreria");
  return { id: id as string };
}

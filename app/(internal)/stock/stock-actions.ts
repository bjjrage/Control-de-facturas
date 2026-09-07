"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

async function getClient() {
  const supabase = await createClient();
  const profile = await requirePlan("pro");
  return { supabase, profile };
}

// ──────────────────────────────────────────────
// Productos
// ──────────────────────────────────────────────

export async function crearProducto(data: {
  nombre: string;
  unidad: string;
  sku?: string;
  descripcion?: string;
  stock_minimo?: number;
  stock_inicial?: number;
  contenido_por_unidad?: number;
  unidad_base?: string;
}): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await getClient();

  const { data: producto, error } = await supabase
    .from("productos")
    .insert({
      empresa_id: profile.empresa_id,
      nombre: data.nombre.trim(),
      unidad: data.unidad.trim(),
      sku: data.sku?.trim() || null,
      descripcion: data.descripcion?.trim() || null,
      stock_minimo: data.stock_minimo ?? 0,
      stock_actual: 0,
      contenido_por_unidad: data.contenido_por_unidad ?? null,
      unidad_base: data.unidad_base?.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Si hay stock inicial, registrarlo como ENTRADA
  if (data.stock_inicial && data.stock_inicial > 0) {
    const { error: movErr } = await supabase.rpc("registrar_stock_movimiento", {
      p_empresa_id: profile.empresa_id,
      p_producto_id: producto.id,
      p_tipo: "ENTRADA",
      p_cantidad: data.stock_inicial,
      p_notas: "Stock inicial",
      p_created_by: profile.id,
    });
    if (movErr) return { error: movErr.message };
  }

  await logAudit(supabase, { action: "producto_created", detail: { producto_id: producto.id } });
  revalidatePath("/stock");
  return { id: producto.id };
}

export async function actualizarProducto(
  id: string,
  data: { nombre?: string; unidad?: string; sku?: string; descripcion?: string; stock_minimo?: number; contenido_por_unidad?: number | null; unidad_base?: string | null }
): Promise<{ error?: string }> {
  const { supabase } = await getClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.nombre !== undefined) patch.nombre = data.nombre.trim();
  if (data.unidad !== undefined) patch.unidad = data.unidad.trim();
  if (data.sku !== undefined) patch.sku = data.sku?.trim() || null;
  if (data.descripcion !== undefined) patch.descripcion = data.descripcion?.trim() || null;
  if (data.stock_minimo !== undefined) patch.stock_minimo = data.stock_minimo;
  if (data.contenido_por_unidad !== undefined) patch.contenido_por_unidad = data.contenido_por_unidad ?? null;
  if (data.unidad_base !== undefined) patch.unidad_base = data.unidad_base?.trim() || null;

  const { error } = await supabase.from("productos").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/stock/${id}`);
  revalidatePath("/stock");
  return {};
}

export async function desactivarProducto(id: string): Promise<{ error?: string }> {
  const { supabase } = await getClient();

  const { error } = await supabase
    .from("productos")
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/stock");
  revalidatePath(`/stock/${id}`);
  return {};
}

export async function reactivarProducto(id: string): Promise<{ error?: string }> {
  const { supabase } = await getClient();

  const { error } = await supabase
    .from("productos")
    .update({ activo: true, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/stock");
  revalidatePath(`/stock/${id}`);
  return {};
}

// ──────────────────────────────────────────────
// Movimientos
// ──────────────────────────────────────────────

export async function registrarMovimiento(
  producto_id: string,
  tipo: "ENTRADA" | "SALIDA" | "AJUSTE",
  cantidad: number,
  opts?: { referencia_tipo?: string; referencia_id?: string; notas?: string }
): Promise<{ stock_nuevo?: number; error?: string }> {
  const { supabase, profile } = await getClient();

  const { data, error } = await supabase.rpc("registrar_stock_movimiento", {
    p_empresa_id: profile.empresa_id,
    p_producto_id: producto_id,
    p_tipo: tipo,
    p_cantidad: cantidad,
    p_referencia_tipo: opts?.referencia_tipo ?? null,
    p_referencia_id: opts?.referencia_id ?? null,
    p_notas: opts?.notas ?? null,
    p_created_by: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/stock/${producto_id}`);
  revalidatePath("/stock");
  return { stock_nuevo: data as number };
}

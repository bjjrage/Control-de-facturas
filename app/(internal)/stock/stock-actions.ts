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
  categoria_id?: string | null;
  stock_minimo?: number;
  stock_inicial?: number;
  costo_inicial?: number;
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
      categoria_id: data.categoria_id || null,
      stock_minimo: data.stock_minimo ?? 0,
      stock_actual: 0,
      contenido_por_unidad: data.contenido_por_unidad ?? null,
      unidad_base: data.unidad_base?.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Si hay stock inicial, registrarlo como ENTRADA (con costo si se indicó)
  if (data.stock_inicial && data.stock_inicial > 0) {
    const { error: movErr } = await supabase.rpc("registrar_stock_movimiento", {
      p_empresa_id: profile.empresa_id,
      p_producto_id: producto.id,
      p_tipo: "ENTRADA",
      p_cantidad: data.stock_inicial,
      p_costo_unitario: data.costo_inicial && data.costo_inicial > 0 ? data.costo_inicial : null,
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
  data: { nombre?: string; unidad?: string; sku?: string; descripcion?: string; categoria_id?: string | null; stock_minimo?: number; contenido_por_unidad?: number | null; unidad_base?: string | null }
): Promise<{ error?: string }> {
  const { supabase } = await getClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.nombre !== undefined) patch.nombre = data.nombre.trim();
  if (data.unidad !== undefined) patch.unidad = data.unidad.trim();
  if (data.sku !== undefined) patch.sku = data.sku?.trim() || null;
  if (data.descripcion !== undefined) patch.descripcion = data.descripcion?.trim() || null;
  if (data.categoria_id !== undefined) patch.categoria_id = data.categoria_id || null;
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
  tipo: "ENTRADA" | "SALIDA" | "AJUSTE" | "TRANSFERENCIA",
  cantidad: number,
  opts?: {
    referencia_tipo?: string;
    referencia_id?: string;
    notas?: string;
    costo_unitario?: number;
    project_id?: string | null;
    budget_item_id?: string | null;
    deposito_id?: string | null;
    deposito_destino_id?: string | null;
  }
): Promise<{ stock_nuevo?: number; error?: string }> {
  const { supabase, profile } = await getClient();

  const { data, error } = await supabase.rpc("registrar_stock_movimiento", {
    p_empresa_id: profile.empresa_id,
    p_producto_id: producto_id,
    p_tipo: tipo,
    p_cantidad: cantidad,
    p_costo_unitario: opts?.costo_unitario && opts.costo_unitario > 0 ? opts.costo_unitario : null,
    p_referencia_tipo: opts?.referencia_tipo ?? null,
    p_referencia_id: opts?.referencia_id ?? null,
    p_notas: opts?.notas ?? null,
    p_created_by: profile.id,
    p_project_id: opts?.project_id || null,
    p_budget_item_id: opts?.budget_item_id || null,
    p_deposito_id: opts?.deposito_id || null,
    p_deposito_destino_id: opts?.deposito_destino_id || null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/stock/${producto_id}`);
  revalidatePath("/stock");
  return { stock_nuevo: data as number };
}

// ──────────────────────────────────────────────
// Categorías / rubros
// ──────────────────────────────────────────────

// Rubros típicos de una constructora — se ofrecen de un click cuando la empresa
// todavía no cargó ninguna categoría.
const CATEGORIAS_SUGERIDAS = [
  "Áridos y agregados",
  "Cemento y aglomerantes",
  "Hierro y acero",
  "Ladrillos y bloques",
  "Maderas y encofrados",
  "Sanitarios y plomería",
  "Eléctrico",
  "Pinturas y revestimientos",
  "Aberturas",
  "Herramientas",
  "EPP y seguridad",
  "Combustibles y lubricantes",
];

export async function crearCategoria(nombre: string): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await getClient();
  const limpio = nombre.trim();
  if (!limpio) return { error: "El nombre no puede estar vacío" };

  const { data, error } = await supabase
    .from("categorias_producto")
    .insert({ empresa_id: profile.empresa_id, nombre: limpio })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Ya existe una categoría con ese nombre" };
    return { error: error.message };
  }
  revalidatePath("/stock");
  return { id: data.id };
}

export async function renombrarCategoria(id: string, nombre: string): Promise<{ error?: string }> {
  const { supabase } = await getClient();
  const limpio = nombre.trim();
  if (!limpio) return { error: "El nombre no puede estar vacío" };

  const { error } = await supabase
    .from("categorias_producto")
    .update({ nombre: limpio, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: "Ya existe una categoría con ese nombre" };
    return { error: error.message };
  }
  revalidatePath("/stock");
  return {};
}

export async function eliminarCategoria(id: string): Promise<{ error?: string }> {
  const { supabase } = await getClient();
  // on delete set null en productos.categoria_id — los productos quedan sin categoría.
  const { error } = await supabase.from("categorias_producto").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/stock");
  return {};
}

// ──────────────────────────────────────────────
// Depósitos
// ──────────────────────────────────────────────

export async function crearDeposito(nombre: string): Promise<{ id?: string; error?: string }> {
  const { supabase, profile } = await getClient();
  const limpio = nombre.trim();
  if (!limpio) return { error: "El nombre no puede estar vacío" };

  const { data, error } = await supabase
    .from("depositos")
    .insert({ empresa_id: profile.empresa_id, nombre: limpio })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Ya existe un depósito con ese nombre" };
    return { error: error.message };
  }
  revalidatePath("/stock");
  return { id: data.id };
}

export async function renombrarDeposito(id: string, nombre: string): Promise<{ error?: string }> {
  const { supabase } = await getClient();
  const limpio = nombre.trim();
  if (!limpio) return { error: "El nombre no puede estar vacío" };

  const { error } = await supabase
    .from("depositos")
    .update({ nombre: limpio, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { error: "Ya existe un depósito con ese nombre" };
    return { error: error.message };
  }
  revalidatePath("/stock");
  return {};
}

export async function eliminarDeposito(id: string): Promise<{ error?: string }> {
  const { supabase } = await getClient();
  const { error } = await supabase.from("depositos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/stock");
  return {};
}

export async function crearCategoriasSugeridas(): Promise<{ creadas?: number; error?: string }> {
  const { supabase, profile } = await getClient();

  const { data: existentes } = await supabase
    .from("categorias_producto")
    .select("nombre")
    .eq("empresa_id", profile.empresa_id);

  const yaHay = new Set((existentes ?? []).map((c) => c.nombre.toLowerCase()));
  const faltan = CATEGORIAS_SUGERIDAS.filter((n) => !yaHay.has(n.toLowerCase()));
  if (faltan.length === 0) return { creadas: 0 };

  const { error } = await supabase.from("categorias_producto").insert(
    faltan.map((nombre, i) => ({
      empresa_id: profile.empresa_id,
      nombre,
      orden: i,
    }))
  );

  if (error) return { error: error.message };
  revalidatePath("/stock");
  return { creadas: faltan.length };
}

// ──────────────────────────────────────────────
// Importación masiva
// ──────────────────────────────────────────────

export type FilaImport = {
  nombre: string;
  sku?: string;
  categoria_nombre?: string;
  unidad: string;
  contenido_por_unidad?: number;
  unidad_base?: string;
  descripcion?: string;
  stock_minimo?: number;
  stock_inicial?: number;
  costo_inicial?: number;
};

export type ResultadoImport = {
  creados: number;
  errores: { fila: number; nombre: string; mensaje: string }[];
};

export async function importarProductos(filas: FilaImport[]): Promise<ResultadoImport> {
  const { supabase, profile } = await getClient();

  // Categorías existentes: mapa nombre lowercase → id
  const { data: cats } = await supabase
    .from("categorias_producto")
    .select("id, nombre")
    .eq("empresa_id", profile.empresa_id);
  const catMap = new Map<string, string>();
  for (const c of cats ?? []) catMap.set(c.nombre.toLowerCase().trim(), c.id);

  // Crear categorías nuevas que vengan en el archivo pero no existan todavía
  const newCatNames = new Map<string, string>(); // lc → original case
  for (const f of filas) {
    if (f.categoria_nombre) {
      const lc = f.categoria_nombre.toLowerCase().trim();
      if (!catMap.has(lc) && !newCatNames.has(lc)) {
        newCatNames.set(lc, f.categoria_nombre.trim());
      }
    }
  }
  if (newCatNames.size > 0) {
    const baseOrden = cats?.length ?? 0;
    const toInsert = [...newCatNames.entries()].map(([, nombre], i) => ({
      empresa_id: profile.empresa_id,
      nombre,
      orden: baseOrden + i,
    }));
    const { data: created } = await supabase
      .from("categorias_producto")
      .insert(toInsert)
      .select("id, nombre");
    for (const c of created ?? []) catMap.set(c.nombre.toLowerCase().trim(), c.id);
  }

  let creados = 0;
  const errores: ResultadoImport["errores"] = [];

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const nombre = f.nombre?.trim();
    const unidad = f.unidad?.trim();

    if (!nombre) {
      errores.push({ fila: i + 2, nombre: nombre || "—", mensaje: "Nombre requerido" });
      continue;
    }
    if (!unidad) {
      errores.push({ fila: i + 2, nombre, mensaje: "Unidad requerida" });
      continue;
    }

    const categoria_id = f.categoria_nombre
      ? (catMap.get(f.categoria_nombre.toLowerCase().trim()) ?? null)
      : null;

    const { data: producto, error: pErr } = await supabase
      .from("productos")
      .insert({
        empresa_id: profile.empresa_id,
        nombre,
        unidad,
        sku: f.sku?.trim() || null,
        descripcion: f.descripcion?.trim() || null,
        categoria_id,
        stock_minimo: f.stock_minimo ?? 0,
        stock_actual: 0,
        contenido_por_unidad: f.contenido_por_unidad ?? null,
        unidad_base: f.unidad_base?.trim() || null,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (pErr) {
      errores.push({ fila: i + 2, nombre, mensaje: pErr.message });
      continue;
    }

    if (f.stock_inicial && f.stock_inicial > 0) {
      const { error: movErr } = await supabase.rpc("registrar_stock_movimiento", {
        p_empresa_id: profile.empresa_id,
        p_producto_id: producto.id,
        p_tipo: "ENTRADA",
        p_cantidad: f.stock_inicial,
        p_costo_unitario: f.costo_inicial && f.costo_inicial > 0 ? f.costo_inicial : null,
        p_notas: "Stock inicial (importación)",
        p_created_by: profile.id,
      });
      if (movErr) {
        errores.push({ fila: i + 2, nombre, mensaje: `Producto creado, error en stock inicial: ${movErr.message}` });
        creados++;
        continue;
      }
    }

    creados++;
  }

  revalidatePath("/stock");
  return { creados, errores };
}

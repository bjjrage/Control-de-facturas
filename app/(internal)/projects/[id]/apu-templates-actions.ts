"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { normalizeInventoryImportText, findUniqueExactInventoryMatch } from "@/lib/inventory/initial-stock-import";
import { PLANILLA_APU_PREFIX } from "@/lib/costing/price-list";
import {
  resolveApuTemplateMaterialImportMapping,
  resolveApuTemplateLaborImportMapping,
  resolveApuTemplateEquipmentImportMapping,
  resolveApuTemplateSubcontractImportMapping,
  matchLaborRate,
  type ApuTemplateMaterialImportRowInput,
  type ApuTemplateLaborImportRowInput,
  type ApuTemplateEquipmentImportRowInput,
  type ApuTemplateSubcontractImportRowInput,
  type ApuTemplateImportRowError,
} from "@/lib/procurement/apu-templates";

// ---------------------------------------------------------------------------
// Plantillas de APU a nivel empresa: se cargan UNA vez (por Excel) y se
// aplican solas a cualquier partida de cualquier obra que matchee por
// descripción (ver apu-actions.ts → applyApuTemplatesToProjectAction).
// ---------------------------------------------------------------------------

export interface ApuTemplateSummary {
  id: string;
  nombre: string;
  materialesCount: number;
  laborCount: number;
  equipoCount: number;
  subcontratoCount: number;
}

export async function listApuTemplatesAction(): Promise<{
  data: ApuTemplateSummary[] | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { data: templates, error } = await supabase
      .from("apu_templates")
      .select("id, nombre")
      .eq("empresa_id", profile.empresa_id)
      .order("nombre");
    if (error) return { data: null, error: error.message };
    if (!templates || templates.length === 0) return { data: [], error: null };

    const ids = templates.map((t) => t.id);
    const [materialsRes, laborRes, equipmentRes, subcontractsRes] = await Promise.all([
      supabase.from("apu_template_materials").select("template_id").in("template_id", ids),
      supabase.from("apu_template_labor").select("template_id").in("template_id", ids),
      supabase.from("apu_template_equipment").select("template_id").in("template_id", ids),
      supabase.from("apu_template_subcontracts").select("template_id").in("template_id", ids),
    ]);
    const countBy = (rows: { template_id: string }[] | null) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) m.set(r.template_id, (m.get(r.template_id) ?? 0) + 1);
      return m;
    };
    const materialCounts = countBy(materialsRes.data as any);
    const laborCounts = countBy(laborRes.data as any);
    const equipmentCounts = countBy(equipmentRes.data as any);
    const subcontractCounts = countBy(subcontractsRes.data as any);

    return {
      data: templates.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        materialesCount: materialCounts.get(t.id) ?? 0,
        laborCount: laborCounts.get(t.id) ?? 0,
        equipoCount: equipmentCounts.get(t.id) ?? 0,
        subcontratoCount: subcontractCounts.get(t.id) ?? 0,
      })),
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err.message || "Error al listar plantillas de APU." };
  }
}

export async function deleteApuTemplateAction(id: string): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { error } = await supabase.from("apu_templates").delete().eq("id", id).eq("empresa_id", profile.empresa_id);
    if (error) return { success: false, error: error.message };
    revalidatePath("/configuracion");
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function ensureTemplateIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  nombres: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))];
  const { data: existing } = await supabase.from("apu_templates").select("id, nombre").eq("empresa_id", empresaId).in("nombre", unique);
  const byNombre = new Map<string, string>((existing ?? []).map((t: any) => [t.nombre, t.id]));
  const missing = unique.filter((n) => !byNombre.has(n));
  if (missing.length > 0) {
    const { data: created, error } = await supabase
      .from("apu_templates")
      .insert(missing.map((nombre) => ({ empresa_id: empresaId, nombre })))
      .select("id, nombre");
    if (error) throw new Error(`Error al crear plantillas: ${error.message}`);
    for (const t of created ?? []) byNombre.set(t.nombre, t.id);
  }
  return byNombre;
}

export async function importApuTemplateMaterialsAction(params: {
  rows: ApuTemplateMaterialImportRowInput[];
}): Promise<{ creados: number; errores: ApuTemplateImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: productsData } = await supabase.from("productos").select("id, sku").eq("empresa_id", profile.empresa_id).eq("activo", true);
  const products = (productsData ?? []).map((p: any) => ({ id: p.id, sku: p.sku }));
  const { mapped, errors } = resolveApuTemplateMaterialImportMapping(params.rows, products);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const byNombre = await ensureTemplateIds(supabase, profile.empresa_id, mapped.map((m) => m.templateNombre));
  const { error } = await supabase.from("apu_template_materials").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      template_id: byNombre.get(m.templateNombre)!,
      producto_id: m.productoId,
      cantidad_por_unidad_ejecutada: m.cantidadPorUnidad,
      desperdicio_pct: m.desperdicioPct,
    })),
    { onConflict: "template_id,producto_id" }
  );
  if (error) return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  revalidatePath("/configuracion");
  return { creados: mapped.length, errores: errors };
}

export async function importApuTemplateLaborAction(params: {
  rows: ApuTemplateLaborImportRowInput[];
}): Promise<{ creados: number; errores: ApuTemplateImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: ratesData } = await supabase
    .from("labor_rates")
    .select("id, categoria, costo_hora")
    .eq("empresa_id", profile.empresa_id);
  const rates = (ratesData ?? []).map((r: any) => ({ id: r.id, categoria: r.categoria, costo_hora: Number(r.costo_hora) }));
  // Si el rol coincide con una categoría de jornal, manda el costo central.
  const rows = params.rows.map((r) => {
    const rate = matchLaborRate(r.rol, rates);
    return rate ? { ...r, costoHora: rate.costo_hora } : r;
  });
  const { mapped, errors } = resolveApuTemplateLaborImportMapping(rows);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const byNombre = await ensureTemplateIds(supabase, profile.empresa_id, mapped.map((m) => m.templateNombre));
  const { error } = await supabase.from("apu_template_labor").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      template_id: byNombre.get(m.templateNombre)!,
      rol: m.rol,
      horas_por_unidad_ejecutada: m.horasPorUnidad,
      costo_hora: m.costoHora,
      labor_rate_id: matchLaborRate(m.rol, rates)?.id ?? null,
    })),
    { onConflict: "template_id,rol" }
  );
  if (error) return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  revalidatePath("/configuracion");
  return { creados: mapped.length, errores: errors };
}

export async function importApuTemplateEquipmentAction(params: {
  rows: ApuTemplateEquipmentImportRowInput[];
}): Promise<{ creados: number; errores: ApuTemplateImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { mapped, errors } = resolveApuTemplateEquipmentImportMapping(params.rows);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const byNombre = await ensureTemplateIds(supabase, profile.empresa_id, mapped.map((m) => m.templateNombre));
  const { error } = await supabase.from("apu_template_equipment").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      template_id: byNombre.get(m.templateNombre)!,
      tipo_equipo: m.tipoEquipo,
      horas_por_unidad_ejecutada: m.horasPorUnidad,
      costo_hora: m.costoHora,
    })),
    { onConflict: "template_id,tipo_equipo" }
  );
  if (error) return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  revalidatePath("/configuracion");
  return { creados: mapped.length, errores: errors };
}

export async function importApuTemplateSubcontractsAction(params: {
  rows: ApuTemplateSubcontractImportRowInput[];
}): Promise<{ creados: number; errores: ApuTemplateImportRowError[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { mapped, errors } = resolveApuTemplateSubcontractImportMapping(params.rows);
  if (mapped.length === 0) return { creados: 0, errores: errors };

  const byNombre = await ensureTemplateIds(supabase, profile.empresa_id, mapped.map((m) => m.templateNombre));
  const { error } = await supabase.from("apu_template_subcontracts").upsert(
    mapped.map((m) => ({
      empresa_id: profile.empresa_id,
      template_id: byNombre.get(m.templateNombre)!,
      descripcion: m.descripcion,
      precio_por_unidad: m.precioPorUnidad,
    })),
    { onConflict: "template_id,descripcion" }
  );
  if (error) return { creados: 0, errores: [...errors, { row: 0, reason: `Error al guardar: ${error.message}` }] };
  revalidatePath("/projects");
  return { creados: mapped.length, errores: errors };
}

// ---------------------------------------------------------------------------
// Importación de UNA planilla de APU (analizada por Luna y revisada por el
// usuario): crea las plantillas con sus cuatro tipos de líneas de una vez.
// Se revalida todo en el servidor: nunca se confía en lo que manda el cliente.
// ---------------------------------------------------------------------------

export interface ApuPlanillaLineInput {
  tipo: "MATERIAL" | "MANO_DE_OBRA" | "EQUIPO" | "SUBCONTRATO";
  descripcion: string;
  unidad: string | null;
  cantidad: number;
  precio: number | null;
  desperdicioPct: number;
}

export interface ApuPlanillaRecipeInput {
  name: string;
  code: string | null;
  unit: string | null;
  lines: ApuPlanillaLineInput[];
}

export interface ApuPlanillaImportResult {
  plantillas: number;
  lineas: number;
  productosCreados: number;
  preciosGuardados: number;
  errores: { receta: string; insumo: string; motivo: string }[];
  error: string | null;
}

const HOUR_UNIT = /^(h|hs|hr|hrs|hora|horas)$/i;
const WORKDAY_UNIT = /^(jornal|jornales|jor|dia|dias|día|días)$/i;

export async function importApuPlanillaAction(params: {
  recipes: ApuPlanillaRecipeInput[];
  createMissingProducts: boolean;
  /** Horas de una jornada, para insumos de mano de obra o equipo que vienen en jornales. */
  hoursPerWorkday?: number;
}): Promise<ApuPlanillaImportResult> {
  const empty = { plantillas: 0, lineas: 0, productosCreados: 0, preciosGuardados: 0, errores: [] as ApuPlanillaImportResult["errores"] };
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const empresaId = profile.empresa_id;
    const errores = empty.errores;

    const [productsRes, ratesRes] = await Promise.all([
      supabase.from("productos").select("id, nombre").eq("empresa_id", empresaId).eq("activo", true),
      supabase.from("labor_rates").select("id, categoria, costo_hora").eq("empresa_id", empresaId),
    ]);
    const products = (productsRes.data ?? []).map((p: any) => ({ id: p.id as string, name: p.nombre as string }));
    const rates = (ratesRes.data ?? []).map((r: any) => ({ id: r.id as string, categoria: r.categoria as string, costo_hora: Number(r.costo_hora) }));

    // 1) Materiales: match único por nombre normalizado; los que no están en
    //    el catálogo se crean solo si el usuario lo pidió.
    const materialNames = new Map<string, { nombre: string; unidad: string | null }>();
    for (const r of params.recipes) {
      for (const l of r.lines) {
        if (l.tipo !== "MATERIAL") continue;
        const key = normalizeInventoryImportText(l.descripcion);
        if (key && !findUniqueExactInventoryMatch(l.descripcion, products) && !materialNames.has(key)) {
          materialNames.set(key, { nombre: l.descripcion.trim(), unidad: l.unidad?.trim() || null });
        }
      }
    }
    let productosCreados = 0;
    if (params.createMissingProducts && materialNames.size > 0) {
      const { data: created, error } = await supabase
        .from("productos")
        .insert([...materialNames.values()].map((m) => ({ empresa_id: empresaId, nombre: m.nombre, unidad: m.unidad ?? "unidad", created_by: profile.id })))
        .select("id, nombre");
      if (error) return { ...empty, error: `No se pudieron crear los materiales nuevos en el catálogo: ${error.message}` };
      for (const p of created ?? []) products.push({ id: p.id, name: p.nombre });
      productosCreados = created?.length ?? 0;
    }

    // 2) Filas por tabla, validadas.
    const materialRows: { recipe: string; productoId: string; cantidad: number; desperdicio: number }[] = [];
    const priceHints: { recipe: string; productoId: string; descripcion: string; unidad: string; precio: number }[] = [];
    const laborRows: { recipe: string; rol: string; horas: number; costoHora: number; rateId: string | null }[] = [];
    const equipmentRows: { recipe: string; tipo: string; horas: number; costoHora: number }[] = [];
    const subcontractRows: { recipe: string; descripcion: string; precio: number }[] = [];

    for (const recipe of params.recipes) {
      const rname = String(recipe.name ?? "").trim();
      if (!rname) continue;
      for (const l of recipe.lines ?? []) {
        const fail = (motivo: string) => errores.push({ receta: rname, insumo: l.descripcion, motivo });
        const cantidad = Number(l.cantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) {
          fail("Cantidad inválida.");
          continue;
        }
        const precio = l.precio == null ? null : Number(l.precio);
        if (precio != null && (!Number.isFinite(precio) || precio < 0)) {
          fail("Precio inválido.");
          continue;
        }
        if (l.tipo === "MATERIAL") {
          const product = findUniqueExactInventoryMatch(l.descripcion, products);
          if (!product) {
            fail("El material no está en el catálogo (o hay más de uno con ese nombre).");
            continue;
          }
          const desperdicio = Number(l.desperdicioPct) || 0;
          if (desperdicio < 0 || desperdicio > 100) {
            fail("Desperdicio fuera de 0–100 %.");
            continue;
          }
          materialRows.push({ recipe: rname, productoId: product.id, cantidad, desperdicio });
          if (precio != null && precio > 0) {
            priceHints.push({ recipe: rname, productoId: product.id, descripcion: l.descripcion.trim(), unidad: (l.unidad?.trim() || "UN").toUpperCase(), precio });
          }
        } else if (l.tipo === "MANO_DE_OBRA" || l.tipo === "EQUIPO") {
          let horas = cantidad;
          let costoPorHora = precio;
          const unidad = l.unidad?.trim() ?? "";
          if (unidad && WORKDAY_UNIT.test(unidad)) {
            const hpd = Number(params.hoursPerWorkday);
            if (!Number.isFinite(hpd) || hpd <= 0 || hpd > 24) {
              fail(`Viene en ${unidad}: indicá cuántas horas tiene una jornada.`);
              continue;
            }
            horas = cantidad * hpd;
            costoPorHora = precio == null ? null : precio / hpd;
          } else if (unidad && !HOUR_UNIT.test(unidad)) {
            fail(`Debe venir en horas o jornales (vino en "${l.unidad}").`);
            continue;
          }
          if (l.tipo === "MANO_DE_OBRA") {
            const rate = matchLaborRate(l.descripcion, rates);
            const costoHora = rate ? rate.costo_hora : costoPorHora;
            if (costoHora == null) {
              fail("Falta el costo por hora: cargá la categoría en Jornales o poné el precio en la planilla.");
              continue;
            }
            laborRows.push({ recipe: rname, rol: l.descripcion.trim(), horas, costoHora: Math.round(costoHora * 100) / 100, rateId: rate?.id ?? null });
          } else {
            if (costoPorHora == null) {
              fail("Falta el costo por hora del equipo.");
              continue;
            }
            equipmentRows.push({ recipe: rname, tipo: l.descripcion.trim(), horas, costoHora: Math.round(costoPorHora * 100) / 100 });
          }
        } else if (l.tipo === "SUBCONTRATO") {
          if (precio == null) {
            fail("Falta el precio del subcontrato.");
            continue;
          }
          subcontractRows.push({ recipe: rname, descripcion: l.descripcion.trim(), precio: Math.round(cantidad * precio * 100) / 100 });
        }
      }
    }

    // 3) Plantillas (por nombre) y líneas.
    const usedNames = new Set([...materialRows, ...laborRows, ...equipmentRows, ...subcontractRows].map((r) => r.recipe));
    const toCreate = params.recipes.filter((r) => usedNames.has(String(r.name ?? "").trim()));
    const { data: existing } = await supabase
      .from("apu_templates")
      .select("id, nombre")
      .eq("empresa_id", empresaId)
      .in("nombre", toCreate.map((r) => r.name.trim()));
    const idByName = new Map<string, string>((existing ?? []).map((t: any) => [t.nombre, t.id]));
    const missing = toCreate.filter((r) => !idByName.has(r.name.trim()));
    if (missing.length > 0) {
      const { data: created, error } = await supabase
        .from("apu_templates")
        .insert(missing.map((r) => ({ empresa_id: empresaId, nombre: r.name.trim(), codigo: r.code?.trim() || null, unidad: r.unit?.trim() || null })))
        .select("id, nombre");
      if (error) return { ...empty, productosCreados, error: `Error al crear las plantillas: ${error.message}` };
      for (const t of created ?? []) idByName.set(t.nombre, t.id);
    }

    const write = async (table: string, rows: Record<string, unknown>[], onConflict: string) => {
      if (rows.length === 0) return null;
      const { error } = await supabase.from(table).upsert(rows, { onConflict });
      return error ? `Error al guardar ${table}: ${error.message}` : null;
    };
    const failures = (
      await Promise.all([
        write(
          "apu_template_materials",
          materialRows.map((m) => ({ empresa_id: empresaId, template_id: idByName.get(m.recipe)!, producto_id: m.productoId, cantidad_por_unidad_ejecutada: m.cantidad, desperdicio_pct: m.desperdicio })),
          "template_id,producto_id"
        ),
        write(
          "apu_template_labor",
          laborRows.map((m) => ({ empresa_id: empresaId, template_id: idByName.get(m.recipe)!, rol: m.rol, horas_por_unidad_ejecutada: m.horas, costo_hora: m.costoHora, labor_rate_id: m.rateId })),
          "template_id,rol"
        ),
        write(
          "apu_template_equipment",
          equipmentRows.map((m) => ({ empresa_id: empresaId, template_id: idByName.get(m.recipe)!, tipo_equipo: m.tipo, horas_por_unidad_ejecutada: m.horas, costo_hora: m.costoHora })),
          "template_id,tipo_equipo"
        ),
        write(
          "apu_template_subcontracts",
          subcontractRows.map((m) => ({ empresa_id: empresaId, template_id: idByName.get(m.recipe)!, descripcion: m.descripcion, precio_por_unidad: m.precio })),
          "template_id,descripcion"
        ),
      ])
    ).filter(Boolean) as string[];
    if (failures.length > 0) return { ...empty, productosCreados, error: failures.join(" · ") };

    // 4) Los precios de materiales de la planilla quedan como precio de referencia
    //    (fuente MANUAL, marcada como planilla de APU). Una cotización o factura
    //    posterior pesa más en la estimación. No se repite el mismo precio.
    let preciosGuardados = 0;
    if (priceHints.length > 0) {
      const { data: prior } = await supabase
        .from("cost_observations")
        .select("producto_id, precio_unitario")
        .eq("empresa_id", empresaId)
        .eq("fuente", "MANUAL")
        .like("documento_id", `${PLANILLA_APU_PREFIX}%`)
        .in("producto_id", [...new Set(priceHints.map((h) => h.productoId))]);
      const seen = new Set((prior ?? []).map((o: any) => `${o.producto_id}:${Number(o.precio_unitario)}`));
      const today = new Date().toISOString().slice(0, 10);
      const rowsToInsert = priceHints
        .filter((h) => {
          const key = `${h.productoId}:${h.precio}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((h) => ({
          empresa_id: empresaId,
          producto_id: h.productoId,
          proveedor_id: null,
          fuente: "MANUAL",
          documento_id: `${PLANILLA_APU_PREFIX}${h.recipe}`.slice(0, 200),
          descripcion_item: h.descripcion,
          categoria_insumo: "MATERIAL",
          cantidad: 1,
          unidad: h.unidad,
          precio_unitario: h.precio,
          moneda: "PYG",
          moneda_original: "PYG",
          precio_unitario_original: h.precio,
          tipo_cambio: null,
          fecha_observacion: today,
          estado_evidencia: "VALIDA",
        }));
      if (rowsToInsert.length > 0) {
        const { error: obsError } = await supabase.from("cost_observations").insert(rowsToInsert);
        if (obsError) {
          errores.push({ receta: "—", insumo: "Precios de materiales", motivo: `No se pudieron guardar los precios de la planilla: ${obsError.message}` });
        } else {
          preciosGuardados = rowsToInsert.length;
        }
      }
    }

    revalidatePath("/projects");
    revalidatePath("/precios");
    return {
      plantillas: toCreate.length,
      lineas: materialRows.length + laborRows.length + equipmentRows.length + subcontractRows.length,
      productosCreados,
      preciosGuardados,
      errores,
      error: null,
    };
  } catch (err: any) {
    return { ...empty, error: err.message || "No se pudo importar la planilla." };
  }
}

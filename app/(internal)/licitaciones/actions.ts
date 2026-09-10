"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { DncpNotFoundError, fetchRecord, normalizarNro } from "@/lib/dncp/client";
import { parseCompiledRelease } from "@/lib/dncp/parse";
import { createClient } from "@/lib/supabase/server";
import type { LicitacionDecision } from "@/lib/types";

async function ctx() {
  const supabase = await createClient();
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  return { supabase, profile };
}

/**
 * Trae una licitación de la DNCP por su número y la guarda (o actualiza).
 */
export async function importarLicitacion(
  nroInput: string
): Promise<{ id?: string; nro?: string; error?: string }> {
  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;

  let nro: string;
  try {
    nro = normalizarNro(nroInput);
  } catch (e) {
    return { error: (e as Error).message };
  }

  let compiled: Record<string, unknown>;
  try {
    compiled = await fetchRecord(nro);
  } catch (e) {
    if (e instanceof DncpNotFoundError) {
      return { error: `No se encontró la licitación ${nro} en la DNCP.` };
    }
    return { error: `Error consultando la DNCP: ${(e as Error).message}` };
  }

  const parsed = parseCompiledRelease(compiled);
  const c = parsed.cabecera;
  // El número que tipeó el usuario manda sobre lo que infiera el parser.
  c.dncp_nro = nro;
  c.ocid = `ocds-03ad3f-${nro}`;

  // ¿La empresa está entre los notificados? (por RUC, si lo tenemos)
  const { data: empresaRow } = await supabase
    .from("empresas")
    .select("ruc")
    .eq("id", empresaId)
    .maybeSingle<{ ruc: string | null }>();
  const miRuc = empresaRow?.ruc?.replace(/\D/g, "") ?? null;
  const invitada =
    !!miRuc &&
    parsed.notificados.some((ns) => (ns.ruc ?? "").replace(/\D/g, "").includes(miRuc));

  // Ingestar el hecho público globalmente en procurement_* (idempotente)
  let processId: string | null = null;
  try {
    const { data: procIdData } = await supabase.rpc("ingestar_proceso_ocds_global", {
      p_cr: compiled,
      p_fuente: "DNCP_OCDS",
    });
    if (typeof procIdData === "string") {
      processId = procIdData;
      // Registrar seguimiento privado en empresa_licitacion_seguimiento
      await supabase.from("empresa_licitacion_seguimiento").upsert(
        {
          empresa_id: empresaId,
          process_id: processId,
          invitada,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,process_id" }
      );
    }
  } catch {
    // Si la RPC no está aplicada aún en producción remota, continúa con retrocompatibilidad
  }

  // Upsert cabecera (con process_id vinculado)
  const { data: lic, error: licErr } = await supabase
    .from("licitaciones")
    .upsert(
      {
        empresa_id: empresaId,
        process_id: processId,
        dncp_nro: c.dncp_nro || nro,
        ocid: c.ocid || `ocds-03ad3f-${nro}`,
        titulo: c.titulo,
        comitente_nombre: c.comitente_nombre,
        comitente_id: c.comitente_id,
        categoria: c.categoria,
        categoria_detalle: c.categoria_detalle,
        procurement_method: c.procurement_method,
        procurement_method_detalle: c.procurement_method_detalle,
        award_criteria_detalle: c.award_criteria_detalle,
        monto_referencial: c.monto_referencial,
        monto_disponible: c.monto_disponible,
        moneda: c.moneda,
        fecha_publicacion: c.fecha_publicacion,
        fecha_consultas_fin: c.fecha_consultas_fin,
        fecha_entrega_ofertas: c.fecha_entrega_ofertas,
        fecha_apertura: c.fecha_apertura,
        lugar_apertura: c.lugar_apertura,
        estado: c.estado,
        estado_detalle: c.estado_detalle,
        invitada,
        raw_json: compiled,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "empresa_id,ocid" }
    )
    .select("id")
    .single();

  if (licErr || !lic) return { error: `No se pudo guardar: ${licErr?.message}` };
  const licId = lic.id as string;

  // Re-sincronizar hijos: borrar y re-insertar
  await Promise.all([
    supabase.from("licitacion_lotes").delete().eq("licitacion_id", licId),
    supabase.from("licitacion_items").delete().eq("licitacion_id", licId),
    supabase.from("licitacion_oferentes").delete().eq("licitacion_id", licId),
    supabase.from("licitacion_documentos").delete().eq("licitacion_id", licId),
  ]);

  // Lotes (guardamos el mapa lote_dncp_id → id para los ítems)
  const loteIdByDncp = new Map<string, string>();
  if (parsed.lotes.length > 0) {
    const { data: lotesRows } = await supabase
      .from("licitacion_lotes")
      .insert(
        parsed.lotes.map((l) => ({
          licitacion_id: licId,
          empresa_id: empresaId,
          lote_dncp_id: l.lote_dncp_id,
          numero: l.numero,
          titulo: l.titulo,
          monto_referencial: l.monto_referencial,
        }))
      )
      .select("id, lote_dncp_id");
    for (const r of lotesRows ?? []) {
      if (r.lote_dncp_id) loteIdByDncp.set(r.lote_dncp_id as string, r.id as string);
    }
  }

  if (parsed.items.length > 0) {
    await supabase.from("licitacion_items").insert(
      parsed.items.map((it) => ({
        licitacion_id: licId,
        empresa_id: empresaId,
        lote_id: it.lote_dncp_id ? (loteIdByDncp.get(it.lote_dncp_id) ?? null) : null,
        codigo_catalogo: it.codigo_catalogo,
        codigo_unspsc: it.codigo_unspsc,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidad,
        precio_unitario_referencial: it.precio_unitario_referencial,
        sort_order: it.sort_order,
      }))
    );
  }

  if (parsed.oferentes.length > 0) {
    await supabase.from("licitacion_oferentes").insert(
      parsed.oferentes.map((o) => ({
        licitacion_id: licId,
        empresa_id: empresaId,
        ruc: o.ruc,
        nombre: o.nombre,
        tamano: o.tamano,
        monto_ofertado: o.monto_ofertado,
        gano: o.gano,
        lotes_ganados: o.lotes_ganados,
        fuente: o.fuente,
      }))
    );
  }

  if (parsed.documentos.length > 0) {
    // Dedup por url
    const seen = new Set<string>();
    const docs = parsed.documentos.filter((d) => {
      const k = d.url_dncp ?? `${d.tipo_detalle}-${d.titulo}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    await supabase.from("licitacion_documentos").insert(
      docs.map((d) => ({
        licitacion_id: licId,
        empresa_id: empresaId,
        tipo: d.tipo,
        tipo_detalle: d.tipo_detalle,
        titulo: d.titulo,
        url_dncp: d.url_dncp,
      }))
    );
  }

  await logAudit(supabase, { action: "licitacion_importada", detail: { nro, lic_id: licId } });
  revalidatePath("/licitaciones");
  revalidatePath(`/licitaciones/${licId}`);
  return { id: licId, nro };
}

export async function setLicitacionDecision(
  id: string,
  decision: LicitacionDecision,
  notas?: string
): Promise<{ error?: string }> {
  const { supabase, profile } = await ctx();
  const patch: Record<string, unknown> = { decision, updated_at: new Date().toISOString() };
  if (notas !== undefined) patch.decision_notas = notas.trim() || null;

  // 1. Actualizar licitaciones legacy
  const { data: lic, error } = await supabase
    .from("licitaciones")
    .update(patch)
    .eq("id", id)
    .eq("empresa_id", profile.empresa_id)
    .select("process_id")
    .maybeSingle();

  if (error) return { error: error.message };

  // 2. Actualizar seguimiento privado formal si tiene process_id
  if (lic?.process_id) {
    try {
      await supabase.from("empresa_licitacion_seguimiento").upsert(
        {
          empresa_id: profile.empresa_id,
          process_id: lic.process_id,
          decision,
          decision_notas: notas !== undefined ? (notas.trim() || null) : undefined,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "empresa_id,process_id" }
      );
    } catch {
      // Retrocompatibilidad defensiva
    }
  }

  revalidatePath("/licitaciones");
  revalidatePath(`/licitaciones/${id}`);
  return {};
}

export async function dejarDeSeguirLicitacion(id: string): Promise<{ error?: string }> {
  const { supabase, profile } = await ctx();
  
  const { data: lic } = await supabase
    .from("licitaciones")
    .select("process_id")
    .eq("id", id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();

  if (lic?.process_id) {
    try {
      await supabase
        .from("empresa_licitacion_seguimiento")
        .delete()
        .match({ empresa_id: profile.empresa_id, process_id: lic.process_id });
    } catch {
      // Retrocompatibilidad defensiva
    }
  }

  const { error } = await supabase
    .from("licitaciones")
    .delete()
    .eq("id", id)
    .eq("empresa_id", profile.empresa_id);

  if (error) return { error: error.message };
  revalidatePath("/licitaciones");
  return {};
}

export async function guardarPerfilLicitaciones(data: {
  codigos_catalogo: string[];
  palabras_clave: string[];
  monto_min: number | null;
  monto_max: number | null;
  departamentos: string[];
}): Promise<{ error?: string }> {
  const { supabase, profile } = await ctx();
  const { error } = await supabase.from("licitacion_perfil").upsert(
    {
      empresa_id: profile.empresa_id,
      codigos_catalogo: data.codigos_catalogo,
      palabras_clave: data.palabras_clave,
      monto_min: data.monto_min,
      monto_max: data.monto_max,
      departamentos: data.departamentos,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "empresa_id" }
  );
  if (error) return { error: error.message };
  revalidatePath("/licitaciones");
  return {};
}

/**
 * Convierte una licitación ganada/adjudicada en un Proyecto activo en el ERP con cómputo métrico y pañol
 */
export async function convertirLicitacionAProyecto(
  licitacionId: string
): Promise<{ error?: string; projectId?: string; projectCode?: string }> {
  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;

  // 1. Obtener datos de la licitación
  const { data: lic, error: licError } = await supabase
    .from("licitaciones")
    .select("*")
    .eq("id", licitacionId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (licError || !lic) {
    return { error: "Licitación no encontrada o no pertenece a la empresa." };
  }

  // Regla de Integridad Contractual: Solo se puede convertir a obra una licitación con decisión GANADA
  if (lic.decision !== "GANADA") {
    return {
      error: `No se puede convertir a proyecto una licitación con estado '${lic.decision || "SIN_DECISION"}'. Debe marcarse primero como 'GANADA'.`
    };
  }

  // 2. Obtener ítems de la licitación
  const { data: items } = await supabase
    .from("licitacion_items")
    .select("*")
    .eq("licitacion_id", licitacionId)
    .order("sort_order");

  // Si no hay ítems detallados, crear al menos un ítem con el monto adjudicado
  const bidItems = (items && items.length > 0)
    ? items.map((it: any, idx: number) => ({
        itemNumber: idx + 1,
        description: it.descripcion || "Ítem de licitación",
        quantity: Number(it.cantidad || 1),
        unit: it.unidad || "UN",
        unitPricePyg: Number(it.precio_unitario_estimado || (it.monto_total ? it.monto_total / (it.cantidad || 1) : 0))
      }))
    : [{
        itemNumber: 1,
        description: `Ejecución de obra: ${lic.titulo}`,
        quantity: 1,
        unit: "GL",
        unitPricePyg: Number(lic.monto_adjudicado || lic.monto_referencial || 0)
      }];

  const { executeTenderToProjectTransaction } = await import("@/lib/procurement/tender-to-project");

  // Invariante UNKNOWN != DEFAULT: No asumir plazos ni porcentajes arbitrarios (6 meses, 10%, 5%)
  // Si la licitación no los especifica formalmente en el pliego, quedan en null para configuración manual.
  const result = await executeTenderToProjectTransaction(supabase, {
    empresaId,
    tenderId: lic.id,
    dncpNro: lic.dncp_nro,
    projectTitle: lic.titulo,
    buyerName: lic.comitente_nombre || "Entidad Convocante",
    adjudicatedOfferPricePyg: Number(lic.monto_adjudicado || lic.monto_referencial || 0),
    durationMonths: null, // UNKNOWN != DEFAULT: No inventar 6 meses
    advancePaymentPct: null, // UNKNOWN != DEFAULT: No inventar 10%
    retentionPct: null, // UNKNOWN != DEFAULT: No inventar 5%
    bidItems,
    createdBy: profile.id
  });

  if (result.error) {
    return { error: result.error };
  }

  await logAudit(supabase, {
    action: "tender.converted_to_project",
    detail: { licitacion_id: licitacionId, project_id: result.projectId, project_code: result.projectCode }
  });

  revalidatePath("/licitaciones");
  revalidatePath(`/licitaciones/${licitacionId}`);
  revalidatePath("/projects");

  return { projectId: result.projectId, projectCode: result.projectCode };
}

/**
 * Importa planillas de costos / cómputos métricos históricos (Excel/CSV) para calibrar el Cost Engine (Gate 6)
 */
export async function importarPlanillaCostosHistoricos(
  formData: FormData
): Promise<{ error?: string; importados?: number; totalLeidos?: number; categorias?: Record<string, number> }> {
  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;

  const file = formData.get("file") as File | null;
  const nombreObra = (formData.get("nombre_obra") as string) || "Obra Histórica";
  const fechaObra = (formData.get("fecha_obra") as string) || new Date().toISOString().split("T")[0];

  if (!file || file.size === 0) {
    return { error: "Por favor seleccioná un archivo Excel o CSV válido." };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { parseHistoricalSpreadsheet } = await import("@/lib/cost-engine/onboarding");
    const result = parseHistoricalSpreadsheet(buffer, {
      empresaId,
      projectName: nombreObra,
      defaultDate: fechaObra,
      defaultSource: "MANUAL"
    });

    if (result.observations.length === 0) {
      return {
        error: "No se encontraron filas con descripción y precio válidos en la planilla.",
        totalLeidos: result.totalRowsRead
      };
    }

    // Insertar en cost_observations en lotes de 100
    const observationsToInsert = result.observations.map((obs: any) => ({
      empresa_id: obs.empresaId,
      fuente: obs.fuente,
      descripcion_item: obs.descripcionItem,
      categoria_insumo: obs.categoriaInsumo,
      cantidad: obs.cantidad,
      unidad: obs.unidad,
      precio_unitario: obs.precioUnitario,
      moneda: obs.moneda,
      tipo_cambio: obs.tipoCambio,
      fecha_observacion: obs.fechaObservacion,
      es_volatil: obs.esVolatil
    }));

    const chunkSize = 100;
    for (let i = 0; i < observationsToInsert.length; i += chunkSize) {
      const chunk = observationsToInsert.slice(i, i + chunkSize);
      const { error: insertError } = await supabase.from("cost_observations").insert(chunk);
      if (insertError) {
        console.error("[Onboarding] Error inserting chunk:", insertError);
      }
    }

    await logAudit(supabase, {
      action: "cost_engine.historical_onboarding",
      detail: {
        obra: nombreObra,
        valid_rows: result.validObservations,
        total_rows: result.totalRowsRead,
        categories: result.inferredCategories
      }
    });

    revalidatePath("/licitaciones");
    revalidatePath("/licitaciones/costos");

    return {
      importados: result.validObservations,
      totalLeidos: result.totalRowsRead,
      categorias: result.inferredCategories
    };
  } catch (err: any) {
    console.error("[Onboarding] Error processing file:", err);
    return { error: `Error al procesar el archivo: ${err.message || String(err)}` };
  }
}

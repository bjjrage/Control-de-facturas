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

  // Gate 15: Obtener snapshot previo si existía para detectar cambios (adendas, prórrogas, estados)
  const { data: previousLic } = await supabase
    .from("licitaciones")
    .select("id, estado, fecha_entrega_ofertas, raw_json")
    .eq("empresa_id", empresaId)
    .eq("ocid", c.ocid || `ocds-03ad3f-${nro}`)
    .maybeSingle();

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

  // Re-sincronizar hijos: no borrar ciegamente oferentes de alta evidencia (ACTA_PDF, CUADRO_PDF, MANUAL)
  await Promise.all([
    supabase.from("licitacion_lotes").delete().eq("licitacion_id", licId),
    supabase.from("licitacion_items").delete().eq("licitacion_id", licId),
    supabase.from("licitacion_oferentes").delete().eq("licitacion_id", licId).eq("fuente", "API"),
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
    // Consultar oferentes de alta evidencia existentes para no duplicar ni degradar
    const { data: existingOferentes } = await supabase
      .from("licitacion_oferentes")
      .select("ruc, nombre, fuente")
      .eq("licitacion_id", licId);

    const existingRucs = new Set((existingOferentes ?? []).map(e => (e.ruc || '').trim().toUpperCase()).filter(Boolean));
    const existingNames = new Set((existingOferentes ?? []).map(e => (e.nombre || '').trim().toUpperCase()));

    const newOferentes = parsed.oferentes.filter((o) => {
      const ruc = (o.ruc || '').trim().toUpperCase();
      const nom = (o.nombre || '').trim().toUpperCase();
      if (ruc && existingRucs.has(ruc)) return false;
      if (nom && existingNames.has(nom)) return false;
      return true;
    });

    if (newOferentes.length > 0) {
      await supabase.from("licitacion_oferentes").insert(
        newOferentes.map((o) => ({
          licitacion_id: licId,
          empresa_id: empresaId,
          ruc: o.ruc,
          nombre: o.nombre,
          tamano: o.tamano,
          monto_ofertado: o.monto_ofertado,
          gano: o.gano,
          lotes_ganados: o.lotes_ganados,
          fuente: o.fuente || 'API',
        }))
      );
    }
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

  // Gate 15: Tender Monitoring Diff Engine (Auditoría de cambios y adendas)
  if (previousLic) {
    try {
      const { compareTenderSnapshots } = await import("@/lib/procurement/tender-monitoring");
      const prevDocsList = Array.isArray(previousLic.raw_json?.tender?.documents)
        ? previousLic.raw_json.tender.documents.map((d: any) => ({
            tipo: d.documentType,
            tipo_detalle: d.documentTypeDetails,
            titulo: d.title,
            url: d.url
          }))
        : [];
      const currDocsList = Array.isArray((compiled as any)?.tender?.documents)
        ? (compiled as any).tender.documents.map((d: any) => ({
            tipo: d.documentType,
            tipo_detalle: d.documentTypeDetails,
            titulo: d.title,
            url: d.url
          }))
        : [];

      const alerts = compareTenderSnapshots(
        {
          tenderId: licId,
          status: previousLic.estado || "DESCONOCIDO",
          submissionDeadline: previousLic.fecha_entrega_ofertas || "",
          documents: prevDocsList,
          lastModifiedDate: ""
        },
        {
          tenderId: licId,
          status: c.estado || "DESCONOCIDO",
          submissionDeadline: c.fecha_entrega_ofertas || "",
          documents: currDocsList,
          lastModifiedDate: new Date().toISOString()
        }
      );

      for (const alert of alerts) {
        await logAudit(supabase, {
          action: "tender.monitoring_alert",
          detail: {
            licitacion_id: licId,
            event_type: alert.eventType,
            severity: alert.severity,
            title: alert.title,
            action_required: alert.actionRequired
          }
        });
      }
    } catch (diffErr) {
      console.error("[TenderMonitoring] Error comparing snapshots:", diffErr);
    }
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

  // 2. Verificar monto adjudicado real (FAIL CLOSED: presupuesto referencial != adjudicación)
  const adjudicatedAmount = Number(lic.monto_adjudicado);
  if (isNaN(adjudicatedAmount) || adjudicatedAmount <= 0) {
    return {
      error: "No se puede convertir a proyecto: la licitación no cuenta con monto adjudicado verificado (monto_adjudicado > 0). El presupuesto referencial no puede sustituir al valor de adjudicación contractual."
    };
  }

  // 3. Obtener ítems de la licitación (FAIL CLOSED: cero ítems sintéticos permitidos)
  const { data: items } = await supabase
    .from("licitacion_items")
    .select("*")
    .eq("licitacion_id", licitacionId)
    .order("sort_order");

  if (!items || items.length === 0) {
    return {
      error: "No se puede convertir a proyecto: la licitación no cuenta con ítems económicos detallados para transferir al presupuesto de obra."
    };
  }

  // Validar exhaustivamente cada ítem real
  const bidItems: Array<{
    itemNumber: number;
    description: string;
    quantity: number;
    unit: string;
    unitPricePyg: number;
  }> = [];

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const itemNumber = idx + 1;
    const desc = it.descripcion ? String(it.descripcion).trim() : "";
    const unit = it.unidad ? String(it.unidad).trim() : "";
    const qty = Number(it.cantidad);
    const unitPrice = Number(it.precio_unitario_estimado || (it.monto_total && it.cantidad ? it.monto_total / Number(it.cantidad) : 0));

    if (!desc) {
      return { error: `No se puede convertir a proyecto: el ítem #${itemNumber} no tiene descripción válida.` };
    }
    if (!unit) {
      return { error: `No se puede convertir a proyecto: el ítem #${itemNumber} ("${desc.slice(0, 30)}") no tiene unidad de medida verificable.` };
    }
    if (isNaN(qty) || qty <= 0) {
      return { error: `No se puede convertir a proyecto: el ítem #${itemNumber} ("${desc.slice(0, 30)}") tiene cantidad inválida (${it.cantidad}). Debe ser estrictamente mayor a cero.` };
    }
    if (isNaN(unitPrice) || unitPrice < 0) {
      return { error: `No se puede convertir a proyecto: el ítem #${itemNumber} ("${desc.slice(0, 30)}") tiene precio unitario inválido.` };
    }

    bidItems.push({
      itemNumber,
      description: desc,
      quantity: qty,
      unit,
      unitPricePyg: unitPrice
    });
  }

  const { executeTenderToProjectTransaction } = await import("@/lib/procurement/tender-to-project");

  // Invariante UNKNOWN != DEFAULT: No asumir plazos ni porcentajes arbitrarios (6 meses, 10%, 5%)
  // Si la licitación no los especifica formalmente en el pliego, quedan en null para configuración manual.
  const result = await executeTenderToProjectTransaction(supabase, {
    empresaId,
    tenderId: lic.id,
    dncpNro: lic.dncp_nro,
    projectTitle: lic.titulo,
    buyerName: lic.comitente_nombre || "Entidad Convocante",
    adjudicatedOfferPricePyg: adjudicatedAmount,
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

/**
 * Ejecuta y congela un análisis de decisión comercial (Gate 18: Bid Analysis Run) con hash SHA-256 inmutable
 */
export async function persistirEvaluacionComercial(
  licitacionId: string,
  options?: {
    annualFinancingRatePct?: number;
    proposedOfferAmountPyg?: number;
    estimatedIndirectCostPyg?: number;
    analysisMode?: 'PRE_BID' | 'POST_OPENING' | 'LIVE_SBE';
    expectedParticipantsCount?: number;
  }
): Promise<{ error?: string; snapshotId?: string; decision?: string; score?: number; hash?: string }> {
  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;
  const analysisMode = options?.analysisMode || 'PRE_BID';

  // 1. Obtener la licitación y empresa
  const [{ data: lic, error: licError }, { data: empresa }] = await Promise.all([
    supabase
      .from("licitaciones")
      .select("*")
      .eq("id", licitacionId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase
      .from("empresas")
      .select("*")
      .eq("id", empresaId)
      .maybeSingle()
  ]);

  if (licError || !lic) {
    return { error: "Licitación no encontrada o sin acceso." };
  }

  // 2. Cargar documentos de la bóveda para compliance
  const { fetchCompanyVaultItems } = await import("@/lib/procurement/bid-vault");
  const vaultItems = await fetchCompanyVaultItems(supabase, empresaId);

  // 3. Evaluar cumplimiento normativo y documental basado en la bóveda
  const { evaluateTenderCompliance, generateGenericRequirementSuggestions } = await import("@/lib/procurement/compliance-engine");
  const extractedPbc = lic.raw_json?.pbc_requisitos_extraidos;
  const isPbcAvailable = Array.isArray(extractedPbc?.requirements) && extractedPbc.requirements.length > 0;

  const tenderRequirements = isPbcAvailable
    ? extractedPbc.requirements
    : generateGenericRequirementSuggestions({
        id: lic.id,
        categoria: lic.categoria,
        procurement_method: lic.procurement_method,
        monto_referencial: lic.monto_referencial ? Number(lic.monto_referencial) : null
      });

  const evidenceOrigin = isPbcAvailable ? 'EXTRACTED_FROM_PBC' : 'GENERIC_REQUIREMENT_SUGGESTIONS';

  const complianceReport = evaluateTenderCompliance(
    lic.id,
    tenderRequirements,
    vaultItems,
    undefined,
    evidenceOrigin
  );

  // 4. Perfil institucional del convocante consultado desde base de datos real
  const { getInstitutionProfileFromDb } = await import("@/lib/procurement/institution-intelligence");
  const institutionProfile = await getInstitutionProfileFromDb(supabase, lic.comitente_nombre || "Convocante no especificado", empresaId);

  // 5. Análisis de costos reales basados estrictamente en Cost Engine y ofertas registradas
  // CANONICAL INVARIANT: Inventory CPP != Replacement Cost != Bid Cost != Actual Project Cost.
  const { data: rawItems } = await supabase
    .from("licitacion_items")
    .select("*")
    .eq("licitacion_id", lic.id)
    .order("sort_order");

  // Buscar oferta propia registrada y sus APUs/costos unitarios
  const { data: ourOffer } = await supabase
    .from("licitacion_ofertas")
    .select("id, monto_total, licitacion_oferta_items(licitacion_item_id, costo_unitario, precio_unitario)")
    .eq("licitacion_id", lic.id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  const explicitItemCosts = new Map<string, number>();
  if (ourOffer?.licitacion_oferta_items) {
    for (const oi of (ourOffer.licitacion_oferta_items as any[])) {
      if (oi.licitacion_item_id && oi.costo_unitario && Number(oi.costo_unitario) > 0) {
        explicitItemCosts.set(oi.licitacion_item_id, Number(oi.costo_unitario));
      }
    }
  }

  // Cargar observaciones transaccionales de costo del tenant para calcular costo de reposición
  // INVARIANTE CANÓNICO DE ESTADO DE EVIDENCIA:
  // Solo se deben consumir observaciones con estado_evidencia = 'VALIDA'.
  // 'REVISION_REQUERIDA', 'OBSOLETA' y 'DESCARTADA' jamás deben influir en el costo de oferta.
  const { data: costObs } = await supabase
    .from("cost_observations")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("estado_evidencia", "VALIDA")
    .order("fecha_observacion", { ascending: false });

  const { calculateCostEstimate } = await import("@/lib/cost-engine");

  let calculatedDirectCost = 0;
  let itemsWithCostCount = 0;
  const totalItemsCount = (rawItems ?? []).length;

  for (const it of rawItems ?? []) {
    const qty = Number(it.cantidad);
    const unit = it.unidad ? String(it.unidad).trim() : '';

    // INVARIANTE CANÓNICO (UNKNOWN != DEFAULT):
    // Si el ítem no tiene cantidad positiva o unidad de medida verificable,
    // no inventar defaults ficticios (1 o 'UN') y no otorgar cobertura económica falsa.
    if (isNaN(qty) || qty <= 0 || !unit) {
      continue;
    }

    // Prioridad 1: APU o costo unitario explícito en nuestra oferta
    if (explicitItemCosts.has(it.id)) {
      const explicitUnitCost = explicitItemCosts.get(it.id)!;
      calculatedDirectCost += explicitUnitCost * qty;
      itemsWithCostCount++;
      continue;
    }

    // Prioridad 2: Costo de reposición según observaciones transaccionales del Cost Engine (estrictamente estado_evidencia = 'VALIDA')
    const matchingObs = (costObs ?? []).filter((obs: any) =>
      obs.estado_evidencia === 'VALIDA' &&
      obs.descripcion_item && it.descripcion &&
      obs.descripcion_item.toLowerCase().trim() === it.descripcion.toLowerCase().trim()
    );

    if (matchingObs.length > 0) {
      const mappedObs = matchingObs.map((row: any) => ({
        id: row.id,
        empresaId: row.empresa_id,
        productoId: row.producto_id,
        projectId: row.project_id,
        proveedorId: row.proveedor_id,
        fuente: row.fuente,
        documentoId: row.documento_id,
        descripcionItem: row.descripcion_item,
        categoriaInsumo: row.categoria_insumo,
        cantidad: Number(row.cantidad),
        unidad: row.unidad,
        // INVARIANTE CANÓNICO DE MONEDA:
        // cost_observations.precio_unitario ya se persiste 100% normalizado a PYG.
        // tipo_cambio es solo metadato de trazabilidad y NO debe volverse a multiplicar.
        precioUnitario: Number(row.precio_unitario),
        moneda: row.moneda,
        tipoCambio: Number(row.tipo_cambio || 1.0),
        fechaObservacion: row.fecha_observacion,
        esVolatil: row.es_volatil
      }));

      const estimate = calculateCostEstimate(mappedObs);
      if (estimate.confidenceTier !== 'INSUFICIENTE' && estimate.recommendedUnitPrice > 0) {
        calculatedDirectCost += estimate.recommendedUnitPrice * qty;
        itemsWithCostCount++;
        continue;
      }
    }

    // Si no hay APU ni observaciones verificadas, NO usar costo_promedio de inventario como reemplazo silencioso
  }

  const refBudget = Number(lic.monto_referencial || 0);

  // INVARIANTE: UNKNOWN != DEFAULT
  // Plazo contractual: solo si está en OCDS raw_json contractPeriod.durationInDays
  let calculatedDurationMonths: number | null = null;
  const rawContractPeriodDays = lic.raw_json?.tender?.contractPeriod?.durationInDays;
  if (typeof rawContractPeriodDays === 'number' && rawContractPeriodDays > 0) {
    calculatedDurationMonths = Math.max(1, Math.round(rawContractPeriodDays / 30));
  }

  // Costos directos comprobados: si la cobertura no es total o es 0, queda en UNKNOWN / null (INSUFFICIENT_EVIDENCE)
  const hasValidBudget = refBudget > 0;
  const hasFullCostCoverage = totalItemsCount > 0 && itemsWithCostCount === totalItemsCount && calculatedDirectCost > 0;
  const estimatedDirectCostPyg = hasFullCostCoverage ? calculatedDirectCost : null;

  // Monto de oferta: NO derivar del presupuesto referencial. Si no hay propuesta, es null.
  const offerAmountPyg = options?.proposedOfferAmountPyg
    ?? (ourOffer?.monto_total ? Number(ourOffer.monto_total) : null);

  // Costos indirectos: solo si están configurados o estimados explícitamente, jamás porcentaje arbitrario
  const estimatedIndirectCostPyg = options?.estimatedIndirectCostPyg
    ?? ((empresa as any)?.porcentaje_costos_indirectos && estimatedDirectCostPyg
        ? Math.round((Number((empresa as any).porcentaje_costos_indirectos) / 100) * estimatedDirectCostPyg)
        : null);

  // 6. Análisis financiero de capital de trabajo (fail-closed si faltan variables)
  const { analyzeTenderFinancials } = await import("@/lib/procurement/financial-analysis");
  const explicitRate = options?.annualFinancingRatePct ?? (empresa as any)?.tasa_financiamiento_anual_pct ?? null;
  const financialReport = analyzeTenderFinancials({
    tenderId: lic.id,
    offerAmountPyg,
    estimatedDirectCostPyg,
    estimatedIndirectCostPyg,
    durationMonths: calculatedDurationMonths,
    institutionalPaymentDays: institutionProfile.diasPromedioPago > 0 ? institutionProfile.diasPromedioPago : null,
    annualFinancingRatePct: explicitRate !== null ? Number(explicitRate) : null
  });

  // 7. Simulación competitiva con oferentes observados o uncalibrated
  // REGLA TEMPORAL ESTRICTA:
  // En modo PRE_BID (antes de apertura de sobres), es IMPOSIBLE saber quiénes se presentaron a esta licitación.
  // Prohibido utilizar licitacion_oferentes de la licitación actual en PRE_BID (sería contaminación del futuro).
  // Solo en POST_OPENING o LIVE_SBE se permite leer los oferentes que efectivamente se presentaron a este llamado.
  const knownFingerprints: any[] = [];
  let simulatedCompetitorsCount: number | undefined = undefined;

  if (analysisMode === 'PRE_BID') {
    // En PRE_BID, solo se admite estimación explícita o análisis puramente histórico previo a la fecha de publicación
    simulatedCompetitorsCount = options?.expectedParticipantsCount;
  } else {
    // En POST_OPENING o LIVE_SBE, se leen los oferentes que abrieron sobre en esta licitación
    const { data: oferentes } = await supabase
      .from("licitacion_oferentes")
      .select("ruc, nombre, monto_ofertado")
      .eq("licitacion_id", lic.id);

    const realCompetitorsCount = (oferentes ?? []).length;
    simulatedCompetitorsCount = realCompetitorsCount > 0 ? realCompetitorsCount : undefined;

    if (oferentes && oferentes.length > 0) {
      const { getCompetitorProfile } = await import("@/lib/procurement/competitor-intelligence");
      for (const ofr of oferentes) {
        if (ofr.ruc) {
          try {
            const profile = await getCompetitorProfile(ofr.ruc, supabase, {
              convocante: lic.comitente_nombre,
              categoria: lic.categoria,
              montoReferencial: refBudget,
              asOfDate: lic.fecha_publicacion || lic.fecha_entrega_ofertas || null,
              excludeTenderId: lic.id
            });
            if (profile?.contextual_fingerprint && profile.contextual_fingerprint.sample_size >= 2) {
              knownFingerprints.push(profile.contextual_fingerprint);
            }
          } catch {
            // Si no se encuentra en procurement_suppliers, continuar
          }
        }
      }
    }
  }

  const { simulateCompetitiveBidding } = await import("@/lib/procurement/competitive-simulator");
  const simulationResult = simulateCompetitiveBidding({
    tenderId: lic.id,
    referenceBudgetPyg: hasValidBudget ? refBudget : 0,
    expectedParticipantsCount: simulatedCompetitorsCount,
    knownCompetitorFingerprints: knownFingerprints.length > 0 ? knownFingerprints : undefined,
    category: lic.categoria || undefined,
    analysisMode
  }, 1000);

  // 8. Evaluar decisión global
  const { evaluateBidOpportunity } = await import("@/lib/procurement/bid-engine");
  const decisionOutput = evaluateBidOpportunity({
    tenderId: lic.id,
    tenderTitle: lic.titulo,
    buyerName: lic.comitente_nombre || "Convocante no especificado",
    referenceBudgetPyg: refBudget,
    complianceReport,
    institutionProfile,
    financialReport,
    simulationResult
  });

  // Si no hubo cobertura completa de costos o pliego, asegurar que el dictamen no sea COMPETIR
  if (!hasFullCostCoverage && decisionOutput.decision === 'COMPETIR') {
    decisionOutput.decision = 'REVISAR';
    decisionOutput.blockers.push('Cobertura incompleta de costos: no todos los ítems del pliego cuentan con costeo verificado en el Cost Engine o APUs.');
  }

  // 9. Crear y persistir snapshot inmutable SHA-256
  const { createBidAnalysisSnapshot, persistBidAnalysisSnapshot } = await import("@/lib/procurement/bid-snapshot");
  const snapshot = createBidAnalysisSnapshot(empresaId, {
    tenderId: lic.id,
    tenderTitle: lic.titulo,
    buyerName: lic.comitente_nombre || "Convocante no especificado",
    referenceBudgetPyg: refBudget,
    complianceReport,
    institutionProfile,
    financialReport,
    simulationResult
  }, decisionOutput);

  const persistResult = await persistBidAnalysisSnapshot(supabase, snapshot);
  if (persistResult.error) {
    return { error: persistResult.error };
  }

  await logAudit(supabase, {
    action: "bid_engine.snapshot_created",
    detail: {
      licitacion_id: lic.id,
      snapshot_id: persistResult.id,
      decision: decisionOutput.decision,
      score: decisionOutput.overallScore,
      hash: snapshot.snapshotHash
    }
  });

  revalidatePath(`/licitaciones/${licitacionId}`);
  return {
    snapshotId: persistResult.id,
    decision: decisionOutput.decision,
    score: decisionOutput.overallScore,
    hash: snapshot.snapshotHash
  };
}

/**
 * Ensambla el paquete de borradores y oferta preliminar (Gate 14: Tender Operations)
 */
export async function generarPliegoOfertaCompleto(
  licitacionId: string
): Promise<{
  error?: string;
  packageStatus?: 'READY_TO_SIGN' | 'DRAFT_INCOMPLETE';
  formsCount?: number;
  attachedDocsCount?: number;
  totalAmountPyg?: number;
  validationErrors?: string[];
  masterIndex?: string;
  exportDocumentHtml?: string;
}> {
  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;

  // 1. Obtener la licitación y empresa
  const [{ data: lic }, { data: empresa }] = await Promise.all([
    supabase
      .from("licitaciones")
      .select("*")
      .eq("id", licitacionId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase
      .from("empresas")
      .select("*")
      .eq("id", empresaId)
      .maybeSingle()
  ]);

  if (!lic) {
    return { error: "Licitación no encontrada." };
  }

  // 2. Obtener los ítems de la licitación
  const { data: rawItems } = await supabase
    .from("licitacion_items")
    .select("*")
    .eq("licitacion_id", lic.id)
    .order("sort_order");

  // Buscar oferta propia registrada y sus precios unitarios cotizados
  const { data: ourOffer } = await supabase
    .from("licitacion_ofertas")
    .select("id, monto_total, margen_estimado_pct, licitacion_oferta_items(licitacion_item_id, precio_unitario, costo_unitario)")
    .eq("licitacion_id", lic.id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  const offerItemPrices = new Map<string, number>();
  if (ourOffer?.licitacion_oferta_items) {
    for (const oi of (ourOffer.licitacion_oferta_items as any[])) {
      if (oi.licitacion_item_id && oi.precio_unitario && Number(oi.precio_unitario) > 0) {
        offerItemPrices.set(oi.licitacion_item_id, Number(oi.precio_unitario));
      } else if (oi.licitacion_item_id && oi.costo_unitario && Number(oi.costo_unitario) > 0 && ourOffer.margen_estimado_pct) {
        const cost = Number(oi.costo_unitario);
        const margin = Number(ourOffer.margen_estimado_pct);
        const derivedPrice = Math.round(cost * (1 + margin / 100));
        offerItemPrices.set(oi.licitacion_item_id, derivedPrice);
      }
    }
  }

  // CANONICAL INVARIANT: precio_unitario_referencial is NOT our bid price!
  // Bid price must come from explicit offer item pricing or verified cost plus margin.
  // If an item has no offer price, mark it pending / unpriced (0).
  const bidItems = (rawItems ?? []).map((it: any, idx: number) => {
    const unitPrice = offerItemPrices.get(it.id) ?? 0;

    return {
      itemNumber: idx + 1,
      description: it.descripcion,
      unit: it.unidad ? String(it.unidad).trim() : "",
      quantity: it.cantidad != null ? Number(it.cantidad) : 0,
      unitPricePyg: unitPrice
    };
  });

  // 3. Documentos probatorios de la bóveda y evaluación de pliego
  const { fetchCompanyVaultItems } = await import("@/lib/procurement/bid-vault");
  const vaultItems = await fetchCompanyVaultItems(supabase, empresaId);

  // Obtener matriz de cumplimiento de pliego extraída si existe
  const { evaluateTenderCompliance } = await import("@/lib/procurement/compliance-engine");
  let complianceReport: any = null;
  const extractedPbc = lic.raw_json?.pbc_requisitos_extraidos;
  if (extractedPbc?.requirements && Array.isArray(extractedPbc.requirements) && extractedPbc.requirements.length > 0) {
    complianceReport = evaluateTenderCompliance(
      lic.id,
      extractedPbc.requirements,
      vaultItems,
      undefined,
      'EXTRACTED_FROM_PBC'
    );
  }

  // Extraer validez de la oferta desde el PBC si fue extraído, o dejar null (pliego default)
  let extractedValidityDays: number | null = null;
  const pbcRawText = lic.raw_json?.pbc_texto_crudo || '';
  const matchValidity = pbcRawText.match(/mantenimiento\s+de\s+(?:la\s+)?oferta[^\d]{1,50}(\d{2,3})\s*d[ií]as/i)
    || pbcRawText.match(/validez\s+de\s+(?:la\s+)?oferta[^\d]{1,50}(\d{2,3})\s*d[ií]as/i);
  if (matchValidity) {
    extractedValidityDays = parseInt(matchValidity[1], 10);
  }

  // 4. Ensamblaje de oferta con el orquestador de operaciones (rechaza placeholders y requiere PBC resuelto)
  const { assembleTenderPackage, generateMasterIndex, exportBidPackageAsDocument } = await import("@/lib/procurement/tender-operations");
  const bidPackage = assembleTenderPackage({
    tenderId: lic.dncp_nro,
    tenderTitle: lic.titulo,
    buyerName: lic.comitente_nombre || "Convocante no especificado",
    bidderName: empresa?.nombre || "",
    bidderRuc: empresa?.ruc || "",
    legalRepresentative: profile.full_name || "",
    items: bidItems,
    vaultItems,
    validityDays: extractedValidityDays,
    complianceReport
  });

  const masterIndex = generateMasterIndex(bidPackage);
  const exportDocumentHtml = exportBidPackageAsDocument(bidPackage);

  const updatedRawJson = {
    ...(typeof lic.raw_json === 'object' && lic.raw_json ? lic.raw_json : {}),
    ultimo_paquete_oferta: {
      packageStatus: bidPackage.packageStatus,
      totalOfferAmountPyg: bidPackage.totalOfferAmountPyg,
      formsCount: bidPackage.preparedForms.length,
      attachedDocsCount: bidPackage.attachedEvidenceDocs.length,
      validationErrors: bidPackage.validationErrors,
      generatedAt: bidPackage.generatedAt,
      masterIndex,
      exportDocumentHtml
    }
  };

  await supabase
    .from("licitaciones")
    .update({
      raw_json: updatedRawJson,
      updated_at: new Date().toISOString()
    })
    .eq("id", lic.id);

  await logAudit(supabase, {
    action: "tender.bid_package_assembled",
    detail: {
      licitacion_id: lic.id,
      package_status: bidPackage.packageStatus,
      total_amount_pyg: bidPackage.totalOfferAmountPyg,
      forms_count: bidPackage.preparedForms.length,
      attached_docs_count: bidPackage.attachedEvidenceDocs.length,
      errors: bidPackage.validationErrors
    }
  });

  revalidatePath(`/licitaciones/${licitacionId}`);

  return {
    packageStatus: bidPackage.packageStatus,
    formsCount: bidPackage.preparedForms.length,
    attachedDocsCount: bidPackage.attachedEvidenceDocs.length,
    totalAmountPyg: bidPackage.totalOfferAmountPyg,
    validationErrors: bidPackage.validationErrors,
    masterIndex,
    exportDocumentHtml
  };
}

/**
 * Extrae requisitos técnicos y legales determinísticos del texto del Pliego de Bases y Condiciones (PBC) (Gate 11)
 */
export async function extraerRequisitosDePliego(
  licitacionId: string,
  textoPbc: string
): Promise<{ error?: string; totalRequisitos?: number; secciones?: string[]; elegible?: boolean; score?: number }> {
  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;

  const { data: lic, error: licError } = await supabase
    .from("licitaciones")
    .select("*")
    .eq("id", licitacionId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (licError || !lic) {
    return { error: "Licitación no encontrada o sin acceso." };
  }

  const { extractRequirementsFromPbcText } = await import("@/lib/procurement/pbc-extractor");
  const extraction = extractRequirementsFromPbcText(
    textoPbc,
    lic.monto_referencial ? Number(lic.monto_referencial) : null
  );

  if (extraction.requirements.length === 0) {
    return { error: "No se pudieron extraer requisitos normativos o técnicos del texto provisto." };
  }

  const { fetchCompanyVaultItems } = await import("@/lib/procurement/bid-vault");
  const vaultItems = await fetchCompanyVaultItems(supabase, empresaId);

  const { evaluateTenderCompliance } = await import("@/lib/procurement/compliance-engine");
  const complianceReport = evaluateTenderCompliance(
    lic.id,
    extraction.requirements,
    vaultItems,
    undefined,
    'EXTRACTED_FROM_PBC'
  );

  const updatedRawJson = {
    ...(typeof lic.raw_json === 'object' && lic.raw_json ? lic.raw_json : {}),
    pbc_requisitos_extraidos: extraction,
    ultimo_reporte_compliance: complianceReport
  };

  await supabase
    .from("licitaciones")
    .update({
      raw_json: updatedRawJson,
      updated_at: new Date().toISOString()
    })
    .eq("id", lic.id);

  await logAudit(supabase, {
    action: "tender.pbc_extracted",
    detail: {
      licitacion_id: lic.id,
      requisitos_count: extraction.requirements.length,
      secciones: extraction.detectedSections,
      elegible: complianceReport.isEligibleToBid,
      score: complianceReport.scoreCumplimientoPct
    }
  });

  revalidatePath(`/licitaciones/${licitacionId}`);
  revalidatePath(`/licitaciones/${licitacionId}/evaluacion`);

  return {
    totalRequisitos: extraction.requirements.length,
    secciones: extraction.detectedSections,
    elegible: complianceReport.isEligibleToBid,
    score: complianceReport.scoreCumplimientoPct
  };
}

/**
 * Extrae y registra ofertas de competidores a partir del texto de un Acta de Apertura o Cuadro Comparativo (Gate 4)
 */
export async function extraerOfertasDeActa(
  licitacionId: string,
  textoActa: string,
  fuente: 'ACTA_PDF' | 'CUADRO_PDF' | 'MANUAL' = 'ACTA_PDF'
): Promise<{ error?: string; ofertasExtraidas?: number; ganadores?: number; revisionRequerida?: number }> {
  const { supabase, profile } = await ctx();
  const empresaId = profile.empresa_id;

  const { data: lic, error: licError } = await supabase
    .from("licitaciones")
    .select("*")
    .eq("id", licitacionId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (licError || !lic) {
    return { error: "Licitación no encontrada o sin acceso." };
  }

  const { extraerOfertasDeTexto } = await import("@/lib/procurement/offer-extractor");
  const extractedBids = extraerOfertasDeTexto(
    textoActa,
    lic.monto_referencial ? Number(lic.monto_referencial) : null
  );

  if (extractedBids.length === 0) {
    return { error: "No se pudieron identificar ofertas económicas en el texto provisto." };
  }

  let ganadoresCount = 0;
  let revisionCount = 0;

  for (const bid of extractedBids) {
    if (bid.estado_oferta === 'GANADORA') ganadoresCount++;
    if (bid.requiere_revision_humana) revisionCount++;

    const rucFormateado = bid.oferente_normalizado.ruc_clean
      ? `${bid.oferente_normalizado.ruc_clean}-${bid.oferente_normalizado.dv || '0'}`
      : null;

    // Upsert por (licitacion_id, ruc) si RUC existe, o insertar si no
    if (rucFormateado) {
      await supabase
        .from("licitacion_oferentes")
        .upsert({
          licitacion_id: lic.id,
          empresa_id: empresaId,
          ruc: rucFormateado,
          nombre: bid.oferente_normalizado.nombre_canonico || bid.oferente_raw,
          monto_ofertado: bid.monto_ofertado,
          gano: bid.estado_oferta === 'GANADORA',
          fuente: fuente
        }, { onConflict: 'licitacion_id, ruc' });
    } else {
      await supabase
        .from("licitacion_oferentes")
        .insert({
          licitacion_id: lic.id,
          empresa_id: empresaId,
          ruc: null,
          nombre: bid.oferente_normalizado.nombre_canonico || bid.oferente_raw,
          monto_ofertado: bid.monto_ofertado,
          gano: bid.estado_oferta === 'GANADORA',
          fuente: fuente
        });
    }
  }

  await logAudit(supabase, {
    action: "tender.bids_extracted_from_acta",
    detail: {
      licitacion_id: lic.id,
      fuente,
      total_ofertas: extractedBids.length,
      ganadores: ganadoresCount,
      requiere_revision: revisionCount
    }
  });

  revalidatePath(`/licitaciones/${licitacionId}`);

  return {
    ofertasExtraidas: extractedBids.length,
    ganadores: ganadoresCount,
    revisionRequerida: revisionCount
  };
}



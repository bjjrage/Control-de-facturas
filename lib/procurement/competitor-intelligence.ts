/**
 * GATE 5A: COMPETITOR INTELLIGENCE V1 (HUELLA COMPETITIVA CONTEXTUAL)
 * 
 * Motor de análisis de competidores:
 * - Segmentación multidimensional: Empresa × Convocante × Rubro × Tamaño.
 * - Cálculo de agresividad de precios (descuento respecto a precio referencial).
 * - Tasa de adjudicación (win rate) por contexto.
 * - Grado de certeza estadística (ALTA >= 15, MEDIA 5-14, BAJA 2-4, INSUFICIENTE < 2).
 * - Fallback jerárquico determinístico para celdas con pocas observaciones.
 * - Mapeo de red de consorcios y aliados habituales.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { normalizarTexto, limpiarRuc, coincideConvocante } from "./entity-normalizer";

export type CertaintyTier = "ALTA" | "MEDIA" | "BAJA" | "INSUFICIENTE";
export type SizeBracket = "SMALL" | "MEDIUM" | "LARGE" | "DESCONOCIDO";

export interface ContextualQuery {
  convocante?: string | null;
  categoria?: string | null;
  montoReferencial?: number | null;
  asOfDate?: string | null;
  excludeTenderId?: string | null;
}

export interface ContextualFingerprint {
  level: "EXACT_CONTEXT" | "FALLBACK_CATEGORY" | "FALLBACK_BUYER" | "FALLBACK_GLOBAL" | "INSUFFICIENT_DATA";
  win_rate_pct: number;
  avg_discount_pct: number;
  stddev_discount_pct: number | null;
  sample_size: number;
  certainty_tier: CertaintyTier;
  fallback_applied: boolean;
  notes: string;
}

export interface CompetitorBidSummary {
  process_id: string;
  dncp_nro: string;
  title: string;
  buyer: string;
  categoria: string;
  date: string | null;
  monto_ofertado: number | null;
  monto_adjudicado?: number | null;
  monto_referencial: number | null;
  discount_pct: number | null;
  gano: boolean;
  estado_oferta: string;
}

export interface CompetitorProfile {
  supplier_id: string;
  nombre: string;
  nombre_canonico: string;
  ruc_clean: string;
  dv: string | null;
  tipo_entidad: string;
  tamano: string | null;
  total_bids: number;
  total_wins: number;
  win_rate_pct: number;
  total_awarded_amount: number;
  global_avg_discount_pct: number;
  certainty_tier: CertaintyTier;
  top_convocantes: Array<{
    name: string;
    bids_count: number;
    wins_count: number;
    amount_won: number;
    win_rate_pct: number;
  }>;
  consortium_network: Array<{
    partner_name: string;
    shared_tenders_count: number;
  }>;
  recent_bids: CompetitorBidSummary[];
  contextual_fingerprint?: ContextualFingerprint;
}

export function categorizarTamanoContrato(monto: number | null | undefined): SizeBracket {
  if (!monto || monto <= 0) return "DESCONOCIDO";
  if (monto < 2_000_000_000) return "SMALL"; // < 2.000M PYG (~$270k USD)
  if (monto <= 15_000_000_000) return "MEDIUM"; // 2.000M - 15.000M PYG (~$2M USD)
  return "LARGE"; // > 15.000M PYG
}

export function calcularCertezaEstadistica(sampleSize: number): CertaintyTier {
  if (sampleSize >= 15) return "ALTA";
  if (sampleSize >= 5) return "MEDIA";
  if (sampleSize >= 2) return "BAJA";
  return "INSUFICIENTE";
}

/**
 * Cálculo matemático puro de huella contextual con fallback jerárquico e integridad temporal.
 */
export function calcularHuellaContextual(
  bids: CompetitorBidSummary[],
  context: ContextualQuery
): ContextualFingerprint {
  let eligibleBids = bids;

  // Filtrado temporal estricto (asOfDate / cutoffDate): solo ofertas anteriores a la fecha de corte
  if (context.asOfDate) {
    const cutoffMs = new Date(context.asOfDate).getTime();
    eligibleBids = eligibleBids.filter(b => {
      if (!b.date) return false;
      const bDateMs = new Date(b.date).getTime();
      return !isNaN(bDateMs) && bDateMs < cutoffMs;
    });
  }

  // Filtrado de integridad: no utilizar la licitación actual en evaluación para predecir sobre sí misma
  if (context.excludeTenderId) {
    eligibleBids = eligibleBids.filter(b => b.process_id !== context.excludeTenderId && b.dncp_nro !== context.excludeTenderId);
  }

  const targetBracket = context.montoReferencial ? categorizarTamanoContrato(context.montoReferencial) : null;
  const targetBuyerNorm = context.convocante ? normalizarTexto(context.convocante) : null;
  const targetCatNorm = context.categoria ? normalizarTexto(context.categoria) : null;

  // 1. Filtrar por coincidencia exacta (Convocante + Rubro + Tamaño)
  const exactMatches = eligibleBids.filter((b) => {
    let match = true;
    if (context.convocante && !coincideConvocante(context.convocante, b.buyer)) match = false;
    if (targetCatNorm && !normalizarTexto(b.categoria).includes(targetCatNorm)) match = false;
    if (targetBracket && categorizarTamanoContrato(b.monto_referencial) !== targetBracket) match = false;
    return match;
  });

  if (exactMatches.length >= 5) {
    return resumirMetricas(exactMatches, "EXACT_CONTEXT", false, "Huella calculada con coincidencia exacta de contexto");
  }

  // 2. Fallback: Rubro + Tamaño
  if (targetCatNorm) {
    const catMatches = eligibleBids.filter((b) => normalizarTexto(b.categoria).includes(targetCatNorm));
    if (catMatches.length >= 3) {
      return resumirMetricas(catMatches, "FALLBACK_CATEGORY", true, `Fallback a rubro general: "${context.categoria}"`);
    }
  }

  // 3. Fallback: Convocante General
  if (context.convocante) {
    const buyerMatches = eligibleBids.filter((b) => coincideConvocante(context.convocante, b.buyer));
    if (buyerMatches.length >= 2) {
      return resumirMetricas(buyerMatches, "FALLBACK_BUYER", true, `Fallback a historial con el convocante: "${context.convocante}"`);
    }
  }

  // 4. Fallback Global de la Empresa
  if (eligibleBids.length > 0) {
    return resumirMetricas(eligibleBids, "FALLBACK_GLOBAL", true, "Fallback al comportamiento global histórico de la empresa");
  }

  return {
    level: "INSUFFICIENT_DATA",
    win_rate_pct: 0,
    avg_discount_pct: 0,
    stddev_discount_pct: null,
    sample_size: 0,
    certainty_tier: "INSUFICIENTE",
    fallback_applied: true,
    notes: "No se registran ofertas históricas suficientes para calcular la huella",
  };
}

function resumirMetricas(
  bidsSlice: CompetitorBidSummary[],
  level: ContextualFingerprint["level"],
  fallback_applied: boolean,
  notes: string
): ContextualFingerprint {
  const total = bidsSlice.length;
  const wins = bidsSlice.filter((b) => b.gano).length;
  const win_rate_pct = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;

  const validDiscounts = bidsSlice
    .map((b) => b.discount_pct)
    .filter((d): d is number => d !== null && !isNaN(d));

  let avg_discount_pct = 0;
  let stddev_discount_pct: number | null = null;

  if (validDiscounts.length > 0) {
    const sum = validDiscounts.reduce((acc, v) => acc + v, 0);
    avg_discount_pct = parseFloat((sum / validDiscounts.length).toFixed(2));

    if (validDiscounts.length > 1) {
      const variance = validDiscounts.reduce((acc, v) => acc + Math.pow(v - avg_discount_pct, 2), 0) / validDiscounts.length;
      stddev_discount_pct = parseFloat(Math.sqrt(variance).toFixed(2));
    }
  }

  return {
    level,
    win_rate_pct,
    avg_discount_pct,
    stddev_discount_pct,
    sample_size: total,
    certainty_tier: calcularCertezaEstadistica(total),
    fallback_applied,
    notes,
  };
}

/**
 * Consulta y ensambla el perfil analítico 360° de un competidor
 * Busca en procurement_suppliers (histórico nacional) y en licitacion_oferentes (ERP local)
 */
export async function getCompetitorProfile(
  rucOrId: string,
  supabase: SupabaseClient,
  context?: ContextualQuery
): Promise<CompetitorProfile | null> {
  const { ruc_clean, dv: extractedDv } = limpiarRuc(rucOrId);

  // 1. Obtener datos del proveedor (procurement_suppliers o fallback licitacion_oferentes)
  let query = supabase.from("procurement_suppliers").select("*");
  if (ruc_clean) {
    query = query.eq("ruc_clean", ruc_clean);
  } else {
    query = query.eq("id", rucOrId);
  }

  const { data: supplier, error: suppErr } = await query.maybeSingle();
  let supplierData: any = supplier;

  if (!supplierData && ruc_clean) {
    // Fallback: buscar en oferentes locales de licitaciones del ERP
    const { data: oferentes } = await supabase
      .from("licitacion_oferentes")
      .select("id, nombre, ruc, tamano")
      .ilike("ruc", `%${ruc_clean}%`)
      .limit(1);

    if (oferentes && oferentes.length > 0) {
      const o = oferentes[0];
      const { ruc_clean: rc, dv } = limpiarRuc(o.ruc || rucOrId);
      supplierData = {
        id: o.id,
        nombre: o.nombre,
        nombre_normalizado: normalizarTexto(o.nombre),
        ruc_clean: rc || ruc_clean,
        dv: dv || extractedDv || null,
        tipo_entidad: "EMPRESA",
        tamano: o.tamano || null,
      };
    }
  }

  if (!supplierData) return null;

  // 2. Obtener ofertas históricas de procurement_bids (si existe en base nacional)
  let bidsRaw: any[] = [];
  if (supplier) {
    const { data: nationalBids } = await supabase
      .from("procurement_bids")
      .select(`
        process_id,
        monto_ofertado,
        gano,
        estado_oferta,
        procurement_processes (
          dncp_nro,
          titulo,
          comitente_nombre,
          categoria,
          fecha_publicacion,
          monto_referencial
        )
      `)
      .eq("supplier_id", supplier.id);
    if (nationalBids) bidsRaw = nationalBids;
  }

  const bids: CompetitorBidSummary[] = (bidsRaw || []).map((b: any) => {
    const p = b.procurement_processes || {};
    const montoRef = p.monto_referencial ? Number(p.monto_referencial) : null;
    const montoOf = b.monto_ofertado ? Number(b.monto_ofertado) : null;
    let discount: number | null = null;
    if (montoRef && montoOf && montoRef > 0) {
      discount = parseFloat((((montoRef - montoOf) / montoRef) * 100).toFixed(2));
    }

    return {
      process_id: b.process_id,
      dncp_nro: p.dncp_nro || "",
      title: p.titulo || "(sin título)",
      buyer: p.comitente_nombre || "Desconocido",
      categoria: p.categoria || "DESCONOCIDO",
      date: p.fecha_publicacion,
      monto_ofertado: montoOf,
      monto_referencial: montoRef,
      discount_pct: discount,
      gano: b.gano || b.estado_oferta === "GANADORA",
      estado_oferta: b.estado_oferta || "ADMITIDA",
    };
  });

  // 2b. Combinar con ofertas registradas localmente en el ERP (licitacion_oferentes)
  if (supplierData.ruc_clean) {
    const { data: localBidsRaw } = await supabase
      .from("licitacion_oferentes")
      .select(`
        id,
        licitacion_id,
        monto_ofertado,
        gano,
        fuente,
        licitaciones (
          dncp_nro,
          titulo,
          comitente_nombre,
          categoria,
          fecha_publicacion,
          monto_referencial
        )
      `)
      .ilike("ruc", `%${supplierData.ruc_clean}%`);

    if (localBidsRaw && localBidsRaw.length > 0) {
      for (const lb of localBidsRaw) {
        const p = (lb as any).licitaciones || {};
        // Evitar duplicados por DNCP nro
        if (p.dncp_nro && bids.some((b) => b.dncp_nro === p.dncp_nro)) continue;

        const montoRef = p.monto_referencial ? Number(p.monto_referencial) : null;
        const montoOf = lb.monto_ofertado ? Number(lb.monto_ofertado) : null;
        let discount: number | null = null;
        if (montoRef && montoOf && montoRef > 0) {
          discount = parseFloat((((montoRef - montoOf) / montoRef) * 100).toFixed(2));
        }

        bids.push({
          process_id: lb.licitacion_id,
          dncp_nro: p.dncp_nro || "",
          title: p.titulo || "(sin título)",
          buyer: p.comitente_nombre || "Desconocido",
          categoria: p.categoria || "DESCONOCIDO",
          date: p.fecha_publicacion,
          monto_ofertado: montoOf,
          monto_referencial: montoRef,
          discount_pct: discount,
          gano: !!lb.gano,
          estado_oferta: lb.gano ? "GANADORA" : (lb.fuente || "ADMITIDA"),
        });
      }
    }
  }

  // 2c. Consultar montos adjudicados oficiales en procurement_awards
  const processAwardMap = new Map<string, number>();
  if (supplierData.id) {
    try {
      // 1. Direct awards by supplier_id
      const { data: directAwards } = await supabase
        .from("procurement_awards")
        .select("process_id, monto_adjudicado")
        .eq("supplier_id", supplierData.id);

      if (directAwards) {
        for (const a of directAwards) {
          if (a.process_id && a.monto_adjudicado) {
            processAwardMap.set(a.process_id, Number(a.monto_adjudicado));
          }
        }
      }

      // 2. Consortium / joint awards via procurement_award_suppliers
      const { data: jointAwards } = await supabase
        .from("procurement_award_suppliers")
        .select("award_id, procurement_awards(process_id, monto_adjudicado)")
        .eq("supplier_id", supplierData.id);

      if (jointAwards) {
        for (const ja of jointAwards) {
          const pa = (ja as any).procurement_awards;
          if (pa && pa.process_id && pa.monto_adjudicado && !processAwardMap.has(pa.process_id)) {
            processAwardMap.set(pa.process_id, Number(pa.monto_adjudicado));
          }
        }
      }
    } catch {
      // Continuar con montos disponibles
    }
  }

  // Enriquecer ofertas con monto_adjudicado oficial
  for (const b of bids) {
    const aw = processAwardMap.get(b.process_id);
    if (aw) {
      b.monto_adjudicado = aw;
      if (b.gano && !b.monto_ofertado) {
        // En licitaciones donde la oferta ganadora es el valor adjudicado,
        // usar el monto adjudicado como monto de la oferta
        b.monto_ofertado = aw;
        if (b.monto_referencial && b.monto_referencial > 0) {
          b.discount_pct = parseFloat((((b.monto_referencial - aw) / b.monto_referencial) * 100).toFixed(2));
        }
      }
    }
  }

  // 2d. Filtrado temporal estricto (asOfDate / cutoffDate) e integridad de la licitación en evaluación
  let eligibleBids = bids;
  if (context?.asOfDate) {
    const cutoffMs = new Date(context.asOfDate).getTime();
    eligibleBids = eligibleBids.filter(b => {
      if (!b.date) return false;
      const bDateMs = new Date(b.date).getTime();
      return !isNaN(bDateMs) && bDateMs < cutoffMs;
    });
  }
  if (context?.excludeTenderId) {
    eligibleBids = eligibleBids.filter(b => b.process_id !== context.excludeTenderId && b.dncp_nro !== context.excludeTenderId);
  }

  // 3. Métricas acumuladas sobre ofertas elegibles
  const totalBids = eligibleBids.length;
  const totalWins = eligibleBids.filter((b) => b.gano).length;
  const winRate = totalBids > 0 ? parseFloat(((totalWins / totalBids) * 100).toFixed(1)) : 0;
  const totalAwarded = eligibleBids
    .filter((b) => b.gano)
    .reduce((acc, b) => acc + (b.monto_adjudicado ?? b.monto_ofertado ?? 0), 0);

  const globalFingerprint = resumirMetricas(eligibleBids, "FALLBACK_GLOBAL", false, "");

  // 4. Top Convocantes
  const buyerMap = new Map<string, { bids: number; wins: number; amount: number }>();
  for (const b of eligibleBids) {
    const curr = buyerMap.get(b.buyer) || { bids: 0, wins: 0, amount: 0 };
    curr.bids++;
    if (b.gano) {
      curr.wins++;
      curr.amount += b.monto_adjudicado ?? b.monto_ofertado ?? 0;
    }
    buyerMap.set(b.buyer, curr);
  }

  const topConvocantes = Array.from(buyerMap.entries())
    .map(([name, stats]) => ({
      name,
      bids_count: stats.bids,
      wins_count: stats.wins,
      amount_won: stats.amount,
      win_rate_pct: parseFloat(((stats.wins / stats.bids) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.amount_won - a.amount_won);

  // 5. Red de Consorcios (Búsqueda de socios)
  const { data: consortiaRows } = await supabase
    .from("procurement_consortium_members")
    .select("consortium_id, member_name_raw, procurement_consortia(supplier_id)")
    .neq("member_supplier_id", supplier.id);

  const partnerMap = new Map<string, number>();
  if (consortiaRows) {
    for (const r of consortiaRows) {
      partnerMap.set(r.member_name_raw, (partnerMap.get(r.member_name_raw) || 0) + 1);
    }
  }

  const consortiumNetwork = Array.from(partnerMap.entries())
    .map(([partner_name, count]) => ({ partner_name, shared_tenders_count: count }))
    .sort((a, b) => b.shared_tenders_count - a.shared_tenders_count);

  // 6. Huella Contextual (si se pidió contexto específico)
  const contextual_fingerprint = context ? calcularHuellaContextual(eligibleBids, context) : undefined;

  return {
    supplier_id: supplierData.id,
    nombre: supplierData.nombre,
    nombre_canonico: supplierData.nombre_normalizado || supplierData.nombre,
    ruc_clean: supplierData.ruc_clean,
    dv: supplierData.dv,
    tipo_entidad: supplierData.tipo_entidad || "EMPRESA",
    tamano: supplierData.tamano,
    total_bids: totalBids,
    total_wins: totalWins,
    win_rate_pct: winRate,
    total_awarded_amount: totalAwarded,
    global_avg_discount_pct: globalFingerprint.avg_discount_pct,
    certainty_tier: globalFingerprint.certainty_tier,
    top_convocantes: topConvocantes,
    consortium_network: consortiumNetwork,
    recent_bids: eligibleBids.slice(0, 15),
    contextual_fingerprint,
  };
}

export interface CompetitorListEntry {
  supplier_id: string;
  nombre: string;
  ruc_clean: string;
  dv: string | null;
  tipo_entidad: string;
  tamano: string | null;
  total_bids: number;
  total_wins: number;
  win_rate_pct: number;
  total_awarded_amount: number;
  global_avg_discount_pct: number;
  certainty_tier: CertaintyTier;
  is_excluded?: boolean;
  exclusion_reason?: string | null;
  excluded_at?: string | null;
}

export type RadarPeriodMonths = 12 | 24 | 36 | 60 | 0;
export type RadarEvidenceFilter = "CON_EVIDENCIA" | "ACTIVOS" | "TODOS";
export type RadarCertaintyFilter = "TODAS" | CertaintyTier;
export type RadarOutcomeFilter = "TODOS" | "CON_ADJUDICACIONES" | "SIN_ADJUDICACIONES";

export interface RadarFilterParams {
  periodMonths?: RadarPeriodMonths;
  evidence?: RadarEvidenceFilter;
  minBids?: number;
  certainty?: RadarCertaintyFilter;
  outcome?: RadarOutcomeFilter;
  includeExcluded?: boolean;
  search?: string;
  limit?: number;
  page?: number;
}

export interface RadarPageResult {
  competitors: CompetitorListEntry[];
  totalFiltered: number;
  totalHistorical: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Consulta del Radar de Competidores optimizada y semánticamente correcta.
 * Soporta filtros de período, evidencia mínima, certeza, resultado, búsqueda
 * y exclusiones privadas por empresa_id (tenant-isolated).
 */
export async function listCompetitorsRadar(
  supabase: SupabaseClient,
  empresaId: string,
  params: RadarFilterParams = {}
): Promise<RadarPageResult> {
  const periodMonths = params.periodMonths ?? 24;
  const evidence = params.evidence ?? "CON_EVIDENCIA";
  const minBids = params.minBids ?? 1;
  const certainty = params.certainty ?? "TODAS";
  const outcome = params.outcome ?? "TODOS";
  const includeExcluded = params.includeExcluded ?? false;
  const search = params.search?.trim() || "";
  const limit = Math.max(1, Math.min(100, params.limit ?? 50));
  const page = Math.max(1, params.page ?? 1);
  const offset = (page - 1) * limit;

  // 1. Intentar ejecutar RPC optimizada si está disponible en la base
  try {
    const { data: rpcRes, error: rpcErr } = await supabase.rpc("get_competitor_radar_page", {
      p_empresa_id: empresaId,
      p_months: periodMonths,
      p_min_bids: minBids,
      p_evidence: evidence,
      p_certainty: certainty,
      p_outcome: outcome,
      p_include_excluded: includeExcluded,
      p_search: search || null,
      p_limit: limit,
      p_offset: offset,
    });

    if (!rpcErr && rpcRes && typeof rpcRes.total_historical === "number") {
      const totalFiltered = Number(rpcRes.total_filtered || 0);
      const competitors: CompetitorListEntry[] = (rpcRes.competitors || []).map((r: any) => ({
        supplier_id: r.supplier_id,
        nombre: r.nombre,
        ruc_clean: r.ruc_clean,
        dv: r.dv,
        tipo_entidad: r.tipo_entidad || "EMPRESA",
        tamano: r.tamano,
        total_bids: Number(r.total_bids || 0),
        total_wins: Number(r.total_wins || 0),
        win_rate_pct: Number(r.win_rate_pct || 0),
        total_awarded_amount: Number(r.total_awarded_amount || 0),
        global_avg_discount_pct: Number(r.avg_discount_pct || 0),
        certainty_tier: r.certainty_tier || "INSUFICIENTE",
        is_excluded: Boolean(r.is_excluded),
        exclusion_reason: r.exclusion_reason || null,
        excluded_at: r.excluded_at || null,
      }));

      return {
        competitors,
        totalFiltered,
        totalHistorical: Number(rpcRes.total_historical || 0),
        page,
        limit,
        totalPages: Math.ceil(totalFiltered / limit) || 1,
      };
    }
  } catch {
    // Si la RPC aún no está cargada en el schema cache de Supabase, fallback a consulta directa
  }

  // 2. Fallback de alta fidelidad vía PostgREST con exclusiones de tenant
  // 2.1 Obtener exclusiones privadas del tenant
  const exclusionsMap = new Map<string, { reason: string | null; created_at: string }>();
  try {
    const { data: exclRows } = await supabase
      .from("empresa_competitor_exclusions")
      .select("supplier_id, reason, created_at")
      .eq("empresa_id", empresaId);

    if (exclRows) {
      for (const ex of exclRows) {
        exclusionsMap.set(ex.supplier_id, { reason: ex.reason, created_at: ex.created_at });
      }
    }
  } catch {
    // Si la tabla no existe en la base remota, continuamos con 0 exclusiones
  }

  // 2.2 Calcular total histórico de proveedores
  let totalHistorical = 6445;
  try {
    const { count } = await supabase
      .from("procurement_suppliers")
      .select("id", { count: "exact", head: true });
    if (typeof count === "number") totalHistorical = count;
  } catch {
    // Mantener fallback 6445
  }

  // 2.3 Consultar v_procurement_competitor_global con filtros
  let query = supabase.from("v_procurement_competitor_global").select("*");

  if (search) {
    query = query.or(`nombre.ilike.%${search}%,ruc_clean.ilike.%${search}%`);
  }

  // Filtro de ofertas mínimas a nivel de base de datos
  if (minBids > 0) {
    query = query.gte("total_bids", minBids);
  }

  // Filtro de certeza a nivel de base de datos
  if (certainty !== "TODAS") {
    query = query.eq("certainty_tier", certainty);
  }

  // Filtro de resultado a nivel de base de datos
  if (outcome === "CON_ADJUDICACIONES") {
    query = query.gt("total_wins", 0);
  } else if (outcome === "SIN_ADJUDICACIONES") {
    query = query.eq("total_wins", 0);
  }

  // Si hay filtro de período (ej. 24 meses), aplicar filtro por last_seen_at
  if (periodMonths > 0) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - periodMonths);
    query = query.gte("last_seen_at", cutoff.toISOString());
  }

  // Ordenar por volumen competitivo
  query = query.order("total_bids", { ascending: false }).order("total_awarded_amount", { ascending: false });

  const { data: rawRows, error } = await query;
  if (error || !rawRows) {
    return {
      competitors: [],
      totalFiltered: 0,
      totalHistorical,
      page,
      limit,
      totalPages: 1,
    };
  }

  // 2.4 Aplicar exclusiones y filtros de evidencia
  let filtered = rawRows.filter((r: any) => {
    const isExcluded = exclusionsMap.has(r.supplier_id);
    if (!includeExcluded && isExcluded) return false;

    if (evidence === "CON_EVIDENCIA" && Number(r.total_bids || 0) === 0) return false;
    if (evidence === "ACTIVOS" && Number(r.total_bids || 0) === 0) return false;

    return true;
  });

  const totalFiltered = filtered.length;
  const pagedRows = filtered.slice(offset, offset + limit);

  // 2.5 Consultar montos adjudicados reales en procurement_awards para la página visible si en la vista es 0
  const supplierIdsToFetchAwards = pagedRows
    .filter((r: any) => Number(r.total_wins || 0) > 0 && Number(r.total_awarded_amount || 0) === 0)
    .map((r: any) => r.supplier_id);

  const awardsMap = new Map<string, number>();
  if (supplierIdsToFetchAwards.length > 0) {
    try {
      let awardQuery = supabase
        .from("procurement_awards")
        .select("supplier_id, monto_adjudicado, fecha_adjudicacion")
        .in("supplier_id", supplierIdsToFetchAwards);

      if (periodMonths > 0) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - periodMonths);
        awardQuery = awardQuery.gte("fecha_adjudicacion", cutoff.toISOString());
      }

      const { data: awards } = await awardQuery;
      if (awards) {
        for (const a of awards) {
          if (a.supplier_id && a.monto_adjudicado) {
            awardsMap.set(a.supplier_id, (awardsMap.get(a.supplier_id) || 0) + Number(a.monto_adjudicado));
          }
        }
      }
    } catch {
      // Continuar con valores de vista
    }
  }

  const competitors: CompetitorListEntry[] = pagedRows.map((r: any) => {
    const excl = exclusionsMap.get(r.supplier_id);
    const awardedFromAwards = awardsMap.get(r.supplier_id);
    const finalAwarded = (awardedFromAwards && awardedFromAwards > 0)
      ? awardedFromAwards
      : Number(r.total_awarded_amount || 0);

    return {
      supplier_id: r.supplier_id,
      nombre: r.nombre,
      ruc_clean: r.ruc_clean,
      dv: r.dv,
      tipo_entidad: r.tipo_entidad || "EMPRESA",
      tamano: r.tamano,
      total_bids: Number(r.total_bids || 0),
      total_wins: Number(r.total_wins || 0),
      win_rate_pct: Number(r.global_win_rate_pct || 0),
      total_awarded_amount: finalAwarded,
      global_avg_discount_pct: Number(r.global_avg_discount_pct || 0),
      certainty_tier: r.certainty_tier || "INSUFICIENTE",
      is_excluded: Boolean(excl),
      exclusion_reason: excl?.reason || null,
      excluded_at: excl?.created_at || null,
    };
  });

  return {
    competitors,
    totalFiltered,
    totalHistorical,
    page,
    limit,
    totalPages: Math.ceil(totalFiltered / limit) || 1,
  };
}

/**
 * Lista competidores con métricas agregadas combinando base histórica (v_procurement_competitor_global)
 * y oferentes locales del ERP (licitacion_oferentes).
 */
export async function listCompetitors(
  supabase: SupabaseClient,
  options?: { limit?: number; search?: string }
): Promise<CompetitorListEntry[]> {
  const limit = options?.limit ?? 50;
  const search = options?.search?.trim();

  // 1. Intentar leer desde v_procurement_competitor_global
  let query = supabase
    .from("v_procurement_competitor_global")
    .select("*")
    .order("total_awarded_amount", { ascending: false })
    .limit(limit);

  if (search) {
    query = query.or(`nombre.ilike.%${search}%,ruc_clean.ilike.%${search}%`);
  }

  const { data: rows, error } = await query;
  if (!error && rows && rows.length > 0) {
    return rows.map((r: any) => ({
      supplier_id: r.supplier_id,
      nombre: r.nombre,
      ruc_clean: r.ruc_clean,
      dv: r.dv,
      tipo_entidad: r.tipo_entidad || "EMPRESA",
      tamano: r.tamano,
      total_bids: Number(r.total_bids || 0),
      total_wins: Number(r.total_wins || 0),
      win_rate_pct: Number(r.global_win_rate_pct || 0),
      total_awarded_amount: Number(r.total_awarded_amount || 0),
      global_avg_discount_pct: Number(r.global_avg_discount_pct || 0),
      certainty_tier: r.certainty_tier || "INSUFICIENTE",
    }));
  }

  // 2. Si la vista no tiene registros o no está disponible, consultar licitacion_oferentes agrupados
  let ofQuery = supabase
    .from("licitacion_oferentes")
    .select("id, ruc, nombre, tamano, monto_ofertado, gano");

  if (search) {
    ofQuery = ofQuery.or(`nombre.ilike.%${search}%,ruc.ilike.%${search}%`);
  }

  const { data: ofRows } = await ofQuery;
  if (!ofRows || ofRows.length === 0) return [];

  const map = new Map<string, CompetitorListEntry>();
  for (const o of ofRows) {
    const { ruc_clean, dv } = limpiarRuc(o.ruc || o.nombre);
    const key = ruc_clean || o.nombre;
    const existing = map.get(key) || {
      supplier_id: o.id,
      nombre: o.nombre,
      ruc_clean: ruc_clean || "",
      dv: dv || null,
      tipo_entidad: "EMPRESA",
      tamano: o.tamano || null,
      total_bids: 0,
      total_wins: 0,
      win_rate_pct: 0,
      total_awarded_amount: 0,
      global_avg_discount_pct: 0,
      certainty_tier: "INSUFICIENTE" as CertaintyTier,
    };

    existing.total_bids++;
    if (o.gano) {
      existing.total_wins++;
      existing.total_awarded_amount += Number(o.monto_ofertado || 0);
    }
    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((c) => ({
      ...c,
      win_rate_pct: c.total_bids > 0 ? parseFloat(((c.total_wins / c.total_bids) * 100).toFixed(1)) : 0,
      certainty_tier: calcularCertezaEstadistica(c.total_bids),
    }))
    .sort((a, b) => b.total_bids - a.total_bids)
    .slice(0, limit);
}



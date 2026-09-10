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
 * Cálculo matemático puro de huella contextual con fallback jerárquico.
 */
export function calcularHuellaContextual(
  bids: CompetitorBidSummary[],
  context: ContextualQuery
): ContextualFingerprint {
  const targetBracket = context.montoReferencial ? categorizarTamanoContrato(context.montoReferencial) : null;
  const targetBuyerNorm = context.convocante ? normalizarTexto(context.convocante) : null;
  const targetCatNorm = context.categoria ? normalizarTexto(context.categoria) : null;

  // 1. Filtrar por coincidencia exacta (Convocante + Rubro + Tamaño)
  const exactMatches = bids.filter((b) => {
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
    const catMatches = bids.filter((b) => normalizarTexto(b.categoria).includes(targetCatNorm));
    if (catMatches.length >= 3) {
      return resumirMetricas(catMatches, "FALLBACK_CATEGORY", true, `Fallback a rubro general: "${context.categoria}"`);
    }
  }

  // 3. Fallback: Convocante General
  if (context.convocante) {
    const buyerMatches = bids.filter((b) => coincideConvocante(context.convocante, b.buyer));
    if (buyerMatches.length >= 2) {
      return resumirMetricas(buyerMatches, "FALLBACK_BUYER", true, `Fallback a historial con el convocante: "${context.convocante}"`);
    }
  }

  // 4. Fallback Global de la Empresa
  if (bids.length > 0) {
    return resumirMetricas(bids, "FALLBACK_GLOBAL", true, "Fallback al comportamiento global histórico de la empresa");
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
 */
export async function getCompetitorProfile(
  rucOrId: string,
  supabase: SupabaseClient,
  context?: ContextualQuery
): Promise<CompetitorProfile | null> {
  const { ruc_clean } = limpiarRuc(rucOrId);

  // 1. Obtener datos del proveedor
  let query = supabase.from("procurement_suppliers").select("*");
  if (ruc_clean) {
    query = query.eq("ruc_clean", ruc_clean);
  } else {
    query = query.eq("id", rucOrId);
  }

  const { data: supplier, error: suppErr } = await query.maybeSingle();
  if (suppErr || !supplier) return null;

  // 2. Obtener ofertas históricas
  const { data: bidsRaw, error: bidsErr } = await supabase
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
      categoria: p.categoria || "OBRAS",
      date: p.fecha_publicacion,
      monto_ofertado: montoOf,
      monto_referencial: montoRef,
      discount_pct: discount,
      gano: b.gano || b.estado_oferta === "GANADORA",
      estado_oferta: b.estado_oferta || "ADMITIDA",
    };
  });

  // 3. Métricas acumuladas
  const totalBids = bids.length;
  const totalWins = bids.filter((b) => b.gano).length;
  const winRate = totalBids > 0 ? parseFloat(((totalWins / totalBids) * 100).toFixed(1)) : 0;
  const totalAwarded = bids
    .filter((b) => b.gano && b.monto_ofertado)
    .reduce((acc, b) => acc + (b.monto_ofertado ?? 0), 0);

  const globalFingerprint = resumirMetricas(bids, "FALLBACK_GLOBAL", false, "");

  // 4. Top Convocantes
  const buyerMap = new Map<string, { bids: number; wins: number; amount: number }>();
  for (const b of bids) {
    const curr = buyerMap.get(b.buyer) || { bids: 0, wins: 0, amount: 0 };
    curr.bids++;
    if (b.gano) {
      curr.wins++;
      curr.amount += b.monto_ofertado ?? 0;
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
  const contextual_fingerprint = context ? calcularHuellaContextual(bids, context) : undefined;

  return {
    supplier_id: supplier.id,
    nombre: supplier.nombre,
    nombre_canonico: supplier.nombre_normalizado || supplier.nombre,
    ruc_clean: supplier.ruc_clean,
    dv: supplier.dv,
    tipo_entidad: supplier.tipo_entidad || "EMPRESA",
    tamano: supplier.tamano,
    total_bids: totalBids,
    total_wins: totalWins,
    win_rate_pct: winRate,
    total_awarded_amount: totalAwarded,
    global_avg_discount_pct: globalFingerprint.avg_discount_pct,
    certainty_tier: globalFingerprint.certainty_tier,
    top_convocantes: topConvocantes,
    consortium_network: consortiumNetwork,
    recent_bids: bids.slice(0, 15),
    contextual_fingerprint,
  };
}

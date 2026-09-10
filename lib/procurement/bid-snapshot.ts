/**
 * BID SNAPSHOT MODULE (GATE 18)
 * Congelamiento inmutable de corridas de análisis y verificación criptográfica (SHA-256).
 */

import { createHash } from 'node:crypto';
import { BidEngineInput, BidDecisionOutput } from './bid-engine';

export interface BidAnalysisRunRecord {
  id?: string;
  empresaId: string;
  tenderId: string;
  tituloLicitacion: string;
  convocante: string;
  decision: BidDecisionOutput['decision'];
  overallScore: number;
  montoReferencialPyg: number;
  precioOfertaRecomendadoPyg: number;
  margenNetoEstimadoPct: number;
  probabilidadGanarPct: number;
  complianceSnapshot: any;
  institutionSnapshot: any;
  financialSnapshot: any;
  simulationSnapshot: any;
  pillarsSnapshot: any;
  justifications: string[];
  blockers: string[];
  snapshotHash: string;
  createdAt: string;
}

/**
 * Genera el hash criptográfico SHA-256 inmutable de un análisis
 */
export function generateSnapshotHash(payload: {
  tenderId: string;
  decision: string;
  overallScore: number;
  recommendedPrice: number;
  createdAt: string;
}): string {
  const content = `${payload.tenderId}|${payload.decision}|${payload.overallScore}|${payload.recommendedPrice}|${payload.createdAt}`;
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Crea el registro congelado inmutable de la corrida de análisis
 */
export function createBidAnalysisSnapshot(
  empresaId: string,
  input: BidEngineInput,
  output: BidDecisionOutput,
  timestamp: string = new Date().toISOString()
): BidAnalysisRunRecord {
  const snapshotHash = generateSnapshotHash({
    tenderId: input.tenderId,
    decision: output.decision,
    overallScore: output.overallScore,
    recommendedPrice: output.recommendedOfferPricePyg,
    createdAt: timestamp
  });

  return {
    empresaId,
    tenderId: input.tenderId,
    tituloLicitacion: input.tenderTitle,
    convocante: input.buyerName,
    decision: output.decision,
    overallScore: output.overallScore,
    montoReferencialPyg: input.referenceBudgetPyg,
    precioOfertaRecomendadoPyg: output.recommendedOfferPricePyg,
    margenNetoEstimadoPct: output.expectedNetMarginPct,
    probabilidadGanarPct: output.winProbabilityPct,
    complianceSnapshot: input.complianceReport,
    institutionSnapshot: input.institutionProfile,
    financialSnapshot: input.financialReport,
    simulationSnapshot: input.simulationResult,
    pillarsSnapshot: output.pillars,
    justifications: output.keyJustifications,
    blockers: output.blockers,
    snapshotHash,
    createdAt: timestamp
  };
}

/**
 * Verifica la integridad del snapshot congelado contra adulteraciones
 */
export function verifySnapshotIntegrity(record: BidAnalysisRunRecord): boolean {
  const calculated = generateSnapshotHash({
    tenderId: record.tenderId,
    decision: record.decision,
    overallScore: record.overallScore,
    recommendedPrice: record.precioOfertaRecomendadoPyg,
    createdAt: record.createdAt
  });

  return calculated === record.snapshotHash;
}

/**
 * Persiste un snapshot inmutable en la tabla bid_analysis_runs de Supabase
 */
export async function persistBidAnalysisSnapshot(
  supabase: any,
  record: BidAnalysisRunRecord
): Promise<{ id?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('bid_analysis_runs')
      .insert({
        empresa_id: record.empresaId,
        tender_id: record.tenderId,
        titulo_licitacion: record.tituloLicitacion,
        convocante: record.convocante,
        decision: record.decision,
        overall_score: record.overallScore,
        monto_referencial_pyg: record.montoReferencialPyg,
        precio_oferta_recomendado_pyg: record.precioOfertaRecomendadoPyg,
        margen_neto_estimado_pct: record.margenNetoEstimadoPct,
        probabilidad_ganar_pct: record.probabilidadGanarPct,
        compliance_snapshot: record.complianceSnapshot ?? {},
        institution_snapshot: record.institutionSnapshot ?? {},
        financial_snapshot: record.financialSnapshot ?? {},
        simulation_snapshot: record.simulationSnapshot ?? {},
        pillars_snapshot: record.pillarsSnapshot ?? [],
        justifications: record.justifications ?? [],
        blockers: record.blockers ?? [],
        snapshot_hash: record.snapshotHash,
        created_at: record.createdAt
      })
      .select('id')
      .single();

    if (error) {
      console.error('[BidSnapshot] Error persisting snapshot to database:', error);
      return { error: error.message };
    }

    return { id: data.id };
  } catch (err: any) {
    console.error('[BidSnapshot] Unexpected error persisting snapshot:', err);
    return { error: err.message || String(err) };
  }
}

/**
 * Recupera el historial inmutable de snapshots de una licitación para auditoría
 */
export async function getTenderAnalysisSnapshots(
  supabase: any,
  empresaId: string,
  tenderId: string
): Promise<{ runs: BidAnalysisRunRecord[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('bid_analysis_runs')
      .select('*')
      .eq('empresa_id', empresaId)
      .eq('tender_id', tenderId)
      .order('created_at', { ascending: false });

    if (error) {
      return { runs: [], error: error.message };
    }

    const runs: BidAnalysisRunRecord[] = (data ?? []).map((r: any) => ({
      id: r.id,
      empresaId: r.empresa_id,
      tenderId: r.tender_id,
      tituloLicitacion: r.titulo_licitacion,
      convocante: r.convocante,
      decision: r.decision,
      overallScore: Number(r.overall_score),
      montoReferencialPyg: Number(r.monto_referencial_pyg),
      precioOfertaRecomendadoPyg: Number(r.precio_oferta_recomendado_pyg),
      margenNetoEstimadoPct: Number(r.margen_neto_estimado_pct),
      probabilidadGanarPct: Number(r.probabilidad_ganar_pct),
      complianceSnapshot: r.compliance_snapshot,
      institutionSnapshot: r.institution_snapshot,
      financialSnapshot: r.financial_snapshot,
      simulationSnapshot: r.simulation_snapshot,
      pillarsSnapshot: r.pillars_snapshot,
      justifications: r.justifications,
      blockers: r.blockers,
      snapshotHash: r.snapshot_hash,
      createdAt: r.created_at
    }));

    return { runs };
  } catch (err: any) {
    return { runs: [], error: err.message || String(err) };
  }
}

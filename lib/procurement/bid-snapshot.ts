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

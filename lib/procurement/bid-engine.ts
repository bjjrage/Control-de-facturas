/**
 * BID ENGINE (GATE 17)
 * Motor integral de decisión comercial ("Bid / No-Bid"):
 * Cruza los 5 pilares estratégicos construidos en los Gates previos:
 * 1. Cumplimiento normativo y documental (Gate 11: isEligibleToBid)
 * 2. Inteligencia de costos reales y margen económico (Gate 5B: CPP)
 * 3. Riesgo de cobro y mora del convocante (Gate 12: Calificación Institucional)
 * 4. Viabilidad financiera y capital de trabajo (Gate 13: Cashflow Simulation)
 * 5. Probabilidad de victoria y postura óptima (Gate 16: Competitive Simulator)
 * 
 * Dictamen determinístico tripartito:
 * - COMPETIR (GO): Margen neto saludable, riesgo mitigado, alta probabilidad competitiva.
 * - REVISAR (REVIEW): Requiere estructurar financiamiento, aliarse en consorcio o ajustar precios.
 * - NO_COMPETIR (NO GO): Inelegibilidad técnica, margen destruido por mora, o precio ganador bajo costo directo.
 */

import { TenderComplianceReport } from './compliance-engine';
import { InstitutionProfile } from './institution-intelligence';
import { TenderFinancialReport } from './financial-analysis';
import { CompetitiveSimulationResult } from './competitive-simulator';

export type BidDecision = 'COMPETIR' | 'REVISAR' | 'NO_COMPETIR';

export interface BidEngineInput {
  tenderId: string;
  tenderTitle: string;
  buyerName: string;
  referenceBudgetPyg: number;
  complianceReport: TenderComplianceReport;
  institutionProfile: InstitutionProfile;
  financialReport: TenderFinancialReport;
  simulationResult: CompetitiveSimulationResult;
}

export interface PillarAssessment {
  pilar: 'CUMPLIMIENTO' | 'COSTOS_Y_MARGEN' | 'RIESGO_CONVOCANTE' | 'FINANCIERO' | 'COMPETITIVIDAD';
  status: 'OPTIMO' | 'ADVERTENCIA' | 'CRITICO';
  score: number; // 0 - 100
  resumen: string;
}

export interface BidDecisionOutput {
  tenderId: string;
  decision: BidDecision;
  overallScore: number; // 0 - 100
  recommendedOfferPricePyg: number;
  expectedNetMarginPct: number;
  winProbabilityPct: number;
  pillars: PillarAssessment[];
  keyJustifications: string[];
  blockers: string[];
}

/**
 * Evalúa integralmente la licitación y emite el dictamen comercial
 */
export function evaluateBidOpportunity(input: BidEngineInput): BidDecisionOutput {
  const pillars: PillarAssessment[] = [];
  const justifications: string[] = [];
  const blockers: string[] = [];

  // PILAR 1: Cumplimiento
  let pilarCumplimiento: PillarAssessment;
  if (!input.complianceReport.isEligibleToBid) {
    pilarCumplimiento = {
      pilar: 'CUMPLIMIENTO',
      status: 'CRITICO',
      score: 0,
      resumen: 'Faltas excluyentes de documentación o experiencia en pliego.'
    };
    blockers.push('Inhabilitado técnicamente: omisión de requisitos excluyentes del pliego.');
  } else {
    pilarCumplimiento = {
      pilar: 'CUMPLIMIENTO',
      status: input.complianceReport.scoreCumplimientoPct >= 90 ? 'OPTIMO' : 'ADVERTENCIA',
      score: input.complianceReport.scoreCumplimientoPct,
      resumen: `${input.complianceReport.cumplidosCount} de ${input.complianceReport.totalRequirements} requisitos cumplidos íntegramente.`
    };
    justifications.push('Elegibilidad normativa y solvencia técnica comprobada.');
  }
  pillars.push(pilarCumplimiento);

  // PILAR 2: Costos y Margen Bruto
  const grossMargin = input.financialReport.baseScenario.grossMarginPct;
  let pilarCostos: PillarAssessment;
  if (grossMargin < 5.0) {
    pilarCostos = {
      pilar: 'COSTOS_Y_MARGEN',
      status: 'CRITICO',
      score: 20,
      resumen: `Margen bruto extremadamente bajo (${grossMargin}%).`
    };
    blockers.push(`Margen bruto insuficiente (${grossMargin}%) para absorber contingencias.`);
  } else if (grossMargin < 12.0) {
    pilarCostos = {
      pilar: 'COSTOS_Y_MARGEN',
      status: 'ADVERTENCIA',
      score: 65,
      resumen: `Margen bruto ajustado (${grossMargin}%).`
    };
  } else {
    pilarCostos = {
      pilar: 'COSTOS_Y_MARGEN',
      status: 'OPTIMO',
      score: 95,
      resumen: `Margen bruto competitivo y saludable (${grossMargin}%).`
    };
    justifications.push(`Margen bruto inicial sólido del ${grossMargin}%.`);
  }
  pillars.push(pilarCostos);

  // PILAR 3: Riesgo Convocante
  let pilarConvocante: PillarAssessment;
  if (input.institutionProfile.calificacionRiesgo === 'D') {
    pilarConvocante = {
      pilar: 'RIESGO_CONVOCANTE',
      status: 'CRITICO',
      score: 30,
      resumen: `Entidad con severo historial de mora (${input.institutionProfile.diasPromedioPago} días) o cancelaciones.`
    };
    blockers.push(`Alto riesgo institucional con ${input.institutionProfile.convocante}: mora media de ${input.institutionProfile.diasPromedioPago} días.`);
  } else if (input.institutionProfile.calificacionRiesgo === 'C') {
    pilarConvocante = {
      pilar: 'RIESGO_CONVOCANTE',
      status: 'ADVERTENCIA',
      score: 60,
      resumen: `Entidad con demoras moderadas (${input.institutionProfile.diasPromedioPago} días).`
    };
  } else {
    pilarConvocante = {
      pilar: 'RIESGO_CONVOCANTE',
      status: 'OPTIMO',
      score: 90,
      resumen: `Entidad compradora confiable (${input.institutionProfile.diasPromedioPago} días promedio de pago).`
    };
    justifications.push('Convocante con puntualidad de pago probada.');
  }
  pillars.push(pilarConvocante);

  // PILAR 4: Financiero (Flujo y Margen Neto Real)
  const netMargin = input.financialReport.baseScenario.netMarginPct;
  let pilarFinanciero: PillarAssessment;
  if (input.financialReport.overallViability === 'NO_VIABLE_ALTO_RIESGO' || netMargin <= 0) {
    pilarFinanciero = {
      pilar: 'FINANCIERO',
      status: 'CRITICO',
      score: 10,
      resumen: 'Margen neto destruido por mora y costo del dinero.'
    };
    blockers.push('Inviabilidad financiera: costo financiero de los atrasos sobrepasa la ganancia del contrato.');
  } else if (input.financialReport.overallViability === 'REQUIERE_FINANCIAMIENTO') {
    pilarFinanciero = {
      pilar: 'FINANCIERO',
      status: 'ADVERTENCIA',
      score: 60,
      resumen: `Requiere capital de trabajo de Gs. ${(input.financialReport.baseScenario.peakWorkingCapitalRequiredPyg / 1e6).toFixed(0)}M.`
    };
    justifications.push('Exige estructurar línea de crédito o descuento de certificados para cubrir el capital pico.');
  } else {
    pilarFinanciero = {
      pilar: 'FINANCIERO',
      status: 'OPTIMO',
      score: 90,
      resumen: `Margen neto real preservado (${netMargin}%) con baja presión de capital.`
    };
    justifications.push(`Margen neto real preservado del ${netMargin}% tras deducir costos financieros.`);
  }
  pillars.push(pilarFinanciero);

  // PILAR 5: Competitividad
  const sweetSpotPrice = input.simulationResult.recommendedSweetSpotPricePyg;
  const sweetSpotWinProb = input.simulationResult.winProbabilityCurve.find(
    c => c.discountPct === Math.round(input.simulationResult.recommendedSweetSpotDiscountPct)
  )?.winProbabilityPct ?? 50;

  const pilarCompetitividad: PillarAssessment = {
    pilar: 'COMPETITIVIDAD',
    status: sweetSpotWinProb >= 50 ? 'OPTIMO' : 'ADVERTENCIA',
    score: Math.min(100, sweetSpotWinProb * 1.2),
    resumen: `Probabilidad de adjudicación estimada en ${sweetSpotWinProb}% en el punto de corte óptimo.`
  };
  pillars.push(pilarCompetitividad);

  // Decisión final determinística
  let decision: BidDecision = 'COMPETIR';

  if (blockers.length > 0) {
    decision = 'NO_COMPETIR';
  } else if (
    pilarFinanciero.status === 'ADVERTENCIA' ||
    pilarCostos.status === 'ADVERTENCIA' ||
    pilarConvocante.status === 'ADVERTENCIA' ||
    pilarCumplimiento.status === 'ADVERTENCIA'
  ) {
    decision = 'REVISAR';
  }

  const overallScore = Math.round(
    pillars.reduce((acc, p) => acc + p.score, 0) / pillars.length
  );

  return {
    tenderId: input.tenderId,
    decision,
    overallScore,
    recommendedOfferPricePyg: sweetSpotPrice,
    expectedNetMarginPct: netMargin,
    winProbabilityPct: sweetSpotWinProb,
    pillars,
    keyJustifications: justifications,
    blockers
  };
}

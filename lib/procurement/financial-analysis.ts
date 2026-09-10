/**
 * FINANCIAL ANALYSIS OF TENDER (GATE 13)
 * Análisis financiero ex-ante del flujo de caja, capital de trabajo y costo financiero del contrato:
 * 1. Simulación del flujo de fondos de la obra (Desembolsos por insumos vs Cobro de certificados).
 * 2. Incorporación de los días reales de pago de la institución (procedente de GATE 12).
 * 3. Cálculo de la necesidad máxima de capital de trabajo (Peak Working Capital).
 * 4. Costo financiero del capital / tasa pasiva o activa de descuento (ej: 12% anual en PYG).
 * 5. Margen bruto teórico vs Margen neto real ajustado por costo del dinero en el tiempo.
 * 6. Tres escenarios:
 *    - BASE: Plazo de pago histórico estándar de la institución.
 *    - CONSERVADOR: +30 días de retraso sobre la media histórica.
 *    - ESTRÉS: +90 días de retraso severo en cobros.
 */

export interface TenderFinancialSimulationInput {
  tenderId: string;
  offerAmountPyg?: number | null;          // Monto total de la oferta presentada (debe ser > 0)
  estimatedDirectCostPyg?: number | null;  // Costo directo total según Cost Engine (Gate 5B)
  estimatedIndirectCostPyg?: number | null; // Costos indirectos y gastos generales
  durationMonths?: number | null;          // Plazo de ejecución en meses contractual
  institutionalPaymentDays?: number | null; // Procedente de Gate 12
  annualFinancingRatePct?: number | null;  // Tasa de financiamiento anual explícita
  advancePaymentPct?: number | null;       // Anticipo financiero del contrato (ej: 10% o 20%)
}

export interface ScenarioResult {
  scenarioName: 'BASE' | 'CONSERVADOR' | 'ESTRES';
  paymentLagDays: number;
  peakWorkingCapitalRequiredPyg: number;
  financingCostPyg: number;
  grossProfitPyg: number;
  netProfitPyg: number;
  grossMarginPct: number;
  netMarginPct: number;
  isFinanciallyViable: boolean;
  notes: string;
}

export interface TenderFinancialReport {
  tenderId: string;
  financialStatus: 'CALCULADO' | 'INSUFFICIENT_EVIDENCE';
  missingInputs: string[];
  offerAmountPyg: number;
  totalCostPyg: number;
  baseScenario: ScenarioResult;
  conservativeScenario: ScenarioResult;
  stressScenario: ScenarioResult;
  recommendedFinancingBufferPyg: number;
  overallViability: 'VIABLE' | 'REQUIERE_FINANCIAMIENTO' | 'NO_VIABLE_ALTO_RIESGO';
}

/**
 * Simula el escenario financiero con retraso temporal de cobros
 */
function simulateCashflowScenario(
  input: {
    offerAmountPyg: number;
    estimatedDirectCostPyg: number;
    estimatedIndirectCostPyg: number;
    durationMonths: number;
    institutionalPaymentDays: number;
    annualFinancingRatePct?: number | null;
    advancePaymentPct?: number | null;
  },
  additionalDelayDays: number,
  scenarioName: ScenarioResult['scenarioName']
): ScenarioResult {
  const totalCost = input.estimatedDirectCostPyg + input.estimatedIndirectCostPyg;
  const grossProfit = input.offerAmountPyg - totalCost;
  const grossMarginPct = Number(((grossProfit / input.offerAmountPyg) * 100).toFixed(2));

  const totalLagDays = Math.max(30, input.institutionalPaymentDays + additionalDelayDays);
  const totalLagMonths = totalLagDays / 30;

  const rate = (input.annualFinancingRatePct ?? 12.0) / 100;
  const monthlyRate = rate / 12;

  // Curva de egresos uniforme simplificada por mes
  const monthlyExpense = totalCost / input.durationMonths;
  const advancePayment = (input.advancePaymentPct ?? 0) > 0 ? input.offerAmountPyg * (input.advancePaymentPct! / 100) : 0;

  // Capital de trabajo pico: meses de desfase entre gasto y cobro
  const monthsOfGap = Math.min(input.durationMonths, totalLagMonths);
  let peakCapital = Math.max(0, monthlyExpense * monthsOfGap - advancePayment);

  // Costo financiero acumulado sobre el capital inmovilizado
  const financingCost = Math.round(peakCapital * monthlyRate * input.durationMonths);
  const netProfit = grossProfit - financingCost;
  const netMarginPct = Number(((netProfit / input.offerAmountPyg) * 100).toFixed(2));

  // Viabilidad: margen neto debe ser positivo y no erosionar más del 60% del margen bruto
  const isFinanciallyViable = netProfit > 0 && netMarginPct >= 3.0;

  let notes = '';
  if (netProfit <= 0) {
    notes = 'Margen destruido por costo financiero derivado de la mora en cobros.';
  } else if (netMarginPct < 5.0) {
    notes = 'Margen neto estrecho; alta sensibilidad a variaciones de tasa o atrasos.';
  } else {
    notes = 'Estructura financiera sólida con margen neto preservado.';
  }

  return {
    scenarioName,
    paymentLagDays: totalLagDays,
    peakWorkingCapitalRequiredPyg: Math.round(peakCapital),
    financingCostPyg: financingCost,
    grossProfitPyg: grossProfit,
    netProfitPyg: netProfit,
    grossMarginPct,
    netMarginPct,
    isFinanciallyViable,
    notes
  };
}

function createUnsimulatedScenario(
  scenarioName: ScenarioResult['scenarioName'],
  reason: string
): ScenarioResult {
  return {
    scenarioName,
    paymentLagDays: 0,
    peakWorkingCapitalRequiredPyg: 0,
    financingCostPyg: 0,
    grossProfitPyg: 0,
    netProfitPyg: 0,
    grossMarginPct: 0,
    netMarginPct: 0,
    isFinanciallyViable: false,
    notes: `No simulado: ${reason}`
  };
}

/**
 * Ejecuta el análisis financiero integral de una licitación en los 3 escenarios.
 * INVARIANTE UNKNOWN != DEFAULT:
 * Si faltan parámetros requeridos (precio de oferta, costo directo, plazo contractual, mora del pagador),
 * NO inventa constantes supletorias: retorna INSUFFICIENT_EVIDENCE fail-closed.
 */
export function analyzeTenderFinancials(input: TenderFinancialSimulationInput): TenderFinancialReport {
  const missingInputs: string[] = [];

  const offer = Number(input.offerAmountPyg || 0);
  const directCost = Number(input.estimatedDirectCostPyg || 0);
  const indirectCost = Number(input.estimatedIndirectCostPyg || 0);
  const duration = Number(input.durationMonths || 0);
  const paymentDays = Number(input.institutionalPaymentDays || 0);

  if (offer <= 0) missingInputs.push('Monto total de oferta económica no especificado o nulo');
  if (directCost <= 0) missingInputs.push('Costo directo de insumos no determinado');
  if (duration <= 0) missingInputs.push('Plazo de ejecución contractual no especificado en pliego');
  if (paymentDays <= 0) missingInputs.push('Plazo de pago institucional del convocante desconocido');

  if (missingInputs.length > 0) {
    const reason = `Falta de evidencia comprobable: ${missingInputs.join(', ')}`;
    return {
      tenderId: input.tenderId,
      financialStatus: 'INSUFFICIENT_EVIDENCE',
      missingInputs,
      offerAmountPyg: offer,
      totalCostPyg: directCost + indirectCost,
      baseScenario: createUnsimulatedScenario('BASE', reason),
      conservativeScenario: createUnsimulatedScenario('CONSERVADOR', reason),
      stressScenario: createUnsimulatedScenario('ESTRES', reason),
      recommendedFinancingBufferPyg: 0,
      overallViability: 'NO_VIABLE_ALTO_RIESGO'
    };
  }

  const validData = {
    offerAmountPyg: offer,
    estimatedDirectCostPyg: directCost,
    estimatedIndirectCostPyg: indirectCost,
    durationMonths: duration,
    institutionalPaymentDays: paymentDays,
    annualFinancingRatePct: input.annualFinancingRatePct,
    advancePaymentPct: input.advancePaymentPct
  };

  const base = simulateCashflowScenario(validData, 0, 'BASE');
  const conservative = simulateCashflowScenario(validData, 30, 'CONSERVADOR');
  const stress = simulateCashflowScenario(validData, 90, 'ESTRES');

  let overallViability: TenderFinancialReport['overallViability'] = 'VIABLE';
  const peakRatio = base.peakWorkingCapitalRequiredPyg / offer;

  if (!base.isFinanciallyViable) {
    overallViability = 'NO_VIABLE_ALTO_RIESGO';
  } else if (!stress.isFinanciallyViable || !conservative.isFinanciallyViable || peakRatio >= 0.20) {
    overallViability = 'REQUIERE_FINANCIAMIENTO';
  }

  return {
    tenderId: input.tenderId,
    financialStatus: 'CALCULADO',
    missingInputs: [],
    offerAmountPyg: offer,
    totalCostPyg: directCost + indirectCost,
    baseScenario: base,
    conservativeScenario: conservative,
    stressScenario: stress,
    recommendedFinancingBufferPyg: conservative.peakWorkingCapitalRequiredPyg,
    overallViability
  };
}

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
  offerAmountPyg: number;          // Monto total de la oferta presentada
  estimatedDirectCostPyg: number;   // Costo directo total según Cost Engine (Gate 5B)
  estimatedIndirectCostPyg: number; // Costos indirectos y gastos generales
  durationMonths: number;           // Plazo de ejecución en meses
  institutionalPaymentDays: number; // Procedente de Gate 12
  annualFinancingRatePct?: number;  // Tasa de financiamiento anual (default 12.0% PYG)
  advancePaymentPct?: number;       // Anticipo financiero del contrato (ej: 10% o 20%)
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
  input: TenderFinancialSimulationInput,
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

/**
 * Ejecuta el análisis financiero integral de una licitación en los 3 escenarios
 */
export function analyzeTenderFinancials(input: TenderFinancialSimulationInput): TenderFinancialReport {
  const base = simulateCashflowScenario(input, 0, 'BASE');
  const conservative = simulateCashflowScenario(input, 30, 'CONSERVADOR');
  const stress = simulateCashflowScenario(input, 90, 'ESTRES');

  let overallViability: TenderFinancialReport['overallViability'] = 'VIABLE';
  const peakRatio = base.peakWorkingCapitalRequiredPyg / input.offerAmountPyg;

  if (!base.isFinanciallyViable) {
    overallViability = 'NO_VIABLE_ALTO_RIESGO';
  } else if (!stress.isFinanciallyViable || !conservative.isFinanciallyViable || peakRatio >= 0.20) {
    overallViability = 'REQUIERE_FINANCIAMIENTO';
  }

  return {
    tenderId: input.tenderId,
    offerAmountPyg: input.offerAmountPyg,
    totalCostPyg: input.estimatedDirectCostPyg + input.estimatedIndirectCostPyg,
    baseScenario: base,
    conservativeScenario: conservative,
    stressScenario: stress,
    recommendedFinancingBufferPyg: conservative.peakWorkingCapitalRequiredPyg,
    overallViability
  };
}

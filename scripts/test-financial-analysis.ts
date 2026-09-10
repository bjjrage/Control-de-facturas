/**
 * TEST SUITE: FINANCIAL ANALYSIS OF TENDER (GATE 13)
 * Evalúa el impacto del costo del dinero y los días de mora en 2 obras públicas reales:
 * 1. Obra ANDE (45 días mora): Margen neto preservado, baja necesidad de capital de trabajo.
 * 2. Obra MOPC (150 días mora): Alto capital de trabajo pico, erosión del margen neto por costo financiero.
 */

import { analyzeTenderFinancials, TenderFinancialSimulationInput } from '../lib/procurement/financial-analysis';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: FINANCIAL ANALYSIS OF TENDER (GATE 13)');
  console.log('======================================================\n');

  // CASO 1: Licitación ANDE (Pago a 45 días)
  console.log('--- TEST 1: Obra ANDE (Gs. 5.000M - Plazo 6 meses - Pago 45d) ---');
  const andeInput: TenderFinancialSimulationInput = {
    tenderId: 'TENDER-ANDE-01',
    offerAmountPyg: 5000000000,          // Gs. 5.000 Millones
    estimatedDirectCostPyg: 3800000000,   // Gs. 3.800 Millones
    estimatedIndirectCostPyg: 400000000,  // Gs. 400 Millones (Costo total: 4.200M -> Margen Bruto: 800M o 16%)
    durationMonths: 6,
    institutionalPaymentDays: 45,         // ANDE
    annualFinancingRatePct: 12.0,
    advancePaymentPct: 10.0               // Anticipo 10% (Gs. 500M)
  };

  const andeReport = analyzeTenderFinancials(andeInput);
  console.log(`[ANDE Base] Margen Bruto: ${andeReport.baseScenario.grossMarginPct}% | Margen Neto Real: ${andeReport.baseScenario.netMarginPct}% | Capital Pico: Gs. ${(andeReport.baseScenario.peakWorkingCapitalRequiredPyg / 1e6).toFixed(0)}M | Costo Financiero: Gs. ${(andeReport.baseScenario.financingCostPyg / 1e6).toFixed(1)}M | Viabilidad: ${andeReport.overallViability}`);

  assert(andeReport.overallViability === 'VIABLE', 'Licitación ANDE clasificada como VIABLE');
  assert(andeReport.baseScenario.netMarginPct > 12.0, 'Margen neto se mantiene saludable (> 12%)');
  assert(andeReport.stressScenario.isFinanciallyViable === true, 'Incluso en escenario de estrés, la obra preserva margen positivo');

  // CASO 2: Licitación MOPC (Pago a 150 días)
  console.log('\n--- TEST 2: Obra MOPC (Gs. 20.000M - Plazo 12 meses - Pago 150d) ---');
  const mopcInput: TenderFinancialSimulationInput = {
    tenderId: 'TENDER-MOPC-01',
    offerAmountPyg: 20000000000,         // Gs. 20.000 Millones
    estimatedDirectCostPyg: 15500000000, // Gs. 15.500 Millones
    estimatedIndirectCostPyg: 1500000000,// Gs. 1.500 Millones (Costo total: 17.000M -> Margen Bruto: 3.000M o 15%)
    durationMonths: 12,
    institutionalPaymentDays: 150,        // MOPC
    annualFinancingRatePct: 13.0,
    advancePaymentPct: 10.0               // Anticipo 10% (Gs. 2.000M)
  };

  const mopcReport = analyzeTenderFinancials(mopcInput);
  console.log(`[MOPC Base] Margen Bruto: ${mopcReport.baseScenario.grossMarginPct}% | Margen Neto: ${mopcReport.baseScenario.netMarginPct}% | Capital Pico Requerido: Gs. ${(mopcReport.baseScenario.peakWorkingCapitalRequiredPyg / 1e6).toFixed(0)}M | Costo Financiero: Gs. ${(mopcReport.baseScenario.financingCostPyg / 1e6).toFixed(0)}M`);
  console.log(`[MOPC Estrés (+90d)] Margen Neto: ${mopcReport.stressScenario.netMarginPct}% | Viabilidad General: ${mopcReport.overallViability}`);

  assert(mopcReport.baseScenario.peakWorkingCapitalRequiredPyg > 4000000000, 'Detecta necesidad severa de capital de trabajo (> Gs. 4.000M)');
  assert(mopcReport.baseScenario.financingCostPyg > 500000000, 'Costo financiero de mora supera los Gs. 500M');
  assert(mopcReport.overallViability === 'REQUIERE_FINANCIAMIENTO', 'Clasifica certeramente como REQUIERE_FINANCIAMIENTO');

  // CASO 3: Falla cerrada por evidencia insuficiente (UNKNOWN != DEFAULT)
  console.log('\n--- TEST 3: Evidencia Insuficiente (UNKNOWN != DEFAULT) ---');
  const incompleteInput: TenderFinancialSimulationInput = {
    tenderId: 'TENDER-INCOMPLETE-01',
    offerAmountPyg: null,
    estimatedDirectCostPyg: null,
    durationMonths: null,
    institutionalPaymentDays: null
  };

  const incompleteReport = analyzeTenderFinancials(incompleteInput);
  console.log(`[Incompleto] Estado: ${incompleteReport.financialStatus} | Faltantes: ${incompleteReport.missingInputs.join('; ')}`);
  assert(incompleteReport.financialStatus === 'INSUFFICIENT_EVIDENCE', 'Retorna INSUFFICIENT_EVIDENCE ante datos nulos');
  assert(incompleteReport.overallViability === 'NO_VIABLE_ALTO_RIESGO', 'Fail-closed a NO_VIABLE_ALTO_RIESGO');
  assert(incompleteReport.missingInputs.length >= 4, 'Reporta con precisión los 4 campos faltantes');
  assert(incompleteReport.baseScenario.isFinanciallyViable === false, 'El escenario base no es viable');
  assert(incompleteReport.baseScenario.notes.includes('No simulado'), 'Indica claramente que no fue simulado por falta de evidencia');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 13 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 13:', err);
  process.exit(1);
});

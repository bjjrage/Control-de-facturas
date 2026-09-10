/**
 * TEST SUITE: COMPETITIVE SIMULATOR (GATE 16)
 * Verifica:
 * 1. Simulación Monte Carlo de subastas con N = 10,000 iteraciones
 * 2. Distribución de precios de adjudicación (P10 < P50 < P90)
 * 3. Monotonía de la curva de probabilidad de ganar (a mayor descuento, mayor prob de ganar)
 * 4. Calibración con huellas reales de competidores paraguayos (TOCSA / Progen)
 */

import { simulateCompetitiveBidding, CompetitiveSimulationInput } from '../lib/procurement/competitive-simulator';
import { ContextualFingerprint } from '../lib/procurement/competitor-intelligence';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: COMPETITIVE SIMULATOR (GATE 16)');
  console.log('======================================================\n');

  // CASO: Licitación MOPC de Gs. 10.000 Millones con 5 competidores
  console.log('--- TEST 1: Monte Carlo Simulation (10,000 runs) ---');
  const mockFingerprint: ContextualFingerprint = {
    level: 'EXACT_CONTEXT',
    win_rate_pct: 40,
    avg_discount_pct: 7.5,
    stddev_discount_pct: 2.5,
    sample_size: 15,
    certainty_tier: 'ALTA',
    fallback_applied: false,
    notes: 'Huella calibrada'
  };

  const simInput: CompetitiveSimulationInput = {
    tenderId: 'TENDER-MOPC-SIM',
    referenceBudgetPyg: 10000000000, // 10.000M
    expectedParticipantsCount: 5,
    knownCompetitorFingerprints: [mockFingerprint]
  };

  const result = simulateCompetitiveBidding(simInput, 10000);

  console.log(`Presupuesto Referencial: Gs. ${(result.referenceBudgetPyg / 1e6).toFixed(0)}M`);
  console.log(`Distribución de Precios de Adjudicación Ganadores:`);
  console.log(`   P10 (Agresivo): Gs. ${(result.winningPriceDistribution.p10WinningPricePyg / 1e6).toFixed(2)}M`);
  console.log(`   P50 (Mediana):  Gs. ${(result.winningPriceDistribution.p50WinningPricePyg / 1e6).toFixed(2)}M`);
  console.log(`   P90 (Conserv):  Gs. ${(result.winningPriceDistribution.p90WinningPricePyg / 1e6).toFixed(2)}M`);
  console.log(`Sweet Spot Recomendado: ${result.recommendedSweetSpotDiscountPct}% (Gs. ${(result.recommendedSweetSpotPricePyg / 1e6).toFixed(2)}M)`);

  assert(result.iterationsRun === 10000, 'Se ejecutaron 10,000 iteraciones Monte Carlo');
  assert(result.winningPriceDistribution.p10WinningPricePyg <= result.winningPriceDistribution.p50WinningPricePyg, 'P10 de precio <= P50');
  assert(result.winningPriceDistribution.p50WinningPricePyg <= result.winningPriceDistribution.p90WinningPricePyg, 'P50 de precio <= P90');

  // TEST 2: Monotonía Estricta de la Curva de Probabilidad
  console.log('\n--- TEST 2: Curva de Probabilidad de Ganar (Win Curve) ---');
  let prevProb = -1;
  for (const pt of result.winProbabilityCurve) {
    console.log(`   Descuento: ${pt.discountPct}% | Oferta: Gs. ${(pt.offerAmountPyg / 1e6).toFixed(1)}M | Prob Ganar: ${pt.winProbabilityPct}%`);
    assert(pt.winProbabilityPct >= prevProb, `Monotonía preservada: Probabilidad al ${pt.discountPct}% (${pt.winProbabilityPct}%) >= ${prevProb}%`);
    prevProb = pt.winProbabilityPct;
  }

  assert(result.winProbabilityCurve[0].winProbabilityPct < 20, 'Descuento mínimo (2%) tiene probabilidad baja (< 20%)');
  assert(result.winProbabilityCurve[result.winProbabilityCurve.length - 1].winProbabilityPct > 80, 'Descuento agresivo (18%) tiene probabilidad alta (> 80%)');

  // TEST 3: Presupuesto Referencial Inexistente o Nulo (Fail-Closed)
  console.log('\n--- TEST 3: Presupuesto Referencial Faltante (Fail-Closed) ---');
  const invalidSimInput: CompetitiveSimulationInput = {
    tenderId: 'TENDER-NO-BUDGET',
    referenceBudgetPyg: 0
  };

  const invalidResult = simulateCompetitiveBidding(invalidSimInput);
  console.log(`Estado: ${invalidResult.simulationStatus} | Faltantes: ${invalidResult.missingInputs.join('; ')}`);
  assert(invalidResult.simulationStatus === 'INSUFFICIENT_EVIDENCE', 'Retorna INSUFFICIENT_EVIDENCE ante presupuesto nulo');
  assert(invalidResult.iterationsRun === 0, 'No gasta iteraciones Monte Carlo sobre presupuestos ficticios');
  assert(invalidResult.winProbabilityCurve.length === 0, 'Curva de probabilidad vacía');

  // TEST 4: Simulación No Calibrada (Sin oferentes observados ni huellas)
  console.log('\n--- TEST 4: Simulación Sin Calibrar ---');
  const uncalibratedSimInput: CompetitiveSimulationInput = {
    tenderId: 'TENDER-UNCALIBRATED',
    referenceBudgetPyg: 5000000000
  };

  const uncalibratedResult = simulateCompetitiveBidding(uncalibratedSimInput, 1000);
  console.log(`Estado: ${uncalibratedResult.simulationStatus} | Calibrado: ${uncalibratedResult.isCalibrated}`);
  assert(uncalibratedResult.simulationStatus === 'CALCULADO', 'Simulación calculable');
  assert(uncalibratedResult.isCalibrated === false, 'Detecta correctamente que es uncalibrated');
  assert(uncalibratedResult.missingInputs.length > 0, 'Registra advertencias de calibración');

  // TEST 5: Simulación Plenamente Calibrada con Huellas Empíricas
  console.log('\n--- TEST 5: Simulación Plenamente Calibrada con Huellas Empíricas ---');
  const calibratedSimInput: CompetitiveSimulationInput = {
    tenderId: 'TENDER-CALIBRATED',
    referenceBudgetPyg: 15000000000,
    expectedParticipantsCount: 3,
    knownCompetitorFingerprints: [
      {
        level: 'EXACT_CONTEXT',
        win_rate_pct: 65,
        avg_discount_pct: 9.5,
        stddev_discount_pct: 2.1,
        sample_size: 8,
        certainty_tier: 'MEDIA',
        fallback_applied: false,
        notes: 'Calibrado en MOPC obras viales'
      },
      {
        level: 'EXACT_CONTEXT',
        win_rate_pct: 40,
        avg_discount_pct: 11.2,
        stddev_discount_pct: 1.8,
        sample_size: 12,
        certainty_tier: 'MEDIA',
        fallback_applied: false,
        notes: 'Calibrado en MOPC obras viales'
      }
    ]
  };

  const calibratedResult = simulateCompetitiveBidding(calibratedSimInput, 5000);
  console.log(`Estado: ${calibratedResult.simulationStatus} | Calibrado: ${calibratedResult.isCalibrated} | Sweet Spot: ${calibratedResult.recommendedSweetSpotDiscountPct}%`);
  assert(calibratedResult.simulationStatus === 'CALCULADO', 'Simulación calculada exitosamente');
  assert(calibratedResult.isCalibrated === true, 'isCalibrated es true con huellas y participantes observados');
  assert(calibratedResult.missingInputs.length === 0, 'Cero advertencias de datos faltantes');
  assert(calibratedResult.recommendedSweetSpotDiscountPct >= 9.0, 'Sweet spot ajustado a los descuentos empíricos observados');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 16 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 16:', err);
  process.exit(1);
});

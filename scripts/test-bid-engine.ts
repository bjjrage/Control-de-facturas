/**
 * TEST SUITE: BID ENGINE (GATE 17)
 * Verifica los 3 veredictos canónicos de decisión comercial:
 * 1. Caso COMPETIR (Licitación ANDE: Todo en verde, margen neto 15%, elegible)
 * 2. Caso REVISAR (Licitación MOPC: Elegible, pero requiere Gs. 5.000M de financiamiento)
 * 3. Caso NO_COMPETIR (Licitación con falta excluyente de pliego y convocante de alto riesgo D)
 */

import { evaluateBidOpportunity, BidEngineInput } from '../lib/procurement/bid-engine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: BID ENGINE (GATE 17)');
  console.log('======================================================\n');

  // -------------------------------------------------------------
  // CASO 1: Dictamen COMPETIR (Licitación ANDE)
  // -------------------------------------------------------------
  console.log('--- TEST 1: Caso COMPETIR (Licitación ANDE) ---');
  const inputAnde: BidEngineInput = {
    tenderId: 'LIC-ANDE-100',
    tenderTitle: 'Montaje de Línea de Media Tensión',
    buyerName: 'ANDE',
    referenceBudgetPyg: 5000000000,
    complianceReport: {
      tenderId: 'LIC-ANDE-100',
      isEligibleToBid: true,
      evidenceOrigin: 'EXTRACTED_FROM_PBC',
      scoreCumplimientoPct: 100,
      totalRequirements: 5,
      cumplidosCount: 5,
      generablesCount: 0,
      faltantesCount: 0,
      evaluations: []
    },
    institutionProfile: {
      convocante: 'ANDE',
      totalLlamados: 10,
      totalMontoAdjudicadoPyg: 50000000000,
      adendasPorLlamadoPromedio: 0.2,
      tasaCancelacionPct: 0,
      diasPromedioPago: 45,
      calificacionRiesgo: 'A',
      indiceConcentracionTop3Pct: 40,
      topProveedores: [],
      resumenRiesgo: 'Excelente pagador'
    },
    financialReport: {
      tenderId: 'LIC-ANDE-100',
      financialStatus: 'CALCULADO',
      missingInputs: [],
      offerAmountPyg: 4600000000,
      totalCostPyg: 3800000000,
      baseScenario: {
        scenarioName: 'BASE',
        paymentLagDays: 45,
        peakWorkingCapitalRequiredPyg: 400000000,
        financingCostPyg: 24000000,
        grossProfitPyg: 800000000,
        netProfitPyg: 776000000,
        grossMarginPct: 17.39,
        netMarginPct: 16.87,
        isFinanciallyViable: true,
        notes: ''
      },
      conservativeScenario: {} as any,
      stressScenario: {} as any,
      recommendedFinancingBufferPyg: 400000000,
      overallViability: 'VIABLE'
    },
    simulationResult: {
      tenderId: 'LIC-ANDE-100',
      simulationStatus: 'CALCULADO',
      isCalibrated: true,
      missingInputs: [],
      referenceBudgetPyg: 5000000000,
      simulatedCompetitorsCount: 4,
      winningPriceDistribution: { p10WinningPricePyg: 4400000000, p50WinningPricePyg: 4600000000, p90WinningPricePyg: 4800000000 },
      winProbabilityCurve: [{ discountPct: 8, offerAmountPyg: 4600000000, winProbabilityPct: 68 }],
      recommendedSweetSpotDiscountPct: 8,
      recommendedSweetSpotPricePyg: 4600000000,
      iterationsRun: 10000
    }
  };

  const decision1 = evaluateBidOpportunity(inputAnde);
  console.log(`Dictamen ANDE: ${decision1.decision} | Score: ${decision1.overallScore}/100 | Margen Neto: ${decision1.expectedNetMarginPct}% | Prob: ${decision1.winProbabilityPct}%`);
  assert(decision1.decision === 'COMPETIR', 'Dictamen es COMPETIR');
  assert(decision1.blockers.length === 0, 'Cero bloqueadores');
  assert(decision1.overallScore >= 85, 'Score global superior a 85');

  // -------------------------------------------------------------
  // CASO 2: Dictamen REVISAR (Licitación MOPC con Financiamiento Requerido)
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Caso REVISAR (Licitación MOPC) ---');
  const inputMopc: BidEngineInput = {
    ...inputAnde,
    tenderId: 'LIC-MOPC-200',
    buyerName: 'MOPC',
    institutionProfile: {
      ...inputAnde.institutionProfile,
      convocante: 'MOPC',
      diasPromedioPago: 150,
      calificacionRiesgo: 'C'
    },
    financialReport: {
      ...inputAnde.financialReport,
      overallViability: 'REQUIERE_FINANCIAMIENTO',
      baseScenario: {
        ...inputAnde.financialReport.baseScenario,
        paymentLagDays: 150,
        peakWorkingCapitalRequiredPyg: 5000000000,
        netMarginPct: 9.5
      }
    }
  };

  const decision2 = evaluateBidOpportunity(inputMopc);
  console.log(`Dictamen MOPC: ${decision2.decision} | Score: ${decision2.overallScore}/100 | Pilares en Advertencia: ${decision2.pillars.filter(p => p.status === 'ADVERTENCIA').length}`);
  assert(decision2.decision === 'REVISAR', 'Dictamen es REVISAR (Alerta de capital pico de Gs. 5.000M)');
  assert(decision2.blockers.length === 0, 'No tiene bloqueadores fatales, solo advertencias financieras');

  // -------------------------------------------------------------
  // CASO 3: Dictamen NO_COMPETIR (Inhabilitado / Faltante Crítico)
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Caso NO_COMPETIR (Falta Excluyente de Pliego) ---');
  const inputNoGo: BidEngineInput = {
    ...inputAnde,
    tenderId: 'LIC-NOGO-300',
    complianceReport: {
      ...inputAnde.complianceReport,
      isEligibleToBid: false, // Faltante excluyente
      scoreCumplimientoPct: 40
    }
  };

  const decision3 = evaluateBidOpportunity(inputNoGo);
  console.log(`Dictamen Descalificado: ${decision3.decision} | Bloqueadores: ${decision3.blockers.join('; ')}`);
  assert(decision3.decision === 'NO_COMPETIR', 'Dictamen es NO_COMPETIR');
  assert(decision3.blockers.length > 0, 'Reporta bloqueador excluyente');

  // -------------------------------------------------------------
  // CASO 4: Dictamen NO_COMPETIR por Requisitos Solo Sugeridos Genéricamente
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Caso NO_COMPETIR (Requisitos Solo Genéricos) ---');
  const inputGeneric: BidEngineInput = {
    ...inputAnde,
    tenderId: 'LIC-GENERIC-400',
    complianceReport: {
      ...inputAnde.complianceReport,
      evidenceOrigin: 'GENERIC_REQUIREMENT_SUGGESTIONS'
    }
  };

  const decision4 = evaluateBidOpportunity(inputGeneric);
  console.log(`Dictamen Sugerencias Genéricas: ${decision4.decision} | Bloqueadores: ${decision4.blockers.join('; ')}`);
  assert(decision4.decision === 'NO_COMPETIR', 'Bloquea GO si los requisitos no proceden de PBC oficial');
  assert(decision4.blockers.some(b => b.includes('Pliego de Bases y Condiciones')), 'Contiene bloqueador de PBC requerido');

  // -------------------------------------------------------------
  // CASO 5: Dictamen NO_COMPETIR por Falta de Evidencia de Costos
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Caso NO_COMPETIR (Evidencia de Costos Insuficiente) ---');
  const inputNoCost: BidEngineInput = {
    ...inputAnde,
    tenderId: 'LIC-NOCOST-500',
    financialReport: {
      ...inputAnde.financialReport,
      financialStatus: 'INSUFFICIENT_EVIDENCE',
      missingInputs: ['Costo directo de insumos no determinado']
    }
  };

  const decision5 = evaluateBidOpportunity(inputNoCost);
  console.log(`Dictamen Sin Costos: ${decision5.decision} | Bloqueadores: ${decision5.blockers.join('; ')}`);
  assert(decision5.decision === 'NO_COMPETIR', 'Bloquea GO si no hay evidencia comprobable de costos');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 17 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 17:', err);
  process.exit(1);
});

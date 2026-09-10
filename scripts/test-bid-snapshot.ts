/**
 * TEST SUITE: BID ANALYSIS SNAPSHOT (GATE 18)
 * Verifica:
 * 1. Creación de snapshot inmutable con los 5 pilares completos
 * 2. Generación de firma criptográfica SHA-256
 * 3. Detección de adulteración o cambio silencioso (Integrity check)
 * 4. Reconstrucción histórica fiel
 */

import { createBidAnalysisSnapshot, verifySnapshotIntegrity } from '../lib/procurement/bid-snapshot';
import { BidEngineInput, BidDecisionOutput } from '../lib/procurement/bid-engine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: BID ANALYSIS SNAPSHOT (GATE 18)');
  console.log('======================================================\n');

  const mockInput: BidEngineInput = {
    tenderId: 'TENDER-PARAGUAY-2026',
    tenderTitle: 'Construcción de Puente de Hormigón',
    buyerName: 'MOPC',
    referenceBudgetPyg: 12000000000,
    complianceReport: { tenderId: 'TENDER-PARAGUAY-2026', isEligibleToBid: true, evidenceOrigin: 'EXTRACTED_FROM_PBC', scoreCumplimientoPct: 100, totalRequirements: 4, cumplidosCount: 4, generablesCount: 0, faltantesCount: 0, reviewRequiredCount: 0, evaluations: [] },
    institutionProfile: { convocante: 'MOPC', totalLlamados: 20, totalMontoAdjudicadoPyg: 100000000000, adendasPorLlamadoPromedio: 1.5, tasaCancelacionPct: 5, diasPromedioPago: 140, calificacionRiesgo: 'C', indiceConcentracionTop3Pct: 35, topProveedores: [], resumenRiesgo: 'Mora moderada' },
    financialReport: { tenderId: 'TENDER-PARAGUAY-2026', financialStatus: 'CALCULADO', missingInputs: [], offerAmountPyg: 11000000000, totalCostPyg: 9000000000, baseScenario: { scenarioName: 'BASE', paymentLagDays: 140, peakWorkingCapitalRequiredPyg: 2000000000, financingCostPyg: 280000000, grossProfitPyg: 2000000000, netProfitPyg: 1720000000, grossMarginPct: 18.18, netMarginPct: 15.64, isFinanciallyViable: true, notes: '' }, conservativeScenario: {} as any, stressScenario: {} as any, recommendedFinancingBufferPyg: 2000000000, overallViability: 'VIABLE' },
    simulationResult: { tenderId: 'TENDER-PARAGUAY-2026', simulationStatus: 'CALCULADO', isCalibrated: true, missingInputs: [], referenceBudgetPyg: 12000000000, simulatedCompetitorsCount: 5, winningPriceDistribution: { p10WinningPricePyg: 10500000000, p50WinningPricePyg: 11000000000, p90WinningPricePyg: 11400000000 }, winProbabilityCurve: [], recommendedSweetSpotDiscountPct: 8.3, recommendedSweetSpotPricePyg: 11000000000, iterationsRun: 10000 }
  };

  const mockOutput: BidDecisionOutput = {
    tenderId: 'TENDER-PARAGUAY-2026',
    decision: 'COMPETIR',
    overallScore: 88,
    recommendedOfferPricePyg: 11000000000,
    expectedNetMarginPct: 15.64,
    winProbabilityPct: 65,
    pillars: [],
    keyJustifications: ['Margen neto superior al 15%'],
    blockers: []
  };

  const now = '2026-03-01T15:30:00.000Z';

  // TEST 1: Generación y Validación de Integridad
  console.log('--- TEST 1: Creación de Snapshot y Verificación de Integridad ---');
  const snapshot = createBidAnalysisSnapshot('emp-tenant-1', mockInput, mockOutput, now);
  console.log(`Snapshot Generado: Decision = ${snapshot.decision} | Score = ${snapshot.overallScore} | SHA-256 Hash = ${snapshot.snapshotHash}`);

  assert(snapshot.snapshotHash.length === 64, 'Hash SHA-256 válido de 64 caracteres');
  assert(verifySnapshotIntegrity(snapshot) === true, 'Integridad del snapshot verificada con éxito');

  // TEST 2: Detección Inmediata de Adulteración (Tamper Detection) en cada pilar canónico
  console.log('\n--- TEST 2: Detección de Adulteración en Componentes Canónicos ---');
  
  // 2.1 Adulteración en Score general
  const tamperedScore = { ...snapshot, overallScore: 99 };
  assert(verifySnapshotIntegrity(tamperedScore) === false, 'Adulteración en overallScore detectada y rechazada');

  // 2.2 Adulteración en Compliance Snapshot
  const tamperedCompliance = {
    ...snapshot,
    complianceSnapshot: { ...snapshot.complianceSnapshot, isEligibleToBid: false }
  };
  assert(verifySnapshotIntegrity(tamperedCompliance) === false, 'Adulteración en complianceSnapshot detectada y rechazada');

  // 2.3 Adulteración en Financial Snapshot
  const tamperedFinancial = {
    ...snapshot,
    financialSnapshot: { ...snapshot.financialSnapshot, totalCostPyg: 9999999999 }
  };
  assert(verifySnapshotIntegrity(tamperedFinancial) === false, 'Adulteración en financialSnapshot detectada y rechazada');

  // 2.4 Adulteración en Simulation Snapshot
  const tamperedSimulation = {
    ...snapshot,
    simulationSnapshot: { ...snapshot.simulationSnapshot, recommendedSweetSpotDiscountPct: 15.0 }
  };
  assert(verifySnapshotIntegrity(tamperedSimulation) === false, 'Adulteración en simulationSnapshot detectada y rechazada');

  // 2.5 Adulteración en Blockers
  const tamperedBlocker = {
    ...snapshot,
    blockers: ['Bloqueador inyectado fraudulentamente']
  };
  assert(verifySnapshotIntegrity(tamperedBlocker) === false, 'Inyección fraudulenta en blockers detectada y rechazada');

  // 2.6 Adulteración en Justifications
  const tamperedJustification = {
    ...snapshot,
    justifications: ['Justificación falsa']
  };
  assert(verifySnapshotIntegrity(tamperedJustification) === false, 'Modificación en justifications detectada y rechazada');

  // 2.7 Snapshot intacto verificado
  assert(verifySnapshotIntegrity(snapshot) === true, 'Snapshot no adulterado verificado con éxito');

  // TEST 3: Nullability & Persistencia de Métricas no Calibradas (Invariante UNKNOWN != DEFAULT)
  console.log('\n--- TEST 3: Persistencia e Hidratación de Métricas Nulas (UNKNOWN != DEFAULT) ---');
  const { persistBidAnalysisSnapshot, getTenderAnalysisSnapshots } = await import('../lib/procurement/bid-snapshot');

  const uncalibratedOutput: BidDecisionOutput = {
    tenderId: 'TENDER-PARAGUAY-2026',
    decision: 'REVISAR',
    overallScore: 50,
    recommendedOfferPricePyg: null,
    expectedNetMarginPct: null,
    winProbabilityPct: null,
    pillars: [],
    keyJustifications: ['Modelo no calibrado por falta de oferentes históricos'],
    blockers: []
  };

  const nullSnapshot = createBidAnalysisSnapshot('emp-tenant-1', mockInput, uncalibratedOutput, now);
  assert(nullSnapshot.precioOfertaRecomendadoPyg === null, 'Precio recomendado es null en snapshot');
  assert(nullSnapshot.margenNetoEstimadoPct === null, 'Margen neto es null en snapshot');
  assert(nullSnapshot.probabilidadGanarPct === null, 'Probabilidad de ganar es null en snapshot');
  assert(verifySnapshotIntegrity(nullSnapshot) === true, 'Hash canónico maneja nulls determinísticamente');

  // Mock de Supabase para validar persistencia de nulls e hidratación sin Number(null) -> 0
  let persistedRow: any = null;
  const mockSupabase = {
    from: (table: string) => ({
      insert: (payload: any) => {
        persistedRow = payload;
        return {
          select: () => ({
            single: async () => ({ data: { id: 'snap-uuid-999' }, error: null })
          })
        };
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({
              data: [
                {
                  id: 'snap-uuid-999',
                  empresa_id: 'emp-tenant-1',
                  tender_id: 'TENDER-PARAGUAY-2026',
                  titulo_licitacion: 'Construcción de Puente de Hormigón',
                  convocante: 'MOPC',
                  decision: 'REVISAR',
                  overall_score: '50.00',
                  monto_referencial_pyg: '12000000000.00',
                  precio_oferta_recomendado_pyg: null,
                  margen_neto_estimado_pct: null,
                  probabilidad_ganar_pct: null,
                  compliance_snapshot: {},
                  institution_snapshot: {},
                  financial_snapshot: {},
                  simulation_snapshot: {},
                  pillars_snapshot: [],
                  justifications: [],
                  blockers: [],
                  snapshot_hash: nullSnapshot.snapshotHash,
                  created_at: now
                }
              ],
              error: null
            })
          })
        })
      })
    })
  };

  const persistResult = await persistBidAnalysisSnapshot(mockSupabase, nullSnapshot);
  assert(persistResult.id === 'snap-uuid-999', 'Snapshot persistido con ID válido');
  assert(persistedRow.precio_oferta_recomendado_pyg === null, 'BD recibe NULL para precio oferta recomendado');
  assert(persistedRow.margen_neto_estimado_pct === null, 'BD recibe NULL para margen neto estimado');
  assert(persistedRow.probabilidad_ganar_pct === null, 'BD recibe NULL para probabilidad ganar');

  const { runs } = await getTenderAnalysisSnapshots(mockSupabase, 'emp-tenant-1', 'TENDER-PARAGUAY-2026');
  assert(runs.length === 1, 'Se recuperó 1 snapshot histórico');
  assert(runs[0].precioOfertaRecomendadoPyg === null, 'Hidratación preserva null (no se convierte a 0 vía Number(null))');
  assert(runs[0].margenNetoEstimadoPct === null, 'Hidratación de margen neto preserva null');
  assert(runs[0].probabilidadGanarPct === null, 'Hidratación de probabilidad ganar preserva null');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE INTEGRIDAD CANÓNICA DE GATE 18 PASARON');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 18:', err);
  process.exit(1);
});
